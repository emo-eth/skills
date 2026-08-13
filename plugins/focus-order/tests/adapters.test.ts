import assert from "node:assert/strict";
import { test } from "node:test";
import focusOrderPiExtension from "../src/agents/pi.ts";
import focusOrderOmpExtension from "../src/agents/omp.ts";

type CommandHandler = (args: string, context: Record<string, unknown>) => unknown;
type EventHandler = (event: unknown, context: Record<string, unknown>) => unknown;

// A minimal fake host fulfilling the optional CompanionHost surface that the
// Pi/OMP adapters pass through to installFocusOrderCompanion. Both adapters
// accept an `unknown` host, so only the hooks the companion actually uses
// need to be present.
type FakeHost = {
  on: (event: string, handler: EventHandler) => void;
  registerCommand: (
    name: string,
    options: { description?: string; handler: CommandHandler },
  ) => void;
  setStatus: (key: string, value: string | undefined) => void;
  appendEntry: (type: string, data?: unknown) => void;
  ui: { notify: (message: string, level?: string) => void };
  handlers: Record<string, EventHandler>;
  commands: Record<string, { description?: string; handler: CommandHandler }>;
  statusCalls: Array<{ key: string; value: string | undefined }>;
  entryCalls: Array<{ type: string; data?: unknown }>;
};

const CONTEXT = { sessionId: "sess-123" };

function makeFakeHost(): FakeHost {
  const handlers: Record<string, EventHandler> = {};
  const commands: Record<string, { description?: string; handler: CommandHandler }> = {};
  const statusCalls: Array<{ key: string; value: string | undefined }> = [];
  const entryCalls: Array<{ type: string; data?: unknown }> = [];
  return {
    handlers,
    commands,
    statusCalls,
    entryCalls,
    on(event: string, handler: EventHandler) {
      handlers[event] = handler;
    },
    registerCommand(
      name: string,
      options: { description?: string; handler: CommandHandler },
    ) {
      commands[name] = options;
    },
    setStatus(key: string, value: string | undefined) {
      statusCalls.push({ key, value });
    },
    appendEntry(type: string, data?: unknown) {
      entryCalls.push({ type, data });
    },
    ui: { notify() {} },
  };
}

test("Pi adapter registers the focus-order command and reports pi:<status>", () => {
  const host = makeFakeHost();
  focusOrderPiExtension(host);

  const cmd = host.commands["focus-order"];
  assert.ok(cmd, "Pi adapter should register the focus-order command");
  assert.equal(typeof cmd.handler, "function");
  assert.ok(host.handlers["before_agent_start"], "lifecycle hook should be registered");

  const message = cmd.handler("blocked", CONTEXT) as string;
  assert.equal(message, "focus-order status: blocked");
  assert.deepEqual(host.statusCalls.at(-1), {
    key: "focus-order",
    value: "pi:blocked",
  });
  const entry = host.entryCalls.at(-1);
  assert.equal(entry?.type, "focus-order-status");
  assert.deepEqual(entry?.data, {
    source: "pi",
    status: "blocked",
    session_id: "sess-123",
  });
});

test("OMP adapter registers the focus-order command and reports omp:<status>", () => {
  const host = makeFakeHost();
  focusOrderOmpExtension(host);

  const cmd = host.commands["focus-order"];
  assert.ok(cmd, "OMP adapter should register the focus-order command");
  assert.equal(typeof cmd.handler, "function");
  assert.ok(host.handlers["agent_end"], "lifecycle hook should be registered");

  const message = cmd.handler("done", CONTEXT) as string;
  assert.equal(message, "focus-order status: done");
  assert.deepEqual(host.statusCalls.at(-1), {
    key: "focus-order",
    value: "omp:done",
  });
  const entry = host.entryCalls.at(-1);
  assert.equal(entry?.type, "focus-order-status");
  assert.deepEqual(entry?.data, {
    source: "omp",
    status: "done",
    session_id: "sess-123",
  });
});