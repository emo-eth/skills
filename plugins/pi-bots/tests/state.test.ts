import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BotStateStore } from "../src/state.ts";
import type { BotDefinition, BotRoster } from "../src/types.ts";

const BASE_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

interface Fixture {
  base: string;
  root: string;
  agentDir: string;
  store: BotStateStore;
}

function definition(overrides: {
  name: string;
  runtimeName: string;
  domains: string[];
  scope: BotDefinition["scope"];
  memory: BotDefinition["memory"];
  enabled?: boolean;
}): BotDefinition {
  return {
    title: overrides.name,
    description: "",
    fallbackModels: [],
    delegates: [],
    context: "fork",
    timeoutMs: 60_000,
    maxSubagentDepth: 1,
    enabled: overrides.enabled ?? true,
    configPath: overrides.scope === "project" ? "/proj/.pi/BOTS.yml" : "/agent/BOTS.yml",
    ...overrides,
  };
}

async function createFixture(): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "pi-bots-state-"));
  const root = join(base, "project");
  const agentDir = join(base, "agent");
  await mkdir(root, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  const roster: BotRoster = {
    version: 1,
    bots: [
      definition({ name: "architect", runtimeName: "bot.architect", domains: ["architecture"], scope: "project", memory: "project" }),
      definition({ name: "librarian", runtimeName: "bot.librarian", domains: ["library"], scope: "user", memory: "user" }),
      definition({ name: "auditor", runtimeName: "bot.auditor", domains: ["audit"], scope: "project", memory: "off" }),
      definition({ name: "retired", runtimeName: "bot.retired", domains: [], scope: "user", memory: "off", enabled: false }),
    ],
    domainOwners: { architecture: "architect", library: "librarian", audit: "auditor" },
    sources: [],
    projectRoot: root,
    agentDir,
  };
  let tick = 0;
  let idSeq = 0;
  const store = new BotStateStore(roster, {
    clock: () => new Date(BASE_MS + (tick += 1) * 1000),
    newId: () => `test-id-${(idSeq += 1)}`,
  });
  return { base, root, agentDir, store };
}

test("domain records land in scope-specific paths with exact attribution", async (t) => {
  const fx = await createFixture();
  t.after(() => rm(fx.base, { recursive: true, force: true }));

  const first = await fx.store.recordDomain("bot.architect", {
    domain: "architecture",
    kind: "observation",
    summary: "first observation",
  });
  const second = await fx.store.recordDomain("bot.librarian", {
    domain: "library",
    kind: "verified",
    summary: "confirmed",
    evidence: "ran the checks",
  });

  assert.deepEqual(first, { id: "test-id-1", recordedAt: "2026-01-01T00:00:01.000Z" });
  assert.deepEqual(second, { id: "test-id-2", recordedAt: "2026-01-01T00:00:02.000Z" });

  assert.equal(
    await readFile(join(fx.root, ".pi", "team-context", "architecture.md"), "utf8"),
    "---\nversion: 1\ndomain: architecture\nowner: architect\n---\n\n" +
      "## 2026-01-01T00:00:01.000Z observation test-id-1\nfirst observation\n",
  );
  assert.equal(
    await readFile(join(fx.agentDir, "team-context", "library.md"), "utf8"),
    "---\nversion: 1\ndomain: library\nowner: librarian\n---\n\n" +
      "## 2026-01-01T00:00:02.000Z verified test-id-2\nconfirmed\nEvidence: ran the checks\n",
  );
});

test("snapshot lists every effective domain before files exist without creating them", async (t) => {
  const fx = await createFixture();
  t.after(() => rm(fx.base, { recursive: true, force: true }));

  const snap = await fx.store.snapshot();

  assert.equal(snap.bot, undefined);
  assert.equal(snap.memory, undefined);
  assert.deepEqual(
    snap.domains.map((entry) => [entry.domain, entry.owner]),
    [
      ["architecture", "architect"],
      ["audit", "auditor"],
      ["library", "librarian"],
    ],
  );
  for (const entry of snap.domains) {
    assert.equal(entry.content, "");
    assert.equal(entry.truncated, false);
    assert.equal(existsSync(entry.path), false);
  }
});

test("snapshot resolves the current bot from the passed runtime name only", async (t) => {
  const fx = await createFixture();
  t.after(() => rm(fx.base, { recursive: true, force: true }));

  const snap = await fx.store.snapshot("bot.librarian");
  assert.equal(snap.bot?.name, "librarian");
  assert.equal(snap.bot?.scope, "user");
  assert.equal((await fx.store.snapshot("bot.unknown")).bot, undefined);
  assert.equal((await fx.store.snapshot("bot.retired")).bot, undefined);
  assert.equal((await fx.store.snapshot()).bot, undefined);
});

test("writes are denied across owners, unknown domains, disabled bots, and missing identity", async (t) => {
  const fx = await createFixture();
  t.after(() => rm(fx.base, { recursive: true, force: true }));

  await assert.rejects(
    fx.store.recordDomain("bot.architect", { domain: "library", kind: "observation", summary: "x" }),
    /may not record domain library owned by librarian/,
  );
  await assert.rejects(
    fx.store.recordDomain("bot.architect", { domain: "mystery", kind: "observation", summary: "x" }),
    /owned by nobody/,
  );
  await assert.rejects(
    fx.store.recordDomain("bot.architect", { domain: "../escape", kind: "observation", summary: "x" }),
    /unsafe domain name/,
  );
  await assert.rejects(
    fx.store.recordDomain("bot.retired", { domain: "architecture", kind: "observation", summary: "x" }),
    /no enabled bot for runtime name "bot.retired"/,
  );
  await assert.rejects(
    fx.store.recordDomain("bot.unknown", { domain: "architecture", kind: "observation", summary: "x" }),
    /no enabled bot/,
  );
  await assert.rejects(
    fx.store.recordDomain(undefined, { domain: "architecture", kind: "observation", summary: "x" }),
    /no enabled bot/,
  );
  await assert.rejects(fx.store.remember(undefined, { summary: "x" }), /no enabled bot/);

  assert.equal(existsSync(join(fx.root, ".pi", "team-context")), false);
  assert.equal(existsSync(join(fx.agentDir, "team-context")), false);
});

test("verified records require evidence while other kinds may omit it", async (t) => {
  const fx = await createFixture();
  t.after(() => rm(fx.base, { recursive: true, force: true }));

  await assert.rejects(
    fx.store.recordDomain("bot.architect", { domain: "architecture", kind: "verified", summary: "x" }),
    /verified domain record for architecture requires evidence/,
  );
  await assert.rejects(
    fx.store.recordDomain("bot.architect", {
      domain: "architecture",
      kind: "verified",
      summary: "x",
      evidence: "   ",
    }),
    /requires evidence/,
  );
  assert.equal(existsSync(join(fx.root, ".pi", "team-context", "architecture.md")), false);

  await fx.store.recordDomain("bot.architect", {
    domain: "architecture",
    kind: "verified",
    summary: "checked",
    evidence: "proof",
  });
  const content = await readFile(join(fx.root, ".pi", "team-context", "architecture.md"), "utf8");
  assert.match(content, /## 2026-01-01T00:00:01\.000Z verified test-id-1\nchecked\nEvidence: proof\n$/);
});

test("private memory is per bot, scope isolated, and off means denied", async (t) => {
  const fx = await createFixture();
  t.after(() => rm(fx.base, { recursive: true, force: true }));

  await fx.store.remember("bot.architect", { summary: "prefers RFC 2119 wording" });
  await fx.store.remember("bot.librarian", { summary: "user level note" });

  const projectMemory = join(fx.root, ".pi", "agent-memory", "pi-bots", "architect", "MEMORY.md");
  const userMemory = join(fx.agentDir, "agent-memory", "pi-bots", "librarian", "MEMORY.md");
  assert.equal(
    await readFile(projectMemory, "utf8"),
    "- 2026-01-01T00:00:01.000Z test-id-1 prefers RFC 2119 wording\n",
  );
  assert.equal(
    await readFile(userMemory, "utf8"),
    "- 2026-01-01T00:00:02.000Z test-id-2 user level note\n",
  );

  assert.equal(
    (await fx.store.snapshot("bot.architect")).memory,
    "- 2026-01-01T00:00:01.000Z test-id-1 prefers RFC 2119 wording\n",
  );
  assert.equal(
    (await fx.store.snapshot("bot.librarian")).memory,
    "- 2026-01-01T00:00:02.000Z test-id-2 user level note\n",
  );
  const auditorSnap = await fx.store.snapshot("bot.auditor");
  assert.equal(auditorSnap.bot?.name, "auditor");
  assert.equal(auditorSnap.memory, undefined);

  await assert.rejects(fx.store.remember("bot.auditor", { summary: "x" }), /bot auditor has private memory off/);
  assert.equal(existsSync(join(fx.root, ".pi", "agent-memory", "pi-bots", "auditor")), false);
});
test("private memory scope is independent from roster source scope", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-bots-memory-scope-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const projectRoot = join(base, "project");
  const agentDir = join(base, "agent");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  const bot = definition({
    name: "global-research",
    runtimeName: "bot.global-research",
    domains: ["research"],
    scope: "user",
    memory: "project",
  });
  const store = new BotStateStore({
    version: 1,
    bots: [bot],
    domainOwners: { research: bot.name },
    sources: [],
    projectRoot,
    agentDir,
  }, {
    clock: () => new Date("2026-01-01T00:00:00.000Z"),
    newId: () => "scope-id",
  });
  await store.remember(bot.runtimeName, { summary: "project-local note" });
  assert.equal(
    await readFile(join(projectRoot, ".pi", "agent-memory", "pi-bots", bot.name, "MEMORY.md"), "utf8"),
    "- 2026-01-01T00:00:00.000Z scope-id project-local note\n",
  );
  assert.equal(existsSync(join(agentDir, "agent-memory", "pi-bots", bot.name)), false);
});
test("state reads and writes reject symlinked files without exposing targets", async (t) => {
  const fx = await createFixture();
  t.after(() => rm(fx.base, { recursive: true, force: true }));
  const secret = join(fx.base, "secret.txt");
  await writeFile(secret, "LOCAL_SECRET");
  const domainDirectory = join(fx.root, ".pi", "team-context");
  const domainPath = join(domainDirectory, "architecture.md");
  await mkdir(domainDirectory, { recursive: true });
  await symlink(secret, domainPath);
  await assert.rejects(fx.store.snapshot(), /unsafe non-regular file/);
  await assert.rejects(
    fx.store.recordDomain("bot.architect", {
      domain: "architecture",
      kind: "observation",
      summary: "must not write",
    }),
    /unsafe non-regular file/,
  );
  await rm(domainPath);
  const memoryDirectory = join(fx.root, ".pi", "agent-memory", "pi-bots", "architect");
  const memoryPath = join(memoryDirectory, "MEMORY.md");
  await mkdir(memoryDirectory, { recursive: true });
  await symlink(secret, memoryPath);
  await assert.rejects(fx.store.snapshot("bot.architect"), /unsafe non-regular file/);
  await assert.rejects(
    fx.store.remember("bot.architect", { summary: "must not write" }),
    /unsafe non-regular file/,
  );
  assert.equal(await readFile(secret, "utf8"), "LOCAL_SECRET");
});


test("domain and memory files retain newest complete entries within the persisted limit", async (t) => {
  const fx = await createFixture();
  t.after(() => rm(fx.base, { recursive: true, force: true }));
  for (let index = 0; index < 8; index += 1) {
    await fx.store.recordDomain("bot.architect", {
      domain: "architecture",
      kind: "observation",
      summary: `DOMAIN_${index} ${"x".repeat(7_000)}`,
    });
    await fx.store.remember("bot.architect", {
      summary: `MEMORY_${index} ${"y".repeat(7_000)}`,
    });
  }
  const domainPath = join(fx.root, ".pi", "team-context", "architecture.md");
  const memoryPath = join(fx.root, ".pi", "agent-memory", "pi-bots", "architect", "MEMORY.md");
  const domain = await readFile(domainPath, "utf8");
  const memory = await readFile(memoryPath, "utf8");
  assert.ok(Buffer.byteLength(domain, "utf8") <= 32 * 1024);
  assert.ok(Buffer.byteLength(memory, "utf8") <= 32 * 1024);
  assert.equal(domain.includes("DOMAIN_0"), false);
  assert.equal(memory.includes("MEMORY_0"), false);
  assert.match(domain, /DOMAIN_7/);
  assert.match(memory, /MEMORY_7/);
  const snapshot = await fx.store.snapshot("bot.architect", "architecture");
  assert.match(snapshot.domains[0].content, /DOMAIN_7/);
  assert.match(snapshot.memory ?? "", /MEMORY_7/);
});

test("configured consecutive-dot domains remain owner-writable", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-bots-dotted-domain-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const projectRoot = join(base, "project");
  const agentDir = join(base, "agent");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  const bot = definition({
    name: "release",
    runtimeName: "bot.release",
    domains: ["release..notes"],
    scope: "project",
    memory: "off",
  });
  const store = new BotStateStore({
    version: 1,
    bots: [bot],
    domainOwners: { "release..notes": bot.name },
    sources: [],
    projectRoot,
    agentDir,
  });
  await store.recordDomain(bot.runtimeName, {
    domain: "release..notes",
    kind: "observation",
    summary: "safe dotted domain",
  });
  assert.match(
    await readFile(join(projectRoot, ".pi", "team-context", "release..notes.md"), "utf8"),
    /safe dotted domain/,
  );
});

test("existing domain ownership transfers while structural mismatches fail closed", async (t) => {
  const fx = await createFixture();
  t.after(() => rm(fx.base, { recursive: true, force: true }));

  const dir = join(fx.root, ".pi", "team-context");
  const path = join(dir, "architecture.md");
  await mkdir(dir, { recursive: true });
  const foreign = "---\nversion: 1\ndomain: architecture\nowner: someone-else\n---\n\n## prior\n";

  await writeFile(path, foreign);
  await fx.store.recordDomain("bot.architect", {
    domain: "architecture",
    kind: "observation",
    summary: "x",
  });
  const transferred = await readFile(path, "utf8");
  assert.match(transferred, /owner: architect/);
  assert.match(transferred, /## prior/);
  assert.match(transferred, /\nx\n/);

  await writeFile(path, "---\nversion: 2\ndomain: architecture\nowner: architect\n---\n");
  await assert.rejects(
    fx.store.recordDomain("bot.architect", { domain: "architecture", kind: "observation", summary: "x" }),
    /does not match expected/,
  );

  await writeFile(path, "---\nversion: 1\ndomain: library\nowner: architect\n---\n");
  await assert.rejects(
    fx.store.recordDomain("bot.architect", { domain: "architecture", kind: "observation", summary: "x" }),
    /does not match expected/,
  );

  await writeFile(path, "no frontmatter here\n");
  await assert.rejects(
    fx.store.recordDomain("bot.architect", { domain: "architecture", kind: "observation", summary: "x" }),
    /lacks version 1 domain frontmatter/,
  );

  await writeFile(path, "---\nversion: 1\ndomain: architecture\nowner: architect\nextra: true\n---\n");
  await assert.rejects(
    fx.store.recordDomain("bot.architect", { domain: "architecture", kind: "observation", summary: "x" }),
    /lacks version 1 domain frontmatter/,
  );

  await writeFile(path, "---\nversion: 1\ndomain: architecture\nowner: architect\n---\n");
  await fx.store.recordDomain("bot.architect", { domain: "architecture", kind: "inference", summary: "guess" });
  assert.equal(
    await readFile(path, "utf8"),
    "---\nversion: 1\ndomain: architecture\nowner: architect\n---\n\n" +
      "## 2026-01-01T00:00:06.000Z inference test-id-6\nguess\n",
  );
});

test("domain record entries are capped at 8 KiB", async (t) => {
  const fx = await createFixture();
  t.after(() => rm(fx.base, { recursive: true, force: true }));

  await fx.store.recordDomain("bot.architect", {
    domain: "architecture",
    kind: "observation",
    summary: "s".repeat(20_000),
  });
  await fx.store.recordDomain("bot.architect", {
    domain: "architecture",
    kind: "verified",
    summary: "s".repeat(20_000),
    evidence: "e".repeat(20_000),
  });

  const content = await readFile(join(fx.root, ".pi", "team-context", "architecture.md"), "utf8");
  const entries = content.split("\n\n").slice(1);
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.ok(Buffer.byteLength(entry, "utf8") <= 8 * 1024);
  }
  const [first, second] = entries;
  assert.match((first ?? "").trimEnd(), /^## 2026-01-01T00:00:01\.000Z observation test-id-1\ns+$/);
  assert.match((second ?? "").trimEnd(), /^## 2026-01-01T00:00:02\.000Z verified test-id-2\ns+\nEvidence: e+$/);
});

test("concurrent first records into an absent domain file keep both entries under one header", async (t) => {
  const fx = await createFixture();
  t.after(() => rm(fx.base, { recursive: true, force: true }));

  const results = await Promise.all([
    fx.store.recordDomain("bot.architect", {
      domain: "architecture",
      kind: "observation",
      summary: "alpha",
    }),
    fx.store.recordDomain("bot.architect", {
      domain: "architecture",
      kind: "observation",
      summary: "beta",
    }),
  ]);

  assert.deepEqual(
    results.map((result) => result.id).sort(),
    ["test-id-1", "test-id-2"],
  );
  const content = await readFile(join(fx.root, ".pi", "team-context", "architecture.md"), "utf8");
  const header = "---\nversion: 1\ndomain: architecture\nowner: architect\n---\n";
  assert.equal(content.split(header).length - 1, 1);
  assert.ok(content.includes("## 2026-01-01T00:00:01.000Z observation test-id-1\nalpha\n"));
  assert.ok(content.includes("## 2026-01-01T00:00:02.000Z observation test-id-2\nbeta\n"));
});
test("snapshot bounds each file and the 128 KiB aggregate memory-first with truncated flags", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-bots-state-bounds-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "project");
  const agentDir = join(base, "agent");
  const teamContext = join(root, ".pi", "team-context");
  const botMemory = join(root, ".pi", "agent-memory", "pi-bots", "bot-1");
  await mkdir(teamContext, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await mkdir(botMemory, { recursive: true });

  const bots: BotDefinition[] = [];
  const domainOwners: Record<string, string> = {};
  for (const index of [1, 2, 3, 4, 5]) {
    const name = `bot-${index}`;
    bots.push(
      definition({
        name,
        runtimeName: `bot.${name}`,
        domains: [`domain-${index}`],
        scope: "project",
        memory: index === 1 ? "project" : "off",
      }),
    );
    domainOwners[`domain-${index}`] = name;
    await writeFile(join(teamContext, `domain-${index}.md`), "x".repeat(40 * 1024));
  }
  await writeFile(join(botMemory, "MEMORY.md"), "m".repeat(40 * 1024));
  const store = new BotStateStore({
    version: 1,
    bots,
    domainOwners,
    sources: [],
    projectRoot: root,
    agentDir,
  });

  const snap = await store.snapshot("bot.bot-1");
  assert.equal(snap.bot?.name, "bot-1");
  assert.equal(Buffer.byteLength(snap.memory ?? "", "utf8"), 32 * 1024);
  const sizes = snap.domains.map((entry) => Buffer.byteLength(entry.content, "utf8"));
  assert.deepEqual(sizes, [32 * 1024, 32 * 1024, 32 * 1024, 0, 0]);
  assert.deepEqual(snap.domains.map((entry) => entry.truncated), [true, true, true, true, true]);
  const aggregate = sizes.reduce((total, size) => total + size, 0) + Buffer.byteLength(snap.memory ?? "", "utf8");
  assert.equal(aggregate, 128 * 1024);

  await writeFile(join(teamContext, "domain-1.md"), "y".repeat(10 * 1024));
  const small = await store.snapshot("bot.bot-1");
  assert.equal(small.bot?.name, "bot-1");
  assert.equal(Buffer.byteLength(small.domains[0]?.content ?? "", "utf8"), 10 * 1024);
  assert.equal(small.domains[0]?.truncated, false);
});


test("memory reads are bounded at the per-file cap", async (t) => {
  const fx = await createFixture();
  t.after(() => rm(fx.base, { recursive: true, force: true }));

  const memoryPath = join(fx.root, ".pi", "agent-memory", "pi-bots", "architect", "MEMORY.md");
  await fx.store.remember("bot.architect", { summary: "m".repeat(40 * 1024) });
  assert.ok(Buffer.byteLength(await readFile(memoryPath, "utf8"), "utf8") <= 8 * 1024);
  await writeFile(memoryPath, "m".repeat(40 * 1024));
  const snap = await fx.store.snapshot("bot.architect");
  assert.equal(Buffer.byteLength(snap.memory ?? "", "utf8"), 32 * 1024);
});
