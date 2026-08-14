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

test("OMP and Pi accept an abortable provider request and fail closed without one", async () => {
  const cases: Array<{ label: string; install: (host: Host) => unknown }> = [
    { label: "OMP", install: (host) => wallClockOmpExtension(host as any) },
    { label: "Pi", install: (host) => wallClockPiExtension(host as any) },
  ];
  for (const { label, install } of cases) {
    const host = new Host();
    install(host as any);
    const ctx = context();
    await host.commands.get("wallclock").handler("turn-limit 2m abort-running", ctx);

    const abortable = { ...ctx, signal: new AbortController().signal, abort: () => undefined };
    assert.equal(await host.emit("before_provider_request", {}, abortable), undefined);

    const notAbortable = { ...ctx, signal: undefined };
    await assert.rejects(host.emit("before_provider_request", {}, notAbortable), /not abortable/);
    assert.ok(label.length > 0);
  }
});

test("OMP and Pi abort the active provider request once at expiry", async () => {
  // The adapter wrappers install the extension without a schedule/clock seam,
  // so the abort must be exercised against the platform clock. Polling for the
  // observable abort side-effect (not a fixed sleep) keeps it bounded.
  const cases: Array<{ label: string; install: (host: Host) => unknown }> = [
    { label: "OMP", install: (host) => wallClockOmpExtension(host as any) },
    { label: "Pi", install: (host) => wallClockPiExtension(host as any) },
  ];
  for (const { label, install } of cases) {
    const host = new Host();
    install(host as any);
    let aborted = 0;
    const ctx = context("main");
    ctx.abort = () => { aborted += 1; };
    await host.commands.get("wallclock").handler("turn-limit 30ms abort-running", ctx);
    await host.emit("before_provider_request", {}, ctx);
    const deadline = Date.now() + 2_000;
    while (aborted === 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(aborted, 1, label);
  }
});
