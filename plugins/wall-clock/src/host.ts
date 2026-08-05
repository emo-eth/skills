import { parseDeadlineSpec } from "./time.ts";
import { stateFromEntries } from "./store.ts";
import { WallClockController } from "./controller.ts";
import type { AssignmentInput, ChildReport, Clock, DeadlineInput, ToolProposal } from "./types.ts";

export type RuntimeContext = {
  sessionId?: string;
  sessionManager?: { getSessionFile?: () => string | undefined; getEntries?: () => unknown[]; getBranch?: () => unknown[] };
  ui?: { notify?: (message: string, level?: string) => void };
};

export type RuntimeHost = {
  on(event: string, handler: (event: any, ctx: RuntimeContext) => unknown): void;
  events?: { on(event: string, handler: (event: any) => unknown): void };
  registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: RuntimeContext) => unknown }): void;
  registerTool?: (definition: { name: string; label: string; description: string; parameters: unknown; execute: (...args: any[]) => unknown }) => void;
  appendEntry?: (customType: string, data?: unknown) => void;
  sendMessage?: (message: unknown, options?: unknown) => void;
  setStatus?: (key: string, value: string | undefined) => void;
};

export type HostExtensionOptions = {
  controller?: WallClockController;
  clock?: Clock;
};

export function installHostExtension(host: RuntimeHost, options: HostExtensionOptions = {}): WallClockController {
  const controller = options.controller ?? new WallClockController(options.clock);
  let currentSessionId: string | undefined;
  const ephemeralSessionId = `ephemeral-${Math.random().toString(36).slice(2)}`;

  const sessionId = (ctx?: RuntimeContext): string => {
    const explicit = ctx?.sessionId ?? ctx?.sessionManager?.getSessionFile?.();
    if (explicit) currentSessionId = explicit;
    if (!currentSessionId) currentSessionId = ephemeralSessionId;
    return currentSessionId;
  };

  const persist = (id: string) => {
    const state = controller.snapshot(id);
    if (state) host.appendEntry?.("wall-clock-state", state);
  };

  host.registerCommand("wallclock", {
    description: "Activate and inspect wall-clock control",
    handler: async (args, ctx) => {
      const id = sessionId(ctx);
      const [command = "status", value] = args.trim().split(/\s+/, 2);
      if (command === "start") {
        if (!value) throw new Error("Usage: /wallclock start 30m|5pm");
        const input = parseDeadlineSpec(value);
        const status = controller.activate(id, input);
        persist(id);
        notify(ctx, `Wall-clock active: ${status.phase}, ${status.remainingMs}ms remaining`);
        return;
      }
      if (command === "stop") {
        controller.stop(id);
        persist(id);
        notify(ctx, "Wall-clock control stopped");
        return;
      }
      const status = controller.status(id);
      notify(ctx, `${status.phase}: ${status.remainingMs}ms remaining`);
    },
  });

  host.registerTool?.({
    name: "wallclock_assign",
    label: "Wall-clock assignment",
    description: "Create a bounded child assignment under the active main session",
    parameters: ASSIGNMENT_SCHEMA,
    execute: async (...args: any[]) => {
      const input = toolInput<AssignmentInput>(args);
      const id = sessionId(toolContext(args));
      const assignment = controller.assign(id, input);
      persist(id);
      return textResult({ assignment, context: controller.context(id, assignment.id) });
    },
  });

  host.registerTool?.({
    name: "wallclock_complete",
    label: "Complete wall-clock assignment",
    description: "Mark an assignment complete, partial, blocked, or expired",
    parameters: COMPLETE_SCHEMA,
    execute: async (...args: any[]) => {
      const input = toolInput<{ assignmentId: string; status: "complete" | "partial" | "blocked" | "expired" }>(args);
      const id = sessionId(toolContext(args));
      const assignment = controller.complete(id, input.assignmentId, input.status);
      persist(id);
      return textResult(assignment);
    },
  });

  host.registerTool?.({
    name: "wallclock_report",
    label: "Wall-clock report",
    description: "Record completed work, evidence, shortcuts, skipped validation, and risks",
    parameters: REPORT_SCHEMA,
    execute: async (...args: any[]) => {
      const input = toolInput<ChildReport>(args);
      const id = sessionId(toolContext(args));
      controller.report(id, input);
      persist(id);
      return textResult({ recorded: true, status: controller.status(id, input.assignmentId) });
    },
  });

  const restoreSession = async (_event: any, ctx: RuntimeContext) => {
    const id = sessionId(ctx);
    const restored = stateFromEntries(ctx.sessionManager?.getEntries?.() ?? ctx.sessionManager?.getBranch?.() ?? []);
    if (restored) controller.restoreFromState(restored);
    updateStatus(host, controller, id);
  };

  host.on("session_start", restoreSession);
  host.on("session_switch", restoreSession);
  host.on("session_branch", restoreSession);
  host.on("session_tree", restoreSession);

  host.on("before_agent_start", async (event, ctx) => {
    const id = sessionId(ctx);
    const context = controller.context(id);
    if (!context.startsWith("Wall-clock control is inactive")) {
      return { message: { customType: "wall-clock-context", content: context, display: false } };
    }
    return undefined;
  });

  host.on("context", async (event, ctx) => {
    const id = sessionId(ctx);
    const context = controller.context(id);
    if (!context.startsWith("Wall-clock control is inactive")) {
      const messages = Array.isArray(event?.messages) ? event.messages : [];
      return {
        messages: [
          ...messages,
          { role: "user", content: [{ type: "text", text: context }], timestamp: Date.now() },
        ],
      };
    }
    return undefined;
  });

  host.on("tool_call", async (event, ctx) => {
    const id = sessionId(ctx);
    const proposal: ToolProposal = {
      toolName: event.toolName ?? event.name ?? "unknown",
      input: event.input,
      estimatedMs: event.estimatedMs,
      assignmentId: event.assignmentId,
    };
    const decision = controller.decideTool(id, proposal);
    if (!decision.allow) return { block: true, reason: decision.reason };
    updateStatus(host, controller, id);
    return undefined;
  });

  const subagentLifecycle = async (event: any) => {
    const id = sessionId();
    const assignmentId = event.assignmentId ?? event.taskId;
    const childId = event.childSessionId ?? event.agentId ?? event.sessionFile ?? event.id;
    if (assignmentId && childId && event.status === "started") {
      controller.attachChild(id, assignmentId, childId);
      persist(id);
    }
  };
  if (host.events) host.events.on("task:subagent:lifecycle", subagentLifecycle);
  else host.on("task:subagent:lifecycle", subagentLifecycle as any);

  host.on("session_shutdown", async (_event, ctx) => {
    const id = sessionId(ctx);
    persist(id);
    currentSessionId = undefined;
  });

  return controller;
}

function notify(ctx: RuntimeContext, message: string): void {
  ctx.ui?.notify?.(message, "info");
}

function updateStatus(host: RuntimeHost, controller: WallClockController, sessionId: string): void {
  const status = controller.status(sessionId);
  if (status.active) host.setStatus?.("wall-clock", `${status.phase} ${Math.ceil(status.remainingMs / 1_000)}s`);
  else host.setStatus?.("wall-clock", undefined);
}

function textResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function toolInput<T>(args: any[]): T {
  const candidates = args.length > 1 ? [args[1], args[0]] : [args[0]];
  const input = candidates.find((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate));
  if (!input) throw new Error("The host did not provide tool input");
  return input as T;
}

function toolContext(args: any[]): RuntimeContext | undefined {
  return args.find((candidate) => candidate?.sessionManager || candidate?.sessionId);
}

const ASSIGNMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["parentPlanItemId", "objective", "scope", "acceptance", "budgetMs"],
  properties: {
    id: { type: "string" },
    parentPlanItemId: { type: "string" },
    objective: { type: "string" },
    scope: { type: "array", items: { type: "string" } },
    acceptance: { type: "array", items: { type: "string" } },
    budgetMs: { type: "number", exclusiveMinimum: 0 },
    wrapUpMs: { type: "number", exclusiveMinimum: 0 },
  },
};

const COMPLETE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assignmentId", "status"],
  properties: {
    assignmentId: { type: "string" },
    status: { type: "string", enum: ["complete", "partial", "blocked", "expired"] },
  },
};

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assignmentId", "status", "completed", "evidence", "partial", "skipped", "validation", "shortcuts", "risks", "unknowns", "recommendedParentAction"],
  properties: {
    assignmentId: { type: "string" },
    status: { type: "string", enum: ["complete", "partial", "blocked", "expired"] },
    completed: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
    partial: { type: "array", items: { type: "string" } },
    skipped: { type: "array", items: { type: "string" } },
    validation: { type: "array", items: { type: "string" } },
    shortcuts: { type: "array", items: { type: "object" } },
    risks: { type: "array", items: { type: "string" } },
    unknowns: { type: "array", items: { type: "string" } },
    recommendedParentAction: { type: "string" },
  },
};

export function deadlineInput(spec: string, nowMs = Date.now()): DeadlineInput {
  return parseDeadlineSpec(spec, nowMs);
}
