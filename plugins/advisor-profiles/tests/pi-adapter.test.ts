import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ADVISOR_FOLLOWUP_MARKER } from "../src/review.ts";
import { installAdvisorProfiles, type AdvisorProfilesController } from "../src/pi.ts";
import { PERSIST_ENTRY_TYPE } from "../src/state.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;
type Command = { description?: string; handler: (args: string, ctx: unknown) => unknown };

class FakeRegistry {
  models = new Map<string, { provider: string; id: string }>();
  verdict = '{"pass": true}';
  failFor: string[] = [];
  authOk = true;
  calls: Array<{ model: unknown; context: { systemPrompt?: string; messages: unknown[] } }> = [];
  finds: Array<[string, string]> = [];

  constructor(extra: Record<string, { provider: string; id: string }> = {}) {
    this.models.set("anthropic/claude-sonnet-4-5", { provider: "anthropic", id: "claude-sonnet-4-5" });
    for (const [key, value] of Object.entries(extra)) this.models.set(key, value);
  }

  find(provider: string, modelId: string): unknown {
    this.finds.push([provider, modelId]);
    return this.models.get(`${provider}/${modelId}`);
  }

  hasConfiguredAuth(): boolean {
    return this.authOk;
  }

  async complete(model: unknown, context: { systemPrompt?: string; messages: unknown[] }): Promise<unknown> {
    const key = `${(model as { provider: string }).provider}/${(model as { id: string }).id}`;
    this.calls.push({ model, context });
    if (this.failFor.includes(key)) throw new Error("provider exploded");
    return { content: [{ type: "text", text: this.verdict }] };
  }
}

class FakeHost {
  readonly handlers = new Map<string, Handler>();
  readonly commands = new Map<string, Command>();
  readonly entries: unknown[] = [];
  readonly branch: unknown[] = [];
  readonly userMessages: Array<{ content: string; options: unknown }> = [];
  readonly notices: Array<{ message: string; level?: string }> = [];
  readonly cwd: string;
  readonly registry: FakeRegistry;
  readonly model = { provider: "anthropic", id: "claude-sonnet-4-5" };

  constructor(cwd: string, registry: FakeRegistry) {
    this.cwd = cwd;
    this.registry = registry;
  }

  on(event: string, handler: Handler): void {
    this.handlers.set(event, handler);
  }

  registerCommand(name: string, options: Command): void {
    this.commands.set(name, options);
  }

  appendEntry(customType: string, data?: unknown): void {
    this.entries.push({ type: "custom", customType, data });
  }

  sendUserMessage(content: string, options?: unknown): void {
    this.userMessages.push({ content, options });
  }

  context(): unknown {
    return {
      cwd: this.cwd,
      ui: { notify: (message: string, level?: string) => this.notices.push({ message, level }) },
      modelRegistry: this.registry,
      model: this.model,
      sessionManager: {
        getEntries: () => this.entries,
        getBranch: () => this.branch,
      },
    };
  }

  emit(event: string, eventData: unknown = {}): Promise<unknown> {
    const handler = this.handlers.get(event);
    return handler ? Promise.resolve(handler(eventData, this.context())) : Promise.resolve(undefined);
  }

  command(args: string): Promise<unknown> {
    const command = this.commands.get("advisor-profile");
    if (!command) throw new Error("advisor-profile command not registered");
    return Promise.resolve(command.handler(args, this.context()));
  }
}

async function makeProject(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "advisor-pi-"));
  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.join(root, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
  return root;
}

async function setup(
  files: Record<string, string>,
  registry = new FakeRegistry(),
): Promise<{ root: string; host: FakeHost; registry: FakeRegistry; controller: AdvisorProfilesController }> {
  const root = await makeProject({ ".git": "", ...files });
  const host = new FakeHost(root, registry);
  const controller = installAdvisorProfiles(host, { agentDir: path.join(root, "agent") });
  assert.ok(controller);
  return { root, host, registry, controller };
}

const MESSAGES = [
  { role: "user", content: "Add the retry loop" },
  { role: "assistant", content: [{ type: "text", text: "Done." }] },
];

function messageEntries(messages: unknown[]): unknown[] {
  return messages.map((message, index) => ({
    type: "message",
    id: `m${index}`,
    parentId: index === 0 ? null : `m${index - 1}`,
    timestamp: String(Date.now() + index),
    message,
  }));
}

const WATCHDOG = (advisors: string): string => `advisors:\n${advisors}`;

function lastNotice(host: FakeHost): string {
  return host.notices[host.notices.length - 1]?.message ?? "";
}

test("defaults to all enabled advisors and reviews a settled run from the session branch", async () => {
  const { host, registry } = await setup({
    "WATCHDOG.yml": WATCHDOG(
      "  - name: vibe\n    instructions: vibe text\n  - name: dormant\n    enabled: false\n",
    ),
  });
  await host.emit("session_start");
  host.branch.push(...messageEntries(MESSAGES));
  await host.emit("agent_settled");
  assert.equal(registry.calls.length, 1);
  assert.ok(registry.calls[0].context.systemPrompt?.includes("vibe text"));
  assert.ok(registry.calls[0].context.messages[0].content.includes("Add the retry loop"));
  assert.equal(typeof registry.calls[0].context.messages[0].timestamp, "number");
  assert.equal(host.userMessages.length, 0);
  assert.equal(host.entries.length, 0, "a pass review persists nothing");
});

test("agent_settled carries no transcript; the review uses sessionManager.getBranch()", async () => {
  const { host, registry } = await setup({
    "WATCHDOG.yml": WATCHDOG("  - name: vibe\n"),
  });
  await host.emit("session_start");
  host.branch.push(...messageEntries(MESSAGES));
  await host.emit("agent_settled", { messages: [{ role: "user", content: "EVENT PAYLOAD NOT USED" }] });
  assert.equal(registry.calls.length, 1);
  assert.ok(registry.calls[0].context.messages[0].content.includes("Add the retry loop"));
  assert.ok(!registry.calls[0].context.messages[0].content.includes("EVENT PAYLOAD NOT USED"));
});

test("explicit advisor model is resolved through the registry; concern sends one marked follow-up", async () => {
  const registry = new FakeRegistry();
  registry.models.set("x-ai/grok-code-fast", { provider: "x-ai", id: "grok-code-fast" });
  registry.verdict = '{"severity": "concern", "note": "The retry loop swallows errors."}';
  const { host } = await setup(
    {
      "WATCHDOG.yml": WATCHDOG("  - name: vibe\n    model: x-ai/grok-code-fast:high\n"),
    },
    registry,
  );
  await host.emit("session_start");
  host.branch.push(...messageEntries(MESSAGES));
  await host.emit("agent_settled");
  assert.deepEqual(registry.finds.at(-1), ["x-ai", "grok-code-fast"]);
  assert.equal(host.userMessages.length, 1);
  assert.ok(host.userMessages[0].content.startsWith(ADVISOR_FOLLOWUP_MARKER));
  assert.ok(host.userMessages[0].content.includes("vibe"));
  assert.deepEqual(host.userMessages[0].options, { deliverAs: "followUp" });
  const persisted = host.entries.at(-1);
  assert.equal((persisted as { customType: string }).customType, PERSIST_ENTRY_TYPE);
});

test("generated correction runs are never reviewed; the next user turn is", async () => {
  const registry = new FakeRegistry();
  registry.models.set("x-ai/grok-code-fast", { provider: "x-ai", id: "grok-code-fast" });
  registry.verdict = '{"severity": "blocker", "note": "Fix the leak."}';
  const { host } = await setup(
    {
      "WATCHDOG.yml": WATCHDOG("  - name: vibe\n    model: x-ai/grok-code-fast\n"),
    },
    registry,
  );
  await host.emit("session_start");
  host.branch.push(...messageEntries(MESSAGES));
  await host.emit("agent_settled");
  assert.equal(host.userMessages.length, 1);
  const afterReview = registry.calls.length;
  assert.ok(afterReview >= 1);

  await host.emit("agent_start");
  await host.emit("agent_settled");
  assert.equal(registry.calls.length, afterReview, "correction run must not be reviewed");

  await host.emit("agent_start");
  await host.emit("agent_settled");
  assert.ok(registry.calls.length > afterReview, "a fresh user turn is reviewed again");
});

test("settled-only correction fallback skips exactly one review", async () => {
  const registry = new FakeRegistry();
  registry.models.set("x-ai/grok-code-fast", { provider: "x-ai", id: "grok-code-fast" });
  registry.verdict = '{"severity": "blocker", "note": "Fix the leak."}';
  const { host } = await setup(
    {
      "WATCHDOG.yml": WATCHDOG("  - name: vibe\n    model: x-ai/grok-code-fast\n"),
    },
    registry,
  );
  await host.emit("session_start");
  host.branch.push(...messageEntries(MESSAGES));
  await host.emit("agent_settled");
  const afterReview = registry.calls.length;

  await host.emit("agent_settled");
  assert.equal(registry.calls.length, afterReview);

  await host.emit("agent_settled");
  assert.ok(registry.calls.length > afterReview);
});

test("use command and direct subcommands switch selection, reject unknown names, and persist", async () => {
  const { host } = await setup({
    "WATCHDOG.yml": WATCHDOG("  - name: vibe\n  - name: code-quality\n"),
  });
  await host.emit("session_start");

  await host.command("use vibe");
  assert.ok(lastNotice(host).includes('using "vibe"'));
  const persisted = host.entries.at(-1) as { data: { selection: unknown } };
  assert.deepEqual(persisted.data.selection, { mode: "one", slug: "vibe" });

  await host.command("use all");
  assert.ok(lastNotice(host).includes("all enabled advisors"));
  await host.command("all");
  assert.ok(lastNotice(host).includes("all enabled advisors"), "direct /advisor-profile all works");

  await host.command("off");
  assert.ok(lastNotice(host).includes("off"), "direct /advisor-profile off works");
  const callsBefore = host.registry.calls.length;
  await host.emit("agent_settled");
  assert.equal(host.registry.calls.length, callsBefore, "off suppresses reviews");
  await host.command("use all");
  assert.ok(lastNotice(host).includes("all enabled advisors"), "use all remains an alias");

  await host.command("use missing");
  assert.ok(lastNotice(host).includes("Unknown advisor"));
  await host.command("status");
  assert.ok(lastNotice(host).includes("all (2 advisors)"), "failed use leaves selection unchanged");

  await assert.rejects(() => host.command("use"), /Usage:/);
  await assert.rejects(() => host.command("bogus"), /Usage:/);
});

test("session_start restores a persisted selection", async () => {
  const { host } = await setup({
    "WATCHDOG.yml": WATCHDOG("  - name: vibe\n  - name: code-quality\n"),
  });
  host.entries.push({
    type: "custom",
    customType: PERSIST_ENTRY_TYPE,
    data: { version: 1, selection: { mode: "one", slug: "vibe" }, dedupe: [], followUpCount: 3 },
  });
  await host.emit("session_start");
  await host.command("status");
  const notice = lastNotice(host);
  assert.ok(notice.includes('"vibe"'));
  assert.ok(notice.includes("Reviewer follow-ups sent: 3"));

  const { host: fresh } = await setup({
    "WATCHDOG.yml": WATCHDOG("  - name: vibe\n  - name: code-quality\n"),
  });
  await fresh.emit("session_start");
  await fresh.command("status");
  assert.ok(lastNotice(fresh).includes("all (2 advisors)"), "fresh sessions default to all enabled");
});

test("session_start resets session-scoped state before restoring the new session's persistence", async () => {
  const registry = new FakeRegistry();
  registry.verdict = '{"severity": "concern", "note": "Fix the leak."}';
  const { host } = await setup(
    {
      "WATCHDOG.yml": WATCHDOG("  - name: vibe\n  - name: code-quality\n"),
    },
    registry,
  );

  await host.emit("session_start");
  host.branch.push(...messageEntries(MESSAGES));
  await host.emit("agent_settled");
  assert.equal(host.userMessages.length, 1, "session A reviews and sends a follow-up");

  host.entries.length = 0;
  host.userMessages.length = 0;
  await host.emit("session_start");
  await host.command("status");
  const noticeB = lastNotice(host);
  assert.ok(noticeB.includes("all (2 advisors)"), "a new session must not inherit session A selection");
  assert.ok(noticeB.includes("Reviewer follow-ups sent: 0"), "follow-up counter resets");
  assert.ok(!noticeB.includes("last:"), "per-advisor status resets");

  host.entries.length = 0;
  host.entries.push({
    type: "custom",
    customType: PERSIST_ENTRY_TYPE,
    data: { version: 1, selection: { mode: "one", slug: "vibe" }, dedupe: [], followUpCount: 7 },
  });
  await host.emit("session_start");
  await host.command("status");
  const noticeC = lastNotice(host);
  assert.ok(noticeC.includes('"vibe"'), "session C applies its own persisted selection");
  assert.ok(noticeC.includes("Reviewer follow-ups sent: 7"));
});

test("reload re-reads WATCHDOG.yml from disk", async () => {
  const { host } = await setup({
    "WATCHDOG.yml": WATCHDOG("  - name: vibe\n"),
  });
  await host.emit("session_start");
  await host.command("status");
  assert.ok(lastNotice(host).includes("- vibe"));
  assert.ok(!lastNotice(host).includes("code-quality"));

  await fs.writeFile(
    path.join(host.cwd, "WATCHDOG.yml"),
    WATCHDOG("  - name: vibe\n  - name: code-quality\n"),
  );
  await host.command("reload");
  assert.ok(lastNotice(host).includes("reloaded: 2 advisors"));
  await host.command("status");
  assert.ok(lastNotice(host).includes("- code-quality"));
});

test("an explicit missing model yields no_model status and no review", async () => {
  const { host, registry } = await setup({
    "WATCHDOG.yml": WATCHDOG("  - name: vibe\n    model: anthropic/ghost\n"),
  });
  await host.emit("session_start");
  host.branch.push(...messageEntries(MESSAGES));
  await host.emit("agent_settled");
  assert.equal(registry.calls.length, 0, "no review without a resolvable model");
  assert.equal(host.userMessages.length, 0);
  await host.command("status");
  assert.ok(lastNotice(host).includes("no_model"));
});

test("advisor failures are isolated and at most one follow-up is sent", async () => {
  const registry = new FakeRegistry();
  registry.models.set("p/broken-model", { provider: "p", id: "broken-model" });
  registry.models.set("p/healthy-model", { provider: "p", id: "healthy-model" });
  registry.models.set("p/other-model", { provider: "p", id: "other-model" });
  registry.failFor = ["p/broken-model"];
  registry.verdict = '{"severity": "blocker", "note": "Fix it."}';
  const { host } = await setup(
    {
      "WATCHDOG.yml": WATCHDOG(
        "  - name: broken\n    model: p/broken-model\n  - name: healthy\n    model: p/healthy-model\n  - name: other\n    model: p/other-model\n",
      ),
    },
    registry,
  );
  await host.emit("session_start");
  host.branch.push(...messageEntries(MESSAGES));
  await host.emit("agent_settled");
  assert.equal(registry.calls.length, 3, "the broken advisor does not stop the others");
  assert.equal(host.userMessages.length, 1, "exactly one follow-up for the whole turn");
  await host.command("status");
  const notice = lastNotice(host);
  assert.ok(notice.includes("error (provider exploded)"), "failure visible in status");
  assert.ok(notice.includes("last: blocker"), "healthy advisor outcome visible");
});

test("status surfaces the tools limitation and list shows the roster", async () => {
  const { host } = await setup({
    "WATCHDOG.yml": WATCHDOG("  - name: vibe\n    tools: [bash, read]\n"),
  });
  await host.emit("session_start");
  await host.command("status");
  const status = lastNotice(host);
  assert.ok(status.includes("unsupported in Pi"));
  assert.ok(status.includes("no tool loop"));
  assert.ok(status.includes("OMP-only"));

  await host.command("list");
  const list = lastNotice(host);
  assert.ok(list.includes("- vibe"));
  assert.ok(list.includes("selected"));
});

test("a host without the command seam still reviews settled runs", async () => {
  const root = await makeProject({
    ".git": "",
    "WATCHDOG.yml": WATCHDOG("  - name: vibe\n"),
  });
  const registry = new FakeRegistry();
  const host = new FakeHost(root, registry);
  const controller = installAdvisorProfiles(host, { agentDir: path.join(root, "agent") });
  assert.ok(controller);
  await host.emit("session_start");
  host.branch.push(...messageEntries(MESSAGES));
  await host.emit("agent_settled");
  assert.equal(registry.calls.length, 1);
  await fs.rm(root, { recursive: true, force: true });
});

test("a host without the event seam fails closed without crashing", async () => {
  assert.equal(installAdvisorProfiles({}), undefined);
});
