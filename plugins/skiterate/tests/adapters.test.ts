import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import skiterateOmpExtension from "../src/omp.ts";
import skiteratePiExtension from "../src/pi.ts";
import type { RuntimeContext, RuntimeHost } from "../src/host.ts";

type Command = {
  handler: (args: string, context: RuntimeContext) => unknown;
};
type EventHandler = (event: unknown, context: RuntimeContext) => unknown;

class FakeHost implements RuntimeHost {
  readonly commands = new Map<string, Command>();
  readonly handlers = new Map<string, EventHandler>();
  readonly notices: string[] = [];

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

function context(sessionId: string): RuntimeContext {
  const hostContext: RuntimeContext = {
    sessionId,
    cwd: process.cwd(),
    sessionManager: { getSessionFile: () => sessionId },
    model: { provider: "test", id: "model-1" },
    ui: { notify: (message) => notices.push(message) },
  };
  return hostContext;
}

const notices: string[] = [];

async function withOutputPath<T>(path: string, action: () => Promise<T>): Promise<T> {
  const previous = process.env.SKITERATE_PATH;
  process.env.SKITERATE_PATH = path;
  try {
    return await action();
  } finally {
    if (previous === undefined) delete process.env.SKITERATE_PATH;
    else process.env.SKITERATE_PATH = previous;
  }
}

test("Pi registers /skiterate and captures the Pi skill marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "skiterate-pi-"));
  try {
    const host = new FakeHost();
    skiteratePiExtension(host);
    assert.ok(host.commands.has("skiterate"));

    const current = context("pi-session");
    await host.emit("before_agent_start", {
      prompt: '<skill name="skill-iteration" location="/skills/skill-iteration/SKILL.md">',
    }, current);
    await withOutputPath(join(root, "SKITERATE.md"), async () => {
      await host.commands.get("skiterate")!.handler("capture the friction", current);
    });

    const line = (await readFile(join(root, "SKITERATE.md"), "utf8")).trim();
    const record = JSON.parse(line.slice(2)) as Record<string, string | null>;
    assert.equal(record.agent, "Pi");
    assert.equal(record.skill, "skill-iteration");
    assert.equal(record.note, "capture the friction");
    assert.equal(record.model, "test/model-1");
    assert.match(record.datetime ?? "", /^2026|^20/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OMP registers /skiterate and honors an explicit skill argument", async () => {
  const root = await mkdtemp(join(tmpdir(), "skiterate-omp-"));
  try {
    const host = new FakeHost();
    skiterateOmpExtension(host);
    assert.ok(host.commands.has("skiterate"));

    const current = context("omp-session");
    await host.emit("message_start", {
      message: {
        customType: "skill-prompt",
        details: { name: "understand" },
      },
    }, current);
    await withOutputPath(join(root, "SKITERATE.md"), async () => {
      await host.commands.get("skiterate")!.handler("--skill lc-ticketize record the proof", current);
    });

    const line = (await readFile(join(root, "SKITERATE.md"), "utf8")).trim();
    const record = JSON.parse(line.slice(2)) as Record<string, string | null>;
    assert.equal(record.agent, "OMP");
    assert.equal(record.skill, "lc-ticketize");
    assert.equal(record.note, "record the proof");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
