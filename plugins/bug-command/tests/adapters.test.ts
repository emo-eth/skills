import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import bugOmpExtension from "../src/omp.ts";
import bugPiExtension from "../src/pi.ts";
import type { RuntimeContext, RuntimeHost } from "../src/host.ts";

type Command = {
  handler: (args: string, context: RuntimeContext) => unknown;
};
type EventHandler = (event: unknown, context: RuntimeContext) => unknown;

class FakeHost implements RuntimeHost {
  readonly commands = new Map<string, Command>();
  readonly handlers = new Map<string, EventHandler>();
  readonly notices: Array<{ message: string; level?: string }> = [];

  on(event: string, handler: EventHandler): void {
    this.handlers.set(event, handler);
  }

  registerCommand(name: string, options: { description: string; handler: Command["handler"] }): void {
    this.commands.set(name, options);
  }

  async emit(event: string, payload: unknown, context: RuntimeContext): Promise<void> {
    await this.handlers.get(event)?.(payload, context);
  }
}

function context(sessionId: string, notices: FakeHost["notices"]): RuntimeContext {
  return {
    sessionId,
    cwd: process.cwd(),
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionName: () => "bug test session",
      getSessionFile: () => `/tmp/${sessionId}.jsonl`,
      getEntries: () => [{ type: "user" }, { type: "assistant" }],
      getBranch: () => [{ id: "root" }],
    },
    model: { provider: "test", id: "model-1" },
    ui: {
      notify: (message, level) => notices.push({ message, level }),
    },
  };
}

async function withOutputPath<T>(path: string, action: () => Promise<T>): Promise<T> {
  const previous = process.env.BUGS_PATH;
  process.env.BUGS_PATH = path;
  try {
    return await action();
  } finally {
    if (previous === undefined) delete process.env.BUGS_PATH;
    else process.env.BUGS_PATH = previous;
  }
}

const adapters = [
  ["Pi", bugPiExtension, "pi"],
  ["OMP", bugOmpExtension, "omp"],
] as const;

for (const [agent, adapter, host] of adapters) {
  test(`${agent} registers /bug and captures recent session activity`, async () => {
    const root = await mkdtemp(join(tmpdir(), `bug-command-${host}-`));
    try {
      const fake = new FakeHost();
      adapter(fake);
      assert.ok(fake.commands.has("bug"));
      assert.equal(
        fake.commands.get("bug")?.handler instanceof Function,
        true,
      );

      const current = context(`${host}-session`, fake.notices);
      await fake.emit("before_agent_start", {
        prompt: '<skill name="skill-iteration" location="/skills/skill-iteration/SKILL.md">',
        pluginName: "turn-summary",
        turn: 4,
        startedAt: "2026-08-14T12:34:00.000Z",
      }, current);
      await fake.emit("tool_call", { toolName: "read" }, current);

      await withOutputPath(join(root, "BUGS.md"), async () => {
        await fake.commands.get("bug")!.handler("the command lost its session context", current);
      });

      const line = (await readFile(join(root, "BUGS.md"), "utf8")).trim();
      const record = JSON.parse(line.slice(2)) as Record<string, unknown>;
      assert.equal(record.schema, "bug.v1");
      assert.equal(record.host, host);
      assert.equal(record.agent, agent);
      assert.equal(record.plugin, "turn-summary");
      assert.equal(record.skill, "skill-iteration");
      assert.equal(record.sessionId, `${host}-session`);
      assert.equal(record.sessionName, "bug test session");
      assert.equal(record.sessionFile, `/tmp/${host}-session.jsonl`);
      assert.equal(record.turn, 4);
      assert.equal(record.turnStartedAt, "2026-08-14T12:34:00.000Z");
      assert.equal(record.lastEvent, "tool_call");
      assert.equal(record.lastTool, "read");
      assert.equal(record.sessionEntryCount, 2);
      assert.equal(record.branchEntryCount, 1);
      assert.equal(record.note, "the command lost its session context");
      assert.deepEqual(fake.notices, [{ message: "Bug logged for turn-summary", level: "info" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("explicit plugin and skill flags override automatic context", async () => {
  const root = await mkdtemp(join(tmpdir(), "bug-command-explicit-"));
  try {
    const fake = new FakeHost();
    bugPiExtension(fake);
    const current = context("explicit-session", fake.notices);
    await fake.emit("message_start", {
      message: { customType: "skill-prompt", details: { name: "old-skill" } },
    }, current);

    await withOutputPath(join(root, "BUGS.md"), async () => {
      await fake.commands.get("bug")!.handler(
        "--plugin focus-order --skill understand the explicit context wins",
        current,
      );
    });

    const line = (await readFile(join(root, "BUGS.md"), "utf8")).trim();
    const record = JSON.parse(line.slice(2)) as Record<string, unknown>;
    assert.equal(record.plugin, "focus-order");
    assert.equal(record.skill, "understand");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lifecycle order supplies a turn hint when the host omits turn metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "bug-command-turn-hint-"));
  try {
    const fake = new FakeHost();
    bugPiExtension(fake);
    const current = context("turn-hint-session", fake.notices);
    await fake.emit("before_agent_start", {
      prompt: "ordinary prompt without an explicit turn field",
    }, current);

    await withOutputPath(join(root, "BUGS.md"), async () => {
      await fake.commands.get("bug")!.handler("capture the fallback turn", current);
    });

    const line = (await readFile(join(root, "BUGS.md"), "utf8")).trim();
    const record = JSON.parse(line.slice(2)) as Record<string, unknown>;
    assert.equal(record.turn, 1);
    assert.equal(typeof record.turnStartedAt, "string");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the command works when lifecycle hooks are unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "bug-command-no-events-"));
  try {
    const fake = new FakeHost();
    bugOmpExtension({
      registerCommand: fake.registerCommand.bind(fake),
    });
    await withOutputPath(join(root, "BUGS.md"), async () => {
      await fake.commands.get("bug")!.handler("a command-only bug", {});
    });
    const line = (await readFile(join(root, "BUGS.md"), "utf8")).trim();
    const record = JSON.parse(line.slice(2)) as Record<string, unknown>;
    assert.equal(record.note, "a command-only bug");
    assert.equal(record.turn, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
