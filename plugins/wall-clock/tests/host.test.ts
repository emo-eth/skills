import assert from "node:assert/strict";
import test from "node:test";
import { WallClockController } from "../src/controller.ts";
import { installHostExtension } from "../src/host.ts";
import { MemoryStore } from "../src/store.ts";

class FakeHost {
  readonly handlers = new Map<string, (event: any, ctx: any) => unknown>();
  readonly eventHandlers = new Map<string, (event: any) => unknown>();
  readonly commands = new Map<string, any>();
  readonly tools = new Map<string, any>();
  readonly entries: Array<{ customType: string; data: unknown }> = [];
  readonly statuses = new Map<string, string | undefined>();

  readonly events = {
    on: (event: string, handler: (payload: any) => unknown): void => {
      this.eventHandlers.set(event, handler);
    },
  };

  on(event: string, handler: (payload: any, ctx: any) => unknown): void {
    this.handlers.set(event, handler);
  }

  registerCommand(name: string, options: any): void {
    this.commands.set(name, options);
  }

  registerTool(definition: any): void {
    this.tools.set(definition.name, definition);
  }

  appendEntry(customType: string, data: unknown): void {
    this.entries.push({ customType, data });
  }

  setStatus(key: string, value: string | undefined): void {
    this.statuses.set(key, value);
  }

  async emit(event: string, payload: unknown, ctx: unknown): Promise<unknown> {
    return this.handlers.get(event)?.(payload, ctx);
  }

  async emitBus(event: string, payload: unknown): Promise<unknown> {
    return this.eventHandlers.get(event)?.(payload);
  }
}

function context(sessionId = "main", entries: unknown[] = [], abort?: () => void) {
  return {
    sessionId,
    sessionManager: {
      getSessionFile: () => sessionId,
      getEntries: () => entries,
    },
    ui: { notify: () => undefined, setStatus: () => undefined },
    abort,
  };
}

function activationInput(expiryPolicy: "block-new" | "abort-running" = "block-new") {
  return { durationMs: 10_000, wrapUpMs: 2_000, expiryPolicy } as const;
}

test("activation fails closed without a tested host enforcement seam", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, { controller });
  await assert.rejects(
    host.commands.get("wallclock").handler("start 30m block-new", context()),
    /no tested pre-action blocking seam/,
  );
});

test("Pi-shaped host injects measured context and blocks expired work before execution", async () => {
  let now = 1_000;
  const controller = new WallClockController({ now: () => now }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: { name: "fake-pi", canBlockNew: true },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  });
  const ctx = context();

  await host.emit("session_start", {}, ctx);
  await host.commands.get("wallclock").handler("start 10s block-new", ctx);
  const contextResult = await host.emit("context", { messages: [{ role: "user", content: "existing" }] }, ctx) as any;
  assert.equal(contextResult.messages.length, 2);
  assert.match(contextResult.messages[1].content[0].text, /Latest inference elapsed/);
  assert.match(contextResult.messages[1].content[0].text, /Expiry policy: block-new/);

  now += 10_000;
  const blocked = await host.emit("tool_call", { toolCallId: "expired-call", toolName: "read", input: {} }, ctx) as any;
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /expired/);
});

test("native assignment tool accepts Pi argument order and persists state", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: { name: "fake-pi", canBlockNew: true },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  });
  const ctx = context();
  await host.commands.get("wallclock").handler("start 60s block-new", ctx);

  const result = await host.tools.get("wallclock_assign").execute("call-1", {
    parentPlanItemId: "item-1",
    objective: "Inspect one module",
    scope: ["src"],
    acceptance: ["Return evidence"],
    budgetMs: 5_000,
  }, undefined, undefined, ctx) as any;
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.assignment.parentPlanItemId, "item-1");
  assert.equal(host.entries.at(-1)?.customType, "wall-clock-state");
  assert.match(payload.context, /Assignment assignment-1/);
});

test("abort-running requests an abort and only finishes after observed cancellation", async () => {
  let now = 1_000;
  let scheduled: (() => void) | undefined;
  let abortCalls = 0;
  const controller = new WallClockController({ now: () => now }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: {
      name: "fake-omp",
      canBlockNew: true,
      abortRunning: async ({ context: runningContext }) => {
        abortCalls += 1;
        runningContext?.abort?.();
      },
      abortObserved: (event) => Boolean((event as any)?.aborted),
    },
    schedule: (callback) => {
      scheduled = callback;
      return "timer";
    },
    cancelSchedule: () => undefined,
  });
  let aborted = 0;
  const ctx = context("main", [], () => { aborted += 1; });
  await host.commands.get("wallclock").handler("start 10s abort-running", ctx);
  await host.emit("tool_call", { toolCallId: "running-call", toolName: "bash", input: { command: "sleep" } }, ctx);
  now += 10_000;
  scheduled?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(abortCalls, 1);
  assert.equal(aborted, 1);
  assert.equal(controller.runningActions("main").length, 1);

  await host.emit("tool_execution_end", { toolCallId: "running-call", aborted: true }, ctx);
  assert.equal(controller.runningActions("main").length, 0);
});

test("OMP-shaped child lifecycle binds assignments and injects child context", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: { name: "fake-omp", canBlockNew: true },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  });
  const ctx = context();
  await host.commands.get("wallclock").handler("start 60s block-new", ctx);
  const assignment = controller.assign("main", {
    parentPlanItemId: "item-1",
    objective: "Build a working slice",
    scope: ["src"],
    acceptance: ["The slice runs"],
    budgetMs: 20_000,
  });

  const taskEvent: any = { toolCallId: "task-call", toolName: "task", input: { wallClockAssignmentId: assignment.id, task: "Inspect the module" } };
  await host.emit("tool_call", taskEvent, ctx);
  assert.equal(taskEvent.input.wallClockAssignmentId, undefined);
  assert.match(taskEvent.input.task, /Assignment assignment-1/);

  await host.emitBus("task:subagent:lifecycle", { id: "child-agent", sessionFile: "child-session", status: "started", parentToolCallId: "task-call" });
  assert.equal(controller.status("main", assignment.id).assignment?.childSessionId, "child-session");
  const childContext = await host.emit("context", { messages: [] }, context("child-session")) as any;
  assert.match(childContext.messages[0].content[0].text, /Assignment elapsed/);

  await host.emitBus("task:subagent:event", { id: "child-agent", event: { type: "turn_start" } });
  await host.emitBus("task:subagent:event", { id: "child-agent", event: { type: "turn_end" } });
  assert.equal(controller.turnContext("main", assignment.id)?.assignmentId, assignment.id);
});
