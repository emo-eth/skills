import assert from "node:assert/strict";
import test from "node:test";
import wallClockOmpExtension from "../src/omp.ts";
import wallClockPiExtension from "../src/pi.ts";

class EventBus {
  readonly handlers = new Map<string, Array<(event: any) => unknown>>();

  on(event: string, handler: (event: any) => unknown): void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }
}

class Host {
  readonly handlers = new Map<string, (event: any, ctx: any) => unknown>();
  readonly commands = new Map<string, any>();
  readonly tools = new Map<string, any>();
  readonly events: EventBus;

  constructor(events = new EventBus()) {
    this.events = events;
  }

  on(event: string, handler: (event: any, ctx: any) => unknown): void { this.handlers.set(event, handler); }
  registerCommand(name: string, options: any): void { this.commands.set(name, options); }
  registerTool(definition: any): void { this.tools.set(definition.name, definition); }
  appendEntry(): void {}
  setStatus(): void {}
  emit(event: string, payload: unknown, ctx: unknown): unknown { return this.handlers.get(event)?.(payload, ctx); }
}

function context(sessionId = "main") {
  return {
    sessionId,
    sessionManager: { getSessionFile: () => sessionId, getEntries: () => [] },
    abort: () => undefined,
    signal: new AbortController().signal,
  };
}

test("OMP extension instances on one native event bus share one controller", () => {
  const events = new EventBus();
  const parent = new Host(events);
  const child = new Host(events);
  const parentController = wallClockOmpExtension(parent as any);
  const childController = wallClockOmpExtension(child as any);
  assert.ok(parentController);
  assert.equal(parentController, childController);
});

test("Pi abort-running admits verified native tools and rejects unknown extension tools", async () => {
  const host = new Host();
  wallClockPiExtension(host as any);
  const ctx = context();
  await host.commands.get("wallclock").handler("start 60s abort-running", ctx);

  const bash = await host.emit("tool_call", { toolCallId: "bash-call", toolName: "bash", input: { command: "pwd" } }, ctx);
  assert.equal(bash, undefined);
  const unknown = await host.emit("tool_call", { toolCallId: "unknown-call", toolName: "third_party_tool", input: {} }, ctx) as any;
  assert.equal(unknown.block, true);
  assert.match(unknown.reason, /cannot prove that this action can be aborted/);
});

test("OMP abort-running admits the native task executor", async () => {
  const host = new Host();
  const controller = wallClockOmpExtension(host as any);
  const ctx = context();
  await host.commands.get("wallclock").handler("start 60s abort-running", ctx);
  controller.assign("main", {
    parentPlanItemId: "one",
    objective: "One child",
    scope: ["one"],
    acceptance: ["done"],
    budgetMs: 5_000,
  });

  const task = await host.emit("tool_call", { toolCallId: "task-call", toolName: "task", input: { task: "Do work" } }, ctx);
  assert.equal(task, undefined);
});
