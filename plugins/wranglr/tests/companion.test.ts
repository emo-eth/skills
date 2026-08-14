import assert from "node:assert/strict";
import { test } from "node:test";
import {
  installWranglrCompanion,
  type CompanionStatus,
} from "../src/agents/companion.ts";

type CommandHandler = (args: string, context: Record<string, unknown>) => unknown;
type EventHandler = (event: unknown, context: Record<string, unknown>) => unknown;

// Implements the CompanionHost surface: on, registerCommand, setStatus,
// appendEntry, ui (all optional in CompanionHost), plus recording fields.
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
  notifyCalls: Array<{ message: string; level?: string }>;
};

const CONTEXT = { sessionId: "sess-123" };

function makeFakeHost(): FakeHost {
  const handlers: Record<string, EventHandler> = {};
  const commands: Record<string, { description?: string; handler: CommandHandler }> = {};
  const statusCalls: Array<{ key: string; value: string | undefined }> = [];
  const entryCalls: Array<{ type: string; data?: unknown }> = [];
  const notifyCalls: Array<{ message: string; level?: string }> = [];
  return {
    handlers,
    commands,
    statusCalls,
    entryCalls,
    notifyCalls,
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
    ui: {
      notify(message: string, level?: string) {
        notifyCalls.push({ message, level });
      },
    },
  };
}

function install(host: FakeHost, source: "Pi" | "OMP" = "Pi"): FakeHost {
  installWranglrCompanion(host, source);
  return host;
}

function expectReported(
  host: FakeHost,
  status: CompanionStatus,
  source: "Pi" | "OMP",
  sessionId = "sess-123",
) {
  assert.deepEqual(
    host.statusCalls.at(-1),
    { key: "wranglr", value: `${source.toLowerCase()}:${status}` },
  );
  const entry = host.entryCalls.at(-1);
  assert.equal(entry?.type, "wranglr-status");
  assert.deepEqual(entry?.data, {
    source: source.toLowerCase(),
    status,
    session_id: sessionId,
  });
}

// --- Registration ---

test("registers a wranglr command with description and handler", () => {
  const host = makeFakeHost();
  install(host);
  const cmd = host.commands["wranglr"];
  assert.ok(cmd, "wranglr command should be registered");
  assert.equal(cmd.description, "Report this agent's wranglr waiting state");
  assert.equal(typeof cmd.handler, "function");
});

test("does not register lifecycle hooks when host lacks on", () => {
  const host = makeFakeHost();
  assert.doesNotThrow(() =>
    installWranglrCompanion(
      {
        registerCommand: host.registerCommand,
        setStatus: host.setStatus,
        appendEntry: host.appendEntry,
        ui: host.ui,
      },
      "Pi",
    ),
  );
});

test("throws when registerCommand hook is missing", () => {
  const host = makeFakeHost();
  assert.throws(
    () =>
      installWranglrCompanion(
        { setStatus: host.setStatus, appendEntry: host.appendEntry },
        "OMP",
      ),
    /requires OMP's registerCommand hook/,
  );
});

// --- Valid status commands ---

const VALID_STATUSES: CompanionStatus[] = ["working", "idle", "blocked", "done"];

for (const status of VALID_STATUSES) {
  test(`reports '${status}' status and returns the status string`, () => {
    const host = makeFakeHost();
    install(host);
    const message = host.commands["wranglr"].handler(status, CONTEXT) as string;
    assert.equal(message, `wranglr status: ${status}`);
    expectReported(host, status, "Pi");
  });

  test(`translates source 'OMP' into a lowercase omp:${status} host value`, () => {
    const host = makeFakeHost();
    install(host, "OMP");
    host.commands["wranglr"].handler(status, CONTEXT);
    expectReported(host, status, "OMP");
  });
}

test("trims surrounding whitespace around the status argument", () => {
  const host = makeFakeHost();
  install(host);
  host.commands["wranglr"].handler("  blocked  ", CONTEXT);
  expectReported(host, "blocked", "Pi");
});

// --- Notification effect ---

test("notifies with 'info' when reporting working", () => {
  const host = makeFakeHost();
  install(host);
  host.commands["wranglr"].handler("working", CONTEXT);
  assert.deepEqual(host.notifyCalls, [
    { message: "wranglr status: working", level: "info" },
  ]);
});

test("notifies with 'warning' when reporting non-working statuses", () => {
  const host = makeFakeHost();
  install(host);
  host.commands["wranglr"].handler("blocked", CONTEXT);
  assert.deepEqual(host.notifyCalls, [
    { message: "wranglr status: blocked", level: "warning" },
  ]);
});

test("does not notify when host has no ui.notify", () => {
  const host = makeFakeHost();
  assert.doesNotThrow(() =>
    installWranglrCompanion(
      {
        registerCommand: host.registerCommand,
        setStatus: host.setStatus,
        appendEntry: host.appendEntry,
      },
      "Pi",
    ),
  );
  const message = host.commands["wranglr"].handler("working", CONTEXT) as string;
  assert.equal(message, "wranglr status: working");
  expectReported(host, "working", "Pi");
  assert.equal(host.notifyCalls.length, 0);
});

// --- Clear behavior ---

test("clear reports 'working' and updates host status and entry", () => {
  const host = makeFakeHost();
  install(host);
  const message = host.commands["wranglr"].handler("clear", CONTEXT) as string;
  assert.equal(message, "wranglr status: working");
  expectReported(host, "working", "Pi");
});

test("clear does not trigger a notification", () => {
  const host = makeFakeHost();
  install(host);
  host.commands["wranglr"].handler("clear", CONTEXT);
  assert.equal(host.notifyCalls.length, 0);
});

// --- Invalid status rejection ---

test("rejects an unknown status value", () => {
  const host = makeFakeHost();
  install(host);
  assert.throws(
    () => host.commands["wranglr"].handler("bogus", CONTEXT),
    /wranglr status must be working, idle, blocked, or done/,
  );
  assert.equal(host.statusCalls.length, 0);
  assert.equal(host.entryCalls.length, 0);
});

test("accepts a status via the documented 'status <state>' form", () => {
  const host = makeFakeHost();
  install(host);
  const message = host.commands["wranglr"].handler("status working", CONTEXT) as string;
  assert.equal(message, "wranglr status: working");
  expectReported(host, "working", "Pi");
});

test("bare 'status' with no state falls through to help", () => {
  const host = makeFakeHost();
  install(host);
  const message = host.commands["wranglr"].handler("status", CONTEXT) as string;
  assert.equal(message, "wranglr status <working|idle|blocked|done>; wranglr clear");
  assert.equal(host.statusCalls.length, 0);
});

test("returns help string for an empty argument", () => {
  const host = makeFakeHost();
  install(host);
  const message = host.commands["wranglr"].handler("", CONTEXT) as string;
  assert.equal(message, "wranglr status <working|idle|blocked|done>; wranglr clear");
});

test("returns help string for whitespace-only argument", () => {
  const host = makeFakeHost();
  install(host);
  const message = host.commands["wranglr"].handler("   ", CONTEXT) as string;
  assert.equal(message, "wranglr status <working|idle|blocked|done>; wranglr clear");
});

test("returns help string for 'help'", () => {
  const host = makeFakeHost();
  install(host);
  const message = host.commands["wranglr"].handler("help", CONTEXT) as string;
  assert.equal(message, "wranglr status <working|idle|blocked|done>; wranglr clear");
});

test("help paths do not touch host status, entries, or notifications", () => {
  const host = makeFakeHost();
  install(host);
  host.commands["wranglr"].handler("", CONTEXT);
  host.commands["wranglr"].handler("help", CONTEXT);
  assert.equal(host.statusCalls.length, 0);
  assert.equal(host.entryCalls.length, 0);
  assert.equal(host.notifyCalls.length, 0);
});

// --- Lifecycle reporting ---

test("before_agent_start reports 'working'", () => {
  const host = makeFakeHost();
  install(host);
  const handler = host.handlers["before_agent_start"];
  assert.ok(handler, "before_agent_start hook should be registered");
  const message = handler({}, CONTEXT) as string;
  assert.equal(message, "wranglr status: working");
  expectReported(host, "working", "Pi");
});

test("agent_end with willContinue true reports 'working'", () => {
  const host = makeFakeHost();
  install(host);
  const handler = host.handlers["agent_end"];
  const message = handler({ willContinue: true }, CONTEXT) as string;
  assert.equal(message, "wranglr status: working");
  expectReported(host, "working", "Pi");
});

test("agent_end with willContinue false reports terminal 'done'", () => {
  const host = makeFakeHost();
  install(host);
  const handler = host.handlers["agent_end"];
  const message = handler({ willContinue: false }, CONTEXT) as string;
  assert.equal(message, "wranglr status: done");
  expectReported(host, "done", "Pi");
});

test("agent_end without willContinue reports terminal 'done'", () => {
  const host = makeFakeHost();
  install(host);
  const handler = host.handlers["agent_end"];
  const message = handler({ reason: "finished" }, CONTEXT) as string;
  assert.equal(message, "wranglr status: done");
  expectReported(host, "done", "Pi");
});

test("agent_end with a non-record event reports terminal 'done'", () => {
  const host = makeFakeHost();
  install(host);
  const handler = host.handlers["agent_end"];
  assert.equal(handler(null, CONTEXT) as string, "wranglr status: done");
  assert.equal(handler("done", CONTEXT) as string, "wranglr status: done");
  assert.equal(handler([1, 2], CONTEXT) as string, "wranglr status: done");
  assert.equal(host.statusCalls.length, 3);
  assert.equal(host.entryCalls.length, 3);
});

test("lifecycle reports do not trigger notifications", () => {
  const host = makeFakeHost();
  install(host);
  host.handlers["before_agent_start"]({}, CONTEXT);
  host.handlers["agent_end"]({ willContinue: false }, CONTEXT);
  assert.equal(host.notifyCalls.length, 0);
});

// --- Host status / appendEntry effects ---

test("report carries the session id from context into the appended entry", () => {
  const host = makeFakeHost();
  install(host);
  host.commands["wranglr"].handler("idle", { sessionId: "custom-session" });
  const entry = host.entryCalls.at(-1);
  assert.ok(entry && typeof entry.data === "object" && entry.data !== null);
  assert.ok("session_id" in entry.data);
  assert.equal(entry.data.session_id, "custom-session");
});

test("omits session_id when context has none", () => {
  const host = makeFakeHost();
  install(host);
  host.commands["wranglr"].handler("blocked", {});
  const entry = host.entryCalls.at(-1);
  assert.deepEqual(entry?.data, {
    source: "pi",
    status: "blocked",
    session_id: undefined,
  });
});

test("appendEntry data carries source, status, and session id", () => {
  const host = makeFakeHost();
  install(host, "OMP");
  host.commands["wranglr"].handler("done", CONTEXT);
  const entry = host.entryCalls.at(-1);
  assert.deepEqual(entry?.data, {
    source: "omp",
    status: "done",
    session_id: "sess-123",
  });
});

test("tolerates missing setStatus and appendEntry hooks", () => {
  const host = makeFakeHost();
  assert.doesNotThrow(() =>
    installWranglrCompanion(
      { registerCommand: host.registerCommand, ui: host.ui },
      "Pi",
    ),
  );
  const message = host.commands["wranglr"].handler("working", CONTEXT) as string;
  assert.equal(message, "wranglr status: working");
  assert.equal(host.statusCalls.length, 0);
  assert.equal(host.entryCalls.length, 0);
  assert.equal(host.notifyCalls.length, 1);
});