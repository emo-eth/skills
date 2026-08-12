import { parseDeadlineSpec } from "./time.ts";
import { stateFromEntries } from "./store.ts";
import { classifyAction, isWallClockControlTool, WallClockController } from "./controller.ts";
import type {
  ActionClass,
  ActivationInput,
  Assignment,
  AssignmentInput,
  ChildReportInput,
  Clock,
  ExpiryPolicy,
  PlanItem,
  ToolProposal,
} from "./types.ts";

export type RuntimeContext = {
  sessionId?: string;
  assignmentId?: string;
  sessionManager?: { getSessionFile?: () => string | undefined; getEntries?: () => unknown[]; getBranch?: () => unknown[] };
  ui?: { notify?: (message: string, level?: string) => void; setStatus?: (key: string, value: string | undefined) => void };
  abort?: () => void | Promise<void>;
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

type AbortRequest = {
  sessionId: string;
  actionIds: string[];
  context?: RuntimeContext;
};

export type HostEnforcement = {
  name: string;
  canBlockNew: boolean;
  abortRunning?: (request: AbortRequest) => void | Promise<void>;
  abortObserved?: (event: unknown) => boolean;
};

export type HostExtensionOptions = {
  controller?: WallClockController;
  clock?: Clock;
  enforcement?: HostEnforcement;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancelSchedule?: (handle: unknown) => void;
};

type Scope = {
  sessionId: string;
  assignmentId?: string;
};

type ChildBinding = {
  parentSessionId: string;
  assignmentId: string;
};

export function installHostExtension(host: RuntimeHost, options: HostExtensionOptions = {}): WallClockController {
  const controller = options.controller ?? new WallClockController(options.clock);
  const enforcement = options.enforcement;
  const schedule = options.schedule ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancelSchedule = options.cancelSchedule ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const timers = new Map<string, unknown>();
  const latestContexts = new Map<string, RuntimeContext>();
  const childBindings = new Map<string, ChildBinding>();
  const actionAssignments = new Map<string, { sessionId: string; assignmentId?: string }>();
  let currentSessionId: string | undefined;
  let actionSequence = 0;

  const directSessionId = (ctx?: RuntimeContext): string | undefined => {
    const explicit = ctx?.sessionId ?? ctx?.sessionManager?.getSessionFile?.();
    if (explicit) return explicit;
    return undefined;
  };

  const scopeFor = (ctx?: RuntimeContext, event?: any): Scope | undefined => {
    const direct = directSessionId(ctx) ?? (typeof event?.sessionId === "string" ? event.sessionId : undefined);
    const child = direct ? childBindings.get(direct) : undefined;
    if (child) return { sessionId: child.parentSessionId, assignmentId: child.assignmentId };
    const assignmentId = typeof event?.assignmentId === "string"
      ? event.assignmentId
      : typeof ctx?.assignmentId === "string" ? ctx.assignmentId : undefined;
    const sessionId = direct ?? currentSessionId;
    return sessionId ? { sessionId, assignmentId } : undefined;
  };

  const rememberContext = (ctx?: RuntimeContext, event?: any): Scope | undefined => {
    const direct = directSessionId(ctx) ?? (typeof event?.sessionId === "string" ? event.sessionId : undefined);
    if (direct) latestContexts.set(direct, ctx ?? {});
    const scope = scopeFor(ctx, event);
    if (scope && !childBindings.has(direct ?? "")) currentSessionId = scope.sessionId;
    return scope;
  };

  const requireStableSession = (ctx?: RuntimeContext): string => {
    const id = directSessionId(ctx) ?? currentSessionId;
    if (!id) throw new Error("Wall-clock activation requires a stable host session identifier");
    return id;
  };

  const persist = (sessionId: string): void => {
    const state = controller.snapshot(sessionId);
    if (state) host.appendEntry?.("wall-clock-state", state);
  };

  const clearDeadline = (sessionId: string): void => {
    const timer = timers.get(sessionId);
    if (timer !== undefined) {
      cancelSchedule(timer);
      timers.delete(sessionId);
    }
  };

  const ensureActivationSupport = (expiryPolicy: ExpiryPolicy): void => {
    if (!enforcement?.canBlockNew) {
      throw new Error("Wall-clock activation rejected: this host has no tested pre-action blocking seam");
    }
    if (expiryPolicy === "abort-running" && (!enforcement.abortRunning || !enforcement.abortObserved)) {
      throw new Error("Wall-clock activation rejected: this host cannot prove abort-running enforcement");
    }
  };

  const scheduleDeadline = (sessionId: string, ctx?: RuntimeContext): void => {
    clearDeadline(sessionId);
    const status = controller.status(sessionId);
    if (!status.active || status.deadlineMs === undefined) return;
    const delayMs = Math.max(0, status.deadlineMs - (options.clock?.now() ?? Date.now()));
    const timer = schedule(() => {
      void handleExpiry(sessionId, ctx).catch((error) => notify(ctx, `Wall-clock expiry handling failed: ${errorMessage(error)}`, "error"));
    }, delayMs);
    timers.set(sessionId, timer);
  };

  const handleExpiry = async (sessionId: string, fallbackContext?: RuntimeContext): Promise<void> => {
    const status = controller.status(sessionId);
    if (!status.active || status.phase !== "expired" || status.expiryPolicy !== "abort-running") return;
    const actions = controller.runningActions(sessionId);
    if (actions.length === 0) return;
    const actionIds = actions.map((action) => action.actionId);
    for (const actionId of actionIds) controller.requestAbort(sessionId, actionId);
    await enforcement?.abortRunning?.({ sessionId, actionIds, context: fallbackContext ?? latestContexts.get(sessionId) });
  };

  const activateSession = (ctx: RuntimeContext | undefined, input: ActivationInput, plan: PlanItem[] = []) => {
    const sessionId = requireStableSession(ctx);
    ensureActivationSupport(input.expiryPolicy);
    const status = controller.activate(sessionId, input, plan);
    latestContexts.set(sessionId, ctx ?? latestContexts.get(sessionId) ?? {});
    scheduleDeadline(sessionId, ctx);
    persist(sessionId);
    updateStatus(host, controller, sessionId, ctx);
    return status;
  };

  const stopSession = (ctx: RuntimeContext | undefined) => {
    const sessionId = requireStableSession(ctx);
    controller.stop(sessionId);
    clearDeadline(sessionId);
    persist(sessionId);
    updateStatus(host, controller, sessionId, ctx);
    return controller.status(sessionId);
  };

  const restoreSession = async (_event: any, ctx: RuntimeContext) => {
    const direct = directSessionId(ctx);
    if (!direct) return;
    currentSessionId = direct;
    latestContexts.set(direct, ctx);
    const restored = stateFromEntries(ctx.sessionManager?.getEntries?.() ?? ctx.sessionManager?.getBranch?.() ?? [], direct);
    if (restored) controller.restoreFromState(restored, direct);
    else controller.restore(direct);
    scheduleDeadline(direct, ctx);
    updateStatus(host, controller, direct, ctx);
  };

  host.registerCommand("wallclock", {
    description: "Activate and inspect enforced wall-clock control",
    handler: async (args, ctx) => {
      rememberContext(ctx);
      const [command = "status", deadline, expiryPolicy] = args.trim().split(/\s+/, 3);
      if (command === "start") {
        if (!deadline || !expiryPolicy) throw new Error("Usage: /wallclock start 30m|5pm block-new|abort-running");
        const status = activateSession(ctx, { ...parseDeadlineSpec(deadline, options.clock?.now() ?? Date.now()), expiryPolicy: parseExpiryPolicy(expiryPolicy) }, []);
        notify(ctx, `Wall-clock active: ${status.phase}, ${formatStatus(status)}`, "info");
        return;
      }
      if (command === "stop") {
        stopSession(ctx);
        notify(ctx, "Wall-clock control stopped", "info");
        return;
      }
      if (command !== "status") throw new Error("Usage: /wallclock start 30m|5pm block-new|abort-running, /wallclock status, or /wallclock stop");
      const sessionId = requireStableSession(ctx);
      notify(ctx, `${controller.context(sessionId)}\nExpiry policy: ${controller.status(sessionId).expiryPolicy ?? "none"}`, "info");
    },
  });

  registerNativeTools();

  host.on("session_start", restoreSession);
  host.on("session_switch", restoreSession);
  host.on("session_branch", restoreSession);
  host.on("session_tree", restoreSession);

  host.on("context", async (event, ctx) => {
    const scope = rememberContext(ctx, event);
    if (!scope) return undefined;
    const status = controller.status(scope.sessionId, scope.assignmentId);
    if (!status.active || !status.context) return undefined;
    const messages = Array.isArray(event?.messages) ? event.messages : [];
    return {
      messages: [
        ...messages,
        { role: "user", content: [{ type: "text", text: controller.context(scope.sessionId, scope.assignmentId) }], timestamp: status.context.currentTimeMs },
      ],
    };
  });

  host.on("before_provider_request", async (_event, ctx) => {
    const scope = rememberContext(ctx);
    if (scope) controller.beginInference(scope.sessionId);
    return undefined;
  });

  host.on("after_provider_response", async (_event, ctx) => {
    const scope = rememberContext(ctx);
    if (scope) controller.endInference(scope.sessionId);
    return undefined;
  });

  host.on("tool_execution_start", async (event, ctx) => {
    const scope = rememberContext(ctx, event);
    if (!scope) return undefined;
    const actionId = existingActionId(event);
    if (actionId) controller.beginToolCall(scope.sessionId, actionId);
    return undefined;
  });

  host.on("tool_call", async (event, ctx) => {
    const scope = rememberContext(ctx, event);
    if (!scope) return undefined;
    const toolName = String(event?.toolName ?? event?.name ?? "unknown");
    const input = event?.input;
    const action = (event?.action as ActionClass | undefined) ?? classifyAction(toolName, input);
    const actionId = existingActionId(event) ?? `wall-clock-action-${++actionSequence}`;
    if (input && typeof input === "object" && !Array.isArray(input) && "wallClockAssignmentId" in input) {
      const requested = (input as Record<string, unknown>).wallClockAssignmentId;
      if (typeof requested === "string" && requested.trim()) event.assignmentId = requested;
      delete (input as Record<string, unknown>).wallClockAssignmentId;
    }
    const assignment = resolveAssignment(controller, scope.sessionId, event, action);
    const assignmentId = assignment?.id ?? scope.assignmentId;
    controller.beginToolCall(scope.sessionId, actionId);
    const proposal: ToolProposal = {
      toolName,
      input,
      action,
      assignmentId,
      actionId,
      enforceable: true,
    };
    const decision = controller.decideTool(scope.sessionId, proposal);
    if (!decision.allow) {
      controller.endAction(scope.sessionId, actionId);
      return { block: true, reason: decision.reason };
    }
    if (!isWallClockControlTool(toolName)) {
      controller.startAction(scope.sessionId, actionId, toolName, action, assignmentId);
      actionAssignments.set(actionId, { sessionId: scope.sessionId, assignmentId });
      if (action === "delegate" && assignment) injectAssignmentContext(event, controller, scope.sessionId, assignment);
    }
    updateStatus(host, controller, scope.sessionId, ctx);
    return undefined;
  });

  host.on("tool_result", async (event, ctx) => {
    finishAction(event, ctx);
    return undefined;
  });

  host.on("tool_execution_end", async (event, ctx) => {
    finishAction(event, ctx);
    return undefined;
  });

  host.on("user_bash", async (event, ctx) => {
    const scope = rememberContext(ctx, event);
    if (!scope) return undefined;
    const actionId = `wall-clock-user-bash-${++actionSequence}`;
    const input = { command: event?.command, cwd: event?.cwd };
    controller.beginToolCall(scope.sessionId, actionId);
    const decision = controller.decideTool(scope.sessionId, {
      toolName: "user_bash",
      input,
      action: classifyAction("bash", input),
      actionId,
      enforceable: true,
    });
    if (!decision.allow) {
      controller.endAction(scope.sessionId, actionId);
      return { result: { output: `Wall-clock blocked this command: ${decision.reason}`, exitCode: 1, cancelled: true, truncated: false } };
    }
    controller.startAction(scope.sessionId, actionId, "user_bash", classifyAction("bash", input));
    return undefined;
  });

  host.on("session_shutdown", async (_event, ctx) => {
    const direct = directSessionId(ctx) ?? currentSessionId;
    if (direct) {
      persist(direct);
      clearDeadline(direct);
      latestContexts.delete(direct);
    }
    if (direct === currentSessionId) currentSessionId = undefined;
  });

  registerChildLifecycleListeners();

  return controller;

  function registerNativeTools(): void {
    host.registerTool?.({
      name: "wallclock_start",
      label: "Start wall-clock",
      description: "Start enforced wall-clock control with a deadline and expiry policy.",
      parameters: START_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<{ deadline: string; expiryPolicy: ExpiryPolicy; wrapUpMs?: number; plan?: PlanItem[] }>(args);
        const ctx = toolContext(args);
        const deadlineInput = parseDeadlineSpec(input.deadline, options.clock?.now() ?? Date.now());
        return textResult(activateSession(ctx, { ...deadlineInput, expiryPolicy: parseExpiryPolicy(input.expiryPolicy), wrapUpMs: input.wrapUpMs }, input.plan ?? []));
      },
    });

    host.registerTool?.({
      name: "wallclock_status",
      label: "Wall-clock status",
      description: "Read measured wall-clock status and elapsed-time context.",
      parameters: STATUS_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<{ assignmentId?: string }>(args);
        const ctx = toolContext(args);
        const sessionId = requireStableSession(ctx);
        return textResult(controller.status(sessionId, input.assignmentId));
      },
    });

    host.registerTool?.({
      name: "wallclock_stop",
      label: "Stop wall-clock",
      description: "Stop wall-clock control for the current host session.",
      parameters: EMPTY_SCHEMA,
      execute: async (...args: any[]) => textResult(stopSession(toolContext(args))),
    });

    host.registerTool?.({
      name: "wallclock_context",
      label: "Wall-clock context",
      description: "Read measured current time, elapsed time, phase, and permitted next action.",
      parameters: STATUS_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<{ assignmentId?: string }>(args);
        const sessionId = requireStableSession(toolContext(args));
        return textResult({ status: controller.status(sessionId, input.assignmentId), context: controller.context(sessionId, input.assignmentId) });
      },
    });

    host.registerTool?.({
      name: "wallclock_check",
      label: "Check wall-clock action",
      description: "Return the current host decision for a proposed action without replacing the host gate.",
      parameters: CHECK_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<{ toolName: string; action?: ActionClass; assignmentId?: string; input?: unknown }>(args);
        const sessionId = requireStableSession(toolContext(args));
        return textResult(controller.decideTool(sessionId, { ...input, enforceable: false }));
      },
    });

    host.registerTool?.({
      name: "wallclock_assign",
      label: "Create wall-clock assignment",
      description: "Create a bounded assignment under the active wall-clock session.",
      parameters: ASSIGNMENT_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<AssignmentInput>(args);
        const ctx = toolContext(args);
        const sessionId = requireStableSession(ctx);
        const assignment = controller.assign(sessionId, input);
        persist(sessionId);
        return textResult({ assignment, context: controller.context(sessionId, assignment.id) });
      },
    });

    host.registerTool?.({
      name: "wallclock_complete",
      label: "Complete wall-clock assignment",
      description: "Mark an assignment complete, partial, blocked, or expired using measured elapsed time.",
      parameters: COMPLETE_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<{ assignmentId: string; status: "complete" | "partial" | "blocked" | "expired" }>(args);
        const sessionId = requireStableSession(toolContext(args));
        const assignment = controller.complete(sessionId, input.assignmentId, input.status);
        persist(sessionId);
        return textResult({ assignment, status: controller.status(sessionId, input.assignmentId) });
      },
    });

    host.registerTool?.({
      name: "wallclock_report",
      label: "Record wall-clock report",
      description: "Record a vertical-slice report with evidence, validation, shortcuts, risks, and measured elapsed time.",
      parameters: REPORT_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<ChildReportInput>(args);
        const sessionId = requireStableSession(toolContext(args));
        const report = controller.report(sessionId, input);
        persist(sessionId);
        return textResult({ report, status: controller.status(sessionId, input.assignmentId) });
      },
    });

    host.registerTool?.({
      name: "wallclock_revise_plan",
      label: "Revise wall-clock plan",
      description: "Record parent plan changes after a bounded result or time contraction.",
      parameters: PLAN_REVISION_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<{ plan: PlanItem[]; reason: string }>(args);
        const sessionId = requireStableSession(toolContext(args));
        const revision = controller.setPlan(sessionId, input.plan, input.reason);
        persist(sessionId);
        return textResult({ revision, status: controller.status(sessionId) });
      },
    });
  }

  function finishAction(event: any, ctx?: RuntimeContext): void {
    const scope = rememberContext(ctx, event);
    if (!scope) return;
    const actionId = existingActionId(event);
    if (!actionId) return;
    const observed = Boolean(enforcement?.abortObserved?.(event));
    if (observed) controller.markAbortObserved(scope.sessionId, actionId);
    const finished = controller.endAction(scope.sessionId, actionId, options.clock?.now() ?? Date.now(), observed);
    if (finished) actionAssignments.delete(actionId);
  }

  function registerChildLifecycleListeners(): void {
    const lifecycle = (event: any) => {
      const parentToolCallId = typeof event?.parentToolCallId === "string" ? event.parentToolCallId : undefined;
      const linked = parentToolCallId ? actionAssignments.get(parentToolCallId) : undefined;
      const parentSessionId = linked?.sessionId ?? currentSessionId;
      const assignmentId = linked?.assignmentId
        ?? (typeof event?.assignmentId === "string" ? event.assignmentId : undefined)
        ?? (parentSessionId ? controller.assignmentForDelegation(parentSessionId)?.id : undefined);
      const childId = typeof event?.sessionFile === "string" ? event.sessionFile : typeof event?.id === "string" ? event.id : undefined;
      if (!parentSessionId || !assignmentId || !childId) return;
      if (event.status === "started") {
        controller.attachChild(parentSessionId, assignmentId, childId);
        childBindings.set(childId, { parentSessionId, assignmentId });
        persist(parentSessionId);
      } else if (event.status === "aborted" || event.status === "failed") {
        const assignmentStatus = event.status === "aborted" ? "expired" : "blocked";
        const assignment = controller.status(parentSessionId, assignmentId).assignment;
        if (assignment?.status === "active") {
          controller.complete(parentSessionId, assignmentId, assignmentStatus);
          persist(parentSessionId);
        }
        if (parentToolCallId) controller.endAction(parentSessionId, parentToolCallId, options.clock?.now() ?? Date.now(), event.status === "aborted");
      } else if (event.status === "completed" && parentToolCallId) {
        controller.endAction(parentSessionId, parentToolCallId, options.clock?.now() ?? Date.now());
      }
    };

    const childEvent = (payload: any) => {
      const childId = typeof payload?.id === "string" ? payload.id : undefined;
      const binding = childId ? childBindings.get(childId) : undefined;
      const event = payload?.event;
      if (!binding || !event || typeof event.type !== "string") return;
      const actionId = typeof event.toolCallId === "string" ? `${childId}:${event.toolCallId}` : undefined;
      if (event.type === "turn_start") controller.beginInference(binding.parentSessionId);
      else if (event.type === "turn_end") controller.endInference(binding.parentSessionId);
      else if (event.type === "tool_execution_start" && actionId) {
        controller.beginToolCall(binding.parentSessionId, actionId);
        controller.startAction(binding.parentSessionId, actionId, String(event.toolName ?? "child-tool"), classifyAction(String(event.toolName ?? "child-tool"), event.args), binding.assignmentId);
      } else if (event.type === "tool_execution_end" && actionId) {
        const observed = Boolean(enforcement?.abortObserved?.(event));
        controller.endAction(binding.parentSessionId, actionId, options.clock?.now() ?? Date.now(), observed);
      }
    };

    if (host.events) {
      host.events.on("task:subagent:lifecycle", lifecycle);
      host.events.on("task:subagent:event", childEvent);
    } else {
      host.on("task:subagent:lifecycle", lifecycle as any);
      host.on("task:subagent:event", childEvent as any);
    }
  }
}

function resolveAssignment(controller: WallClockController, sessionId: string, event: any, action: ActionClass): Assignment | undefined {
  if (action !== "delegate") return undefined;
  const explicit = typeof event?.assignmentId === "string" ? event.assignmentId : undefined;
  if (explicit) return controller.status(sessionId, explicit).assignment;
  return controller.assignmentForDelegation(sessionId);
}

function injectAssignmentContext(event: any, controller: WallClockController, sessionId: string, assignment: Assignment): void {
  const context = controller.context(sessionId, assignment.id);
  const input = event?.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const inputObject = input as Record<string, unknown>;
  if (typeof inputObject.context === "string") inputObject.context = `${inputObject.context}\n\n${context}`;
  else inputObject.context = context;
  if (typeof inputObject.task === "string") inputObject.task = `${context}\n\n${inputObject.task}`;
  if (Array.isArray(inputObject.tasks)) {
    inputObject.tasks = inputObject.tasks.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const task = item as Record<string, unknown>;
      return typeof task.task === "string" ? { ...task, task: `${context}\n\n${task.task}` } : task;
    });
  }
}

function existingActionId(event: any): string | undefined {
  const id = event?.toolCallId ?? event?.callId ?? event?.id;
  return typeof id === "string" && id.trim() ? id : undefined;
}

function parseExpiryPolicy(value: string): ExpiryPolicy {
  if (value === "block-new" || value === "abort-running") return value;
  throw new Error("Expiry policy must be block-new or abort-running");
}

function notify(ctx: RuntimeContext | undefined, message: string, level = "info"): void {
  ctx?.ui?.notify?.(message, level);
}

function updateStatus(host: RuntimeHost, controller: WallClockController, sessionId: string, ctx?: RuntimeContext): void {
  const status = controller.status(sessionId);
  const value = status.active && status.expiryPolicy
    ? `${status.phase} ${Math.ceil(status.remainingMs / 1_000)}s (${status.expiryPolicy})`
    : undefined;
  if (ctx?.ui?.setStatus) ctx.ui.setStatus("wall-clock", value);
  else host.setStatus?.("wall-clock", value);
}

function formatStatus(status: { phase: string; remainingMs: number; expiryPolicy?: string }): string {
  return `${status.phase}, ${Math.ceil(status.remainingMs / 1_000)}s remaining (${status.expiryPolicy ?? "none"})`;
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
  return args.find((candidate) => candidate?.sessionManager || candidate?.sessionId || candidate?.abort);
}

const EMPTY_SCHEMA = { type: "object", additionalProperties: false, properties: {} };

const PLAN_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "status"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    status: { type: "string", enum: ["pending", "active", "complete", "blocked", "deferred"] },
  },
};
const START_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["deadline", "expiryPolicy"],
  properties: {
    deadline: { type: "string", description: "A positive duration or future local time, for example 30m or 5pm." },
    expiryPolicy: { type: "string", enum: ["block-new", "abort-running"] },
    wrapUpMs: { type: "number", exclusiveMinimum: 0 },
    plan: { type: "array", items: PLAN_ITEM_SCHEMA },
  },
};

const STATUS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { assignmentId: { type: "string" } },
};

const CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["toolName"],
  properties: {
    toolName: { type: "string", minLength: 1 },
    input: {},
    action: { type: "string", enum: ["read", "write", "destructive", "delegate", "finalize", "other"] },
    assignmentId: { type: "string" },
  },
};

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


const PLAN_REVISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["plan", "reason"],
  properties: { plan: { type: "array", items: PLAN_ITEM_SCHEMA }, reason: { type: "string" } },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
