import assert from "node:assert/strict";
import test from "node:test";
import { WallClockController } from "../src/controller.ts";
import { installHostExtension } from "../src/host.ts";
import { MemoryStore } from "../src/store.ts";

class FakeHost {
  readonly handlers = new Map<string, (event: any, ctx: any) => unknown>();
  readonly commands = new Map<string, any>();
  readonly tools = new Map<string, any>();
  readonly entries: Array<{ customType: string; data: unknown }> = [];
  readonly statuses = new Map<string, string | undefined>();

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
}

function context(entries: unknown[] = []) {
  return {
    sessionId: "main",
    sessionManager: {
      getSessionFile: () => "main",
      getEntries: () => entries,
    },
    ui: { notify: () => undefined },
  };
}

test("Pi-shaped host gets commands, tools, context, and a pre-tool gate", async () => {
  let now = 1_000;
  const store = new MemoryStore();
  const controller = new WallClockController({ now: () => now }, store);
  const host = new FakeHost();
  installHostExtension(host as any, { controller });
  const ctx = context();

  await host.handlers.get("session_start")?.({}, ctx);
  controller.activate("main", { durationMs: 10_000, wrapUpMs: 2_000 });
  await host.commands.get("wallclock").handler("status", ctx);

  const contextResult = await host.handlers.get("context")?.({ messages: [{ role: "user", content: "existing" }] }, ctx) as any;
  assert.equal(contextResult.messages.length, 2);
  assert.match(contextResult.messages[1].content[0].text, /Remaining maximum time/);

  now += 10_000;
  const blocked = await host.handlers.get("tool_call")?.({ toolName: "read", input: {} }, ctx) as any;
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /expired/);
});

test("the assignment tool accepts Pi's tool-call argument order", async () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const host = new FakeHost();
  installHostExtension(host as any, { controller });
  const ctx = context();
  controller.activate("main", { durationMs: 60_000 });

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
});
