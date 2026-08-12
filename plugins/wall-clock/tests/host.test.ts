import assert from "node:assert/strict";
import test from "node:test";
import { WallClockController } from "../src/controller.ts";
import { createHostCoordination, installHostExtension } from "../src/host.ts";
import { MemoryStore } from "../src/store.ts";

class FakeEventBus {
  readonly handlers = new Map<string, Set<(event: any) => unknown>>();

  on(event: string, handler: (payload: any) => unknown): void {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
  }

  async emit(event: string, payload: unknown): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) await handler(payload);
  }
}

class FakeHost {
  readonly handlers = new Map<string, (event: any, ctx: any) => unknown>();
  readonly commands = new Map<string, any>();
  readonly tools = new Map<string, any>();
  readonly entries: Array<{ customType: string; data: unknown }> = [];
  readonly userMessages: unknown[] = [];
  readonly userMessageOptions: unknown[] = [];
  readonly statuses = new Map<string, string | undefined>();
  readonly events: FakeEventBus;

  constructor(events = new FakeEventBus()) {
    this.events = events;
  }

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

  sendUserMessage(message: unknown, options?: unknown): void {
    this.userMessages.push(message);
    this.userMessageOptions.push(options);
  }

  setStatus(key: string, value: string | undefined): void {
    this.statuses.set(key, value);
  }

  async emit(event: string, payload: unknown, ctx: unknown): Promise<unknown> {
    return this.handlers.get(event)?.(payload, ctx);
  }

  async emitBus(event: string, payload: unknown): Promise<unknown> {
    return this.events.emit(event, payload);
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

test("wallclock starts from a deadline and defaults to abort-running", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: {
      name: "fake-omp",
      canBlockNew: true,
      canAbortAction: () => true,
      abortRunning: () => undefined,
      abortObserved: () => true,
    },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  });

  await host.commands.get("wallclock").handler("5m", context());

  const status = controller.status("main");
  assert.equal(status.active, true);
  assert.equal(status.expiryPolicy, "abort-running");
});

test("wallclock forwards the trailing prompt after activation", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  const sendUserMessage = host.sendUserMessage.bind(host);
  host.sendUserMessage = (message, options) => {
    assert.equal(controller.status("main").active, true);
    sendUserMessage(message, options);
  };
  installHostExtension(host as any, {
    controller,
    enforcement: {
      name: "fake-omp",
      canBlockNew: true,
      canAbortAction: () => true,
      abortRunning: () => undefined,
      abortObserved: () => true,
    },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  });

  await host.commands.get("wallclock").handler("5m fix merge conflicts in all open PRs", context());

  assert.equal(controller.status("main").expiryPolicy, "abort-running");
  assert.deepEqual(host.userMessages, ["fix merge conflicts in all open PRs"]);
});

test("wallclock accepts abort as the short expiry policy", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: {
      name: "fake-omp",
      canBlockNew: true,
      canAbortAction: () => true,
      abortRunning: () => undefined,
      abortObserved: () => true,
    },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  });

  await host.commands.get("wallclock").handler("start 5m abort", context());

  assert.equal(controller.status("main").expiryPolicy, "abort-running");
});

test("wallclock honors explicit start and block-new before forwarding a prompt", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: { name: "fake-omp", canBlockNew: true },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  });

  await host.commands.get("wallclock").handler("start 5m block-new inspect the failing tests", context());

  assert.equal(controller.status("main").expiryPolicy, "block-new");
  assert.deepEqual(host.userMessages, ["inspect the failing tests"]);
});

test("wallclock forwards its prompt as normal steering during an active turn", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: {
      name: "fake-omp",
      canBlockNew: true,
      canAbortAction: () => true,
      abortRunning: () => undefined,
      abortObserved: () => true,
    },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  });

  await host.commands.get("wallclock").handler(
    "5m resolve the remaining conflicts",
    { ...context(), isIdle: () => false },
  );

  assert.deepEqual(host.userMessages, ["resolve the remaining conflicts"]);
  assert.deepEqual(host.userMessageOptions, [{ deliverAs: "steer" }]);
});

test("active wallclock status refreshes from the host clock", async () => {
  let now = 1_000;
  const scheduledStatus: Array<() => void> = [];
  const displayedStatuses = new Map<string, string | undefined>();
  const controller = new WallClockController({ now: () => now }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: { name: "fake-omp", canBlockNew: true },
    clock: { now: () => now },
    schedule: () => "deadline",
    cancelSchedule: () => undefined,
    scheduleStatus: (callback) => {
      scheduledStatus.push(callback);
      return callback;
    },
    cancelStatusSchedule: () => undefined,
  });
  const ctx = {
    ...context(),
    ui: {
      notify: () => undefined,
      setStatus: (key: string, value: string | undefined) => { displayedStatuses.set(key, value); },
    },
  };

  await host.commands.get("wallclock").handler("5s block-new", ctx);
  assert.equal(displayedStatuses.get("wall-clock"), "active 5s (block-new)");

  now = 2_100;
  scheduledStatus[0]?.();
  assert.equal(displayedStatuses.get("wall-clock"), "active 4s (block-new)");

  now = 7_000;
  scheduledStatus[1]?.();
  assert.equal(displayedStatuses.get("wall-clock"), "expired 0s (block-new)");
  assert.equal(scheduledStatus.length, 2);
});

test("inactive host sessions do not change delegation or ordinary tool calls", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: { name: "fake-omp", canBlockNew: true },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  });
  const ctx = context();
  assert.equal(await host.emit("tool_call", { toolCallId: "inactive-task", toolName: "task", input: { task: "Normal work" } }, ctx), undefined);
  assert.equal(await host.emit("tool_call", { toolCallId: "inactive-read", toolName: "read", input: {} }, ctx), undefined);
  assert.equal(controller.runningActions("main").length, 0);
});

test("do-it-now arms a bounded fast lane and blocks delegation", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: {
      name: "fake-omp",
      canBlockNew: true,
      canAbortAction: () => true,
      abortRunning: () => undefined,
      abortObserved: () => true,
    },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  });
  const ctx = context();
  await host.emit("before_agent_start", {
    type: "before_agent_start",
    prompt: [
      '[IMPORTANT: User invoked the "do-it-now" skill; follow its instructions. Full skill below.]',
      "# Do It Now",
      "---",
      "[Skill directory: /skills/do-it-now]",
      "User: update the ticket title",
    ].join("\n"),
  }, ctx);

  assert.equal(controller.status("main").expiryPolicy, "abort-running");
  assert.equal(controller.status("main").remainingMs, 120_000);
  const contextResult = await host.emit("context", { messages: [] }, ctx) as any;
  assert.match(contextResult.messages[0].content[0].text, /update the ticket title/);
  assert.match(contextResult.messages[0].content[0].text, /12 tool calls remain/);

  const delegated = await host.emit("tool_call", {
    toolCallId: "delegated",
    toolName: "task",
    input: { task: "Update the title" },
  }, ctx) as any;
  assert.equal(delegated.block, true);
  assert.match(delegated.reason, /blocks delegation/);

  for (let index = 0; index < 12; index += 1) {
    const toolCallId = `fast-lane-${index}`;
    assert.equal(await host.emit("tool_call", { toolCallId, toolName: "read", input: {} }, ctx), undefined);
    await host.emit("tool_result", { toolCallId, toolName: "read", isError: false }, ctx);
  }
  const overLimit = await host.emit("tool_call", {
    toolCallId: "over-limit",
    toolName: "read",
    input: {},
  }, ctx) as any;
  assert.equal(overLimit.block, true);
  assert.match(overLimit.reason, /12-tool limit/);
});

test("do-it-now custom skill messages arm the host guard", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: {
      name: "fake-pi",
      canBlockNew: true,
      canAbortAction: () => true,
      abortRunning: () => undefined,
      abortObserved: () => true,
    },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  });
  await host.emit("message_start", {
    type: "message_start",
    message: {
      role: "custom",
      details: { name: "do-it-now", args: "refresh the list" },
      content: "skill body",
    },
  }, context());

  assert.equal(controller.status("main").expiryPolicy, "abort-running");
  const contextResult = await host.emit("context", { messages: [] }, context()) as any;
  assert.match(contextResult.messages[0].content[0].text, /refresh the list/);
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

test("session switches clear old timers and restore only the selected session", async () => {
  let timerSequence = 0;
  const cancelled: number[] = [];
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: { name: "fake-pi", canBlockNew: true },
    schedule: () => ++timerSequence,
    cancelSchedule: (handle) => { cancelled.push(handle as number); },
  });
  const mainCtx = context("main");
  await host.commands.get("wallclock").handler("start 60s block-new", mainCtx);
  const mainState = controller.snapshot("main")!;
  await host.emit("session_switch", {}, context("other"));
  assert.deepEqual(cancelled, [1]);
  assert.equal(controller.status("other").active, false);

  await host.emit("session_switch", {}, context("main", [
    { type: "custom", customType: "wall-clock-state", data: mainState },
  ]));
  assert.equal(controller.status("main").active, true);
  assert.equal(timerSequence, 2);
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
      canAbortAction: () => true,
      abortRunning: async ({ targets }) => {
        abortCalls += 1;
        for (const target of targets) target.context.abort?.();
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

test("abort-running blocks an action whose executor cannot prove cancellation", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: {
      name: "fake-host",
      canBlockNew: true,
      canAbortAction: (proposal) => proposal.toolName === "bash",
      abortRunning: () => undefined,
      abortObserved: () => true,
    },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  });
  const ctx = context();
  await host.commands.get("wallclock").handler("start 10s abort-running", ctx);

  const blocked = await host.emit("tool_call", { toolCallId: "custom-call", toolName: "mcp_custom", input: {} }, ctx) as any;
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /cannot prove that this action can be aborted/);
  assert.equal(controller.runningActions("main").length, 0);
  const missingId = await host.emit("tool_call", { toolName: "bash", input: { command: "pwd" } }, ctx) as any;
  assert.equal(missingId.block, true);
  assert.match(missingId.reason, /action identifier/);
});

test("abort-running serializes admitted work because host abort is session-wide", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: {
      name: "fake-host",
      canBlockNew: true,
      canAbortAction: () => true,
      abortRunning: () => undefined,
      abortObserved: () => true,
    },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  });
  const ctx = context();
  await host.commands.get("wallclock").handler("start 60s abort-running", ctx);
  assert.equal(await host.emit("tool_call", { toolCallId: "one", toolName: "bash", input: { command: "sleep 1" } }, ctx), undefined);
  const blocked = await host.emit("tool_call", { toolCallId: "two", toolName: "read", input: {} }, ctx) as any;
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /one admitted action at a time/);
});

test("abort-running admits child work in a separate host session", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const coordination = createHostCoordination(controller);
  const events = new FakeEventBus();
  const parentHost = new FakeHost(events);
  const childHost = new FakeHost(events);
  const options = {
    coordination,
    enforcement: {
      name: "fake-omp",
      canBlockNew: true,
      canAbortAction: () => true,
      abortRunning: () => undefined,
      abortObserved: () => true,
    },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  } as const;
  installHostExtension(parentHost as any, options);
  installHostExtension(childHost as any, options);
  const parentCtx = context("main", [], () => undefined);
  await parentHost.commands.get("wallclock").handler("start 60s abort-running", parentCtx);
  controller.assign("main", {
    parentPlanItemId: "one",
    objective: "One child",
    scope: ["one"],
    acceptance: ["done"],
    budgetMs: 5_000,
  });
  assert.equal(await parentHost.emit("tool_call", { toolCallId: "task-call", toolName: "task", input: { task: "Do work" } }, parentCtx), undefined);
  await events.emit("task:subagent:lifecycle", { id: "child", sessionFile: "child-session", status: "started", parentToolCallId: "task-call" });

  const childCtx = context("child-session", [], () => undefined);
  await childHost.emit("session_start", {}, childCtx);
  assert.equal(await childHost.emit("tool_call", { toolCallId: "child-read", toolName: "read", input: {} }, childCtx), undefined);
  assert.equal(controller.runningActions("main").length, 2);
});

test("parent and child action identifiers are isolated by native session", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const coordination = createHostCoordination(controller);
  const events = new FakeEventBus();
  const parentHost = new FakeHost(events);
  const childHost = new FakeHost(events);
  const options = {
    coordination,
    enforcement: { name: "fake-omp", canBlockNew: true },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  } as const;
  installHostExtension(parentHost as any, options);
  installHostExtension(childHost as any, options);
  const parentCtx = context("main");
  await parentHost.commands.get("wallclock").handler("start 60s block-new", parentCtx);
  controller.assign("main", {
    parentPlanItemId: "one",
    objective: "One child",
    scope: ["one"],
    acceptance: ["done"],
    budgetMs: 5_000,
  });
  await parentHost.emit("tool_call", { toolCallId: "same-id", toolName: "task", input: { task: "Do work" } }, parentCtx);
  await events.emit("task:subagent:lifecycle", { id: "child", sessionFile: "child-session", status: "started", parentToolCallId: "same-id" });
  const childCtx = context("child-session");
  await childHost.emit("session_start", {}, childCtx);
  await childHost.emit("tool_call", { toolCallId: "same-id", toolName: "read", input: {} }, childCtx);
  assert.equal(controller.runningActions("main").length, 2);

  await childHost.emit("tool_result", { toolCallId: "same-id", toolName: "read", isError: false }, childCtx);
  assert.deepEqual(controller.runningActions("main").map((action) => action.toolName), ["task"]);
  await events.emit("task:subagent:lifecycle", { id: "child", sessionFile: "child-session", status: "completed", parentToolCallId: "same-id" });
  assert.equal(controller.runningActions("main").length, 0);
});

test("delegation requires exactly one unbound assignment and blocks batch tasks", async () => {
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

  const missing = await host.emit("tool_call", { toolCallId: "task-1", toolName: "task", input: { task: "Do work" } }, ctx) as any;
  assert.equal(missing.block, true);
  assert.match(missing.reason, /exactly one active, unbound/);

  controller.assign("main", { parentPlanItemId: "one", objective: "One", scope: ["one"], acceptance: ["done"], budgetMs: 5_000 });
  const batch = await host.emit("tool_call", { toolCallId: "task-2", toolName: "task", input: { tasks: [{ task: "One" }] } }, ctx) as any;
  assert.equal(batch.block, true);
  assert.match(batch.reason, /batch delegation is blocked/);
});

test("inference timing ends when the assistant message stream ends", async () => {
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
  await host.commands.get("wallclock").handler("start 60s block-new", ctx);
  await host.emit("before_provider_request", {}, ctx);
  now = 1_100;
  await host.emit("after_provider_response", {}, ctx);
  assert.equal(controller.turnContext("main")?.latestInferenceElapsedMs, 0);
  now = 1_400;
  await host.emit("message_end", { message: { role: "assistant" } }, ctx);
  assert.equal(controller.turnContext("main")?.latestInferenceElapsedMs, 400);
});

test("an assignment deadline aborts work admitted for that assignment", async () => {
  let now = 1_000;
  const scheduled: Array<() => void> = [];
  const abortRequests: any[] = [];
  const controller = new WallClockController({ now: () => now }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: {
      name: "fake-omp",
      canBlockNew: true,
      canAbortAction: () => true,
      abortRunning: (request) => { abortRequests.push(request); },
      abortObserved: (event) => Boolean((event as any)?.aborted),
    },
    schedule: (callback) => { scheduled.push(callback); return callback; },
    cancelSchedule: () => undefined,
  });
  const ctx = context("main", [], () => undefined);
  await host.commands.get("wallclock").handler("start 60s abort-running", ctx);
  await host.tools.get("wallclock_assign").execute("assignment-call", {
    parentPlanItemId: "one",
    objective: "One",
    scope: ["one"],
    acceptance: ["done"],
    budgetMs: 5_000,
  }, undefined, undefined, ctx);
  await host.emit("tool_call", { toolCallId: "child-task", toolName: "task", input: { task: "Do work" } }, ctx);

  now = 6_000;
  scheduled[1]?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(abortRequests.length, 1);
  assert.equal(abortRequests[0].assignmentId, "assignment-1");
  assert.equal(abortRequests[0].targets.length, 1);
  assert.match(abortRequests[0].targets[0].actionId, /child-task/);
});

test("coincident parent and assignment deadlines request each action abort once", async () => {
  let now = 1_000;
  const scheduled: Array<() => void> = [];
  const abortRequests: any[] = [];
  const controller = new WallClockController({ now: () => now }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, {
    controller,
    enforcement: {
      name: "fake-omp",
      canBlockNew: true,
      canAbortAction: () => true,
      abortRunning: (request) => { abortRequests.push(request); },
      abortObserved: () => true,
    },
    schedule: (callback) => { scheduled.push(callback); return callback; },
    cancelSchedule: () => undefined,
  });
  const ctx = context("main", [], () => undefined);
  await host.commands.get("wallclock").handler("start 60s abort-running", ctx);
  await host.tools.get("wallclock_assign").execute("assignment-call", {
    parentPlanItemId: "one",
    objective: "One",
    scope: ["one"],
    acceptance: ["done"],
    budgetMs: 60_000,
  }, undefined, undefined, ctx);
  await host.emit("tool_call", { toolCallId: "child-task", toolName: "task", input: { task: "Do work" } }, ctx);

  now = 61_000;
  scheduled[0]?.();
  scheduled[1]?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(abortRequests.length, 1);
  assert.equal(abortRequests[0].targets.length, 1);
});

test("OMP-shaped parent and child instances share assignment enforcement and persistence", async () => {
  let now = 1_000;
  const controller = new WallClockController({ now: () => now }, new MemoryStore());
  const coordination = createHostCoordination(controller);
  const events = new FakeEventBus();
  const parentHost = new FakeHost(events);
  const childHost = new FakeHost(events);
  const hostOptions = {
    coordination,
    enforcement: { name: "fake-omp", canBlockNew: true },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  } as const;
  installHostExtension(parentHost as any, hostOptions);
  installHostExtension(childHost as any, hostOptions);
  const ctx = context();
  await parentHost.emit("session_start", {}, ctx);
  await parentHost.commands.get("wallclock").handler("start 60s block-new", ctx);
  const assignment = controller.assign("main", {
    parentPlanItemId: "item-1",
    objective: "Build a working slice",
    scope: ["src"],
    acceptance: ["The slice runs"],
    budgetMs: 20_000,
  });

  const taskEvent: any = { toolCallId: "task-call", toolName: "task", input: { task: "Inspect the module" } };
  await parentHost.emit("tool_call", taskEvent, ctx);
  assert.match(taskEvent.input.task, /Assignment assignment-1/);

  await events.emit("task:subagent:lifecycle", { id: "child-agent", sessionFile: "child-session", status: "started", parentToolCallId: "task-call" });
  assert.equal(controller.status("main", assignment.id).assignment?.childSessionId, "child-session");
  const childCtx = context("child-session");
  await childHost.emit("session_start", {}, childCtx);
  const childContext = await childHost.emit("context", { messages: [] }, childCtx) as any;
  assert.match(childContext.messages[0].content[0].text, /Assignment elapsed/);
  const prematureYield = await childHost.emit("tool_call", {
    toolCallId: "premature-yield",
    toolName: "yield",
    input: { result: { data: "not reported" } },
  }, childCtx) as any;
  assert.equal(prematureYield.block, true);
  assert.match(prematureYield.reason, /wallclock_report/);
  await assert.rejects(
    childHost.commands.get("wallclock").handler("stop", childCtx),
    /owned by this child session's parent/,
  );
  assert.equal(controller.status("main").active, true);
  const siblingAssignment = controller.assign("main", {
    parentPlanItemId: "item-2",
    objective: "Other work",
    scope: ["other"],
    acceptance: ["Other evidence"],
    budgetMs: 10_000,
  });
  await assert.rejects(
    childHost.tools.get("wallclock_status").execute("status-call", { assignmentId: siblingAssignment.id }, undefined, undefined, childCtx),
    /only inspect its own assignment/,
  );

  now += 20_000;
  const blocked = await childHost.emit("tool_call", { toolCallId: "late-child-call", toolName: "read", input: {} }, childCtx) as any;
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /expired/);

  const report = await childHost.tools.get("wallclock_report").execute("report-call", {
    assignmentId: assignment.id,
    status: "partial",
    completed: ["Inspected the module"],
    evidence: ["src/module.ts"],
    partial: ["No edit"],
    skipped: ["Integration test"],
    validation: ["Read only"],
    shortcuts: [{ choice: "Stopped at expiry", tradeoff: "No implementation" }],
    risks: ["Untested"],
    unknowns: ["Runtime behavior"],
    recommendedParentAction: "Implement the edit",
  }, undefined, undefined, childCtx) as any;
  assert.equal(JSON.parse(report.content[0].text).report.expiryPolicy, "block-new");
  assert.equal((parentHost.entries.at(-1)?.data as any).reports[0].assignmentId, assignment.id);
  const allowedYield = await childHost.emit("tool_call", {
    toolCallId: "reported-yield",
    toolName: "yield",
    input: { result: { data: "reported" } },
  }, childCtx);
  assert.equal(allowedYield, undefined);
});

test("a child lifecycle end without a report produces a blocked fallback report", async () => {
  let now = 1_000;
  const controller = new WallClockController({ now: () => now }, new MemoryStore());
  const coordination = createHostCoordination(controller);
  const events = new FakeEventBus();
  const host = new FakeHost(events);
  installHostExtension(host as any, {
    coordination,
    enforcement: { name: "fake-omp", canBlockNew: true },
    schedule: () => "timer",
    cancelSchedule: () => undefined,
  });
  const ctx = context();
  await host.commands.get("wallclock").handler("start 60s block-new", ctx);
  const assignment = controller.assign("main", {
    parentPlanItemId: "one",
    objective: "One child",
    scope: ["one"],
    acceptance: ["evidence"],
    budgetMs: 10_000,
  });
  await host.emit("tool_call", { toolCallId: "task-call", toolName: "task", input: { task: "Do work" } }, ctx);
  await events.emit("task:subagent:lifecycle", { id: "child", sessionFile: "child-session", status: "started", parentToolCallId: "task-call" });
  await host.emit("tool_result", { toolCallId: "task-call", toolName: "task", isError: false }, ctx);
  now = 2_000;
  await events.emit("task:subagent:lifecycle", { id: "child", sessionFile: "child-session", status: "completed", parentToolCallId: "task-call" });

  const snapshot = controller.snapshot("main");
  assert.equal(snapshot?.assignments[0]?.status, "blocked");
  assert.equal(snapshot?.reports[0]?.status, "blocked");
  assert.match(snapshot?.reports[0]?.skipped[0] ?? "", /ended without wallclock_report/);
  assert.equal(coordination.childBindings.has("child"), false);
  assert.equal(coordination.childBindings.has("child-session"), false);
});
