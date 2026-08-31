import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import {
  BotConfigError,
  buildBotRoster,
  collectBotConfigCandidates,
  discoverBotRoster,
  defaultAgentDir,
  normalizeBotName,
  parseBotsConfig,
  runtimeBotName,
} from "../src/config.ts";
import type { ConfigCandidate } from "../src/types.ts";

async function createFixture(t: TestContext, files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-bots-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".git"));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

function parseErrorFor(content: string, source: string): BotConfigError {
  assert.throws(() => parseBotsConfig(content, source), BotConfigError);
  try {
    parseBotsConfig(content, source);
  } catch (error) {
    return error as BotConfigError;
  }
  throw new Error("expected parseBotsConfig to throw");
}

test("empty discovery yields an empty valid roster", async (t) => {
  const root = await createFixture(t, {});
  const agentDir = path.join(root, "agent");
  const roster = await discoverBotRoster(root, agentDir);
  assert.equal(roster.version, 1);
  assert.deepEqual(roster.bots, []);
  assert.deepEqual(roster.domainOwners, {});
  assert.deepEqual(roster.sources, []);
  assert.equal(roster.projectRoot, root);
  assert.equal(roster.agentDir, agentDir);
});

test("the Pi coding agent directory environment variable controls user discovery", () => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = "/tmp/pi-bots-agent-dir";
  try {
    assert.equal(defaultAgentDir(), "/tmp/pi-bots-agent-dir");
    process.env.PI_CODING_AGENT_DIR = "~/.pi/custom-agent";
    assert.equal(defaultAgentDir(), path.join(homedir(), ".pi", "custom-agent"));
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test("native agent materialization follows the nearest Pi project root", async (t) => {
  const root = await createFixture(t, {
    ".pi/BOTS.yml": "version: 1\nbots: []\n",
    "pkg/.pi/BOTS.yml": "version: 1\nbots: []\n",
  });
  const cwd = path.join(root, "pkg", "src");
  await mkdir(cwd, { recursive: true });
  const roster = await discoverBotRoster(cwd, path.join(root, "agent"));
  assert.equal(roster.projectRoot, root);
  assert.equal(roster.agentProjectRoot, path.join(root, "pkg"));
});

test("native agent materialization honors git-root project resolution", async (t) => {
  const root = await createFixture(t, {
    ".pi/BOTS.yml": "version: 1\nbots: []\n",
    "pkg/.pi/BOTS.yml": "version: 1\nbots: []\n",
    "pkg/.pi/settings.json": JSON.stringify({
      subagents: { projectRootResolution: "git-root" },
    }),
  });
  const cwd = path.join(root, "pkg", "src");
  await mkdir(cwd, { recursive: true });
  const roster = await discoverBotRoster(cwd, path.join(root, "agent"));
  assert.equal(roster.agentProjectRoot, root);
});

test("user and project configs merge with project whole-bot precedence", async (t) => {
  const root = await createFixture(t, {
    "agent/BOTS.yml": `
version: 1
defaults:
  timeoutMs: 60000
bots:
  - name: engineering
    title: Engineering
    description: user engineering
    domains: [engineering]
    model: user-model
    tools: [read]
  - name: research
    title: Research
    description: research bot
    domains: [research]
`,
    ".pi/BOTS.yml": `
version: 1
bots:
  - name: engineering
    title: Engineering
    description: project engineering
    domains: [engineering]
    model: project-model
`,
  });
  const roster = await discoverBotRoster(root, path.join(root, "agent"));
  assert.deepEqual(roster.sources, [
    path.join(root, "agent/BOTS.yml"),
    path.join(root, ".pi/BOTS.yml"),
  ]);
  assert.equal(roster.bots.length, 2);
  const engineering = roster.bots.find((bot) => bot.name === "engineering");
  assert.ok(engineering);
  assert.equal(engineering.scope, "project");
  assert.equal(engineering.configPath, path.join(root, ".pi/BOTS.yml"));
  assert.equal(engineering.model, "project-model");
  assert.equal(engineering.description, "project engineering");
  assert.equal(engineering.tools, undefined);
  assert.equal(engineering.timeoutMs, 60000);
  const research = roster.bots.find((bot) => bot.name === "research");
  assert.ok(research);
  assert.equal(research.scope, "user");
  assert.equal(research.model, undefined);
  assert.equal(research.timeoutMs, 60000);
  assert.deepEqual(roster.domainOwners, {
    engineering: "engineering",
    research: "research",
  });
});

test("defaults fill missing fields and builtin defaults cover the rest", () => {
  const content = `
version: 1
defaults:
  model: base-model
  fallbackModels: [fallback-a, fallback-b]
  thinking: low
  memory: user
  context: fork
  maxSubagentDepth: 2
bots:
  - name: engineering
    title: Engineering
    description: builds things
    domains: [engineering]
    model: own-model
    fallbackModels: [own-fallback]
`;
  const candidates: ConfigCandidate[] = [
    { path: "/cfg/BOTS.yml", content, scope: "project", precedence: 1 },
  ];
  const roster = buildBotRoster(candidates, "/agent", "/root");
  assert.equal(roster.bots.length, 1);
  const bot = roster.bots[0];
  assert.equal(bot.model, "own-model");
  assert.deepEqual(bot.fallbackModels, ["own-fallback"]);
  assert.equal(bot.thinking, "low");
  assert.equal(bot.memory, "user");
  assert.equal(bot.context, "fork");
  assert.equal(bot.maxSubagentDepth, 2);
  assert.equal(bot.timeoutMs, 900000);
  assert.deepEqual(bot.delegates, []);
  assert.equal(bot.enabled, true);
  assert.deepEqual(roster.domainOwners, { engineering: "engineering" });

  const bare = parseBotsConfig("version: 1\nbots: []\n", "/cfg/empty.yml");
  assert.deepEqual(bare.bots, []);
  assert.equal(bare.sharedInstructions, undefined);
  assert.equal(bare.defaults, undefined);
});
test("zero depth and prototype-shaped domain names preserve native contracts", () => {
  const content = `
version: 1
bots:
  - name: leaf
    domains: [constructor, release..notes]
    maxSubagentDepth: 0
`;
  const roster = buildBotRoster(
    [{ path: "/cfg/BOTS.yml", content, scope: "project", precedence: 1 }],
    "/agent",
    "/root",
  );
  assert.equal(roster.bots[0].maxSubagentDepth, 0);
  assert.deepEqual(roster.domainOwners, Object.fromEntries([
    ["constructor", "leaf"],
    ["release..notes", "leaf"],
  ]));
  assert.equal(Object.hasOwn(roster.domainOwners, "constructor"), true);
});

test("prototype-named unknown fields and self-delegation fail closed", () => {
  assert.match(
    parseErrorFor("version: 1\nconstructor: ignored\nbots: []\n", "/cfg/BOTS.yml").message,
    /unknown field "constructor"/,
  );
  assert.throws(
    () => buildBotRoster(
      [{
        path: "/cfg/BOTS.yml",
        content: "version: 1\nbots:\n  - name: loop\n    domains: [loop]\n    delegates: [loop]\n",
        scope: "project",
        precedence: 1,
      }],
      "/agent",
      "/root",
    ),
    /may not delegate to itself/,
  );
});


test("duplicate effective domain ownership fails closed", () => {
  const content = `
version: 1
bots:
  - name: alpha
    title: Alpha
    description: alpha bot
    domains: [engineering]
  - name: beta
    title: Beta
    description: beta bot
    domains: [engineering]
`;
  const candidates: ConfigCandidate[] = [
    { path: "/cfg/BOTS.yml", content, scope: "project", precedence: 1 },
  ];
  assert.throws(
    () => buildBotRoster(candidates, "/agent", "/root"),
    (error: unknown) =>
      error instanceof BotConfigError &&
      error.path === "/cfg/BOTS.yml" &&
      /domain "engineering" is owned by both "alpha" and "beta"/.test(error.message),
  );
});

test("malformed files fail closed with path-qualified errors", () => {
  const source = "/cfg/broken/BOTS.yml";
  const cases: Array<[string, RegExp]> = [
    ["not: [valid", /invalid YAML/],
    ["- just\n- a\n- list\n", /"config" must be a mapping/],
    ["bots: []\n", /"version" must be 1/],
    ["version: 2\nbots: []\n", /"version" must be 1/],
    ["version: 1\nunknown: true\nbots: []\n", /"config" has unknown field "unknown"/],
    [
      "version: 1\nbots:\n  - name: a\n    domains: [x]\n    bogus: 1\n",
      /"bots\[0\]" has unknown field "bogus"/,
    ],
    [
      "version: 1\ndefaults:\n  bogus: 1\nbots: []\n",
      /"defaults" has unknown field "bogus"/,
    ],
    [
      "version: 1\nbots:\n  - domains: [x]\n",
      /"bots\[0\]" requires a non-empty string "name"/,
    ],
    [
      "version: 1\nbots:\n  - name: a\n",
      /"bots\[0\]" requires a non-empty "domains" array/,
    ],
    [
      "version: 1\nbots:\n  - name: a\n    domains: []\n",
      /"bots\[0\]" requires a non-empty "domains" array/,
    ],
    [
      "version: 1\nbots:\n  - name: a\n    domains: [x]\n    memory: everywhere\n",
      /"bots\[0\]\.memory" must be one of user, project, off/,
    ],
    [
      "version: 1\nbots:\n  - name: a\n    domains: [x]\n    thinking: ultra\n",
      /"bots\[0\]\.thinking" must be false or one of/,
    ],
    [
      "version: 1\nbots:\n  - name: a\n    domains: [x]\n    timeoutMs: 0\n",
      /"bots\[0\]\.timeoutMs" must be between/,
    ],
    [
      "version: 1\nbots:\n  - name: a\n    domains: [x]\n    maxSubagentDepth: 99\n",
      /"bots\[0\]\.maxSubagentDepth" must be between/,
    ],
    [
      "version: 1\nbots:\n  - name: a\n    domains: [x, x]\n",
      /"bots\[0\]\.domains" repeats domain "x"/,
    ],
    [
      "version: 1\nbots:\n  - name: A\n    domains: [x]\n  - name: a\n    domains: [y]\n",
      /"bots\[1\]" duplicates bot name "a"/,
    ],
    [
      "version: 1\nbots:\n  - name: a\n    domains: [x]\n    delegates: ['!!!']\n",
      /"bots\[0\]\.delegates" entry "!!!" is not a valid bot name/,
    ],
  ];
  for (const [content, pattern] of cases) {
    const error = parseErrorFor(content, source);
    assert.match(error.message, pattern);
    assert.ok(error.message.startsWith(`${source}: `));
    assert.equal(error.path, source);
  }
});

test("disabled bots stay in the roster but do not own domains", async (t) => {
  const root = await createFixture(t, {
    ".pi/BOTS.yml": `
version: 1
bots:
  - name: retired
    title: Retired
    description: old bot
    domains: [engineering]
    enabled: false
  - name: active
    title: Active
    description: new bot
    domains: [engineering]
`,
  });
  const roster = await discoverBotRoster(root, path.join(root, "agent"));
  assert.equal(roster.bots.length, 2);
  const retired = roster.bots.find((bot) => bot.name === "retired");
  assert.ok(retired);
  assert.equal(retired.enabled, false);
  assert.deepEqual(roster.domainOwners, { engineering: "active" });
});

test("delegates must reference enabled bots", () => {
  const makeRoster = (content: string) =>
    buildBotRoster(
      [{ path: "/cfg/BOTS.yml", content, scope: "project", precedence: 1 }],
      "/agent",
      "/root",
    );
  const valid = `
version: 1
bots:
  - name: chief
    title: Chief
    description: coordinator
    domains: [coordination]
    delegates: [research-bot, ops]
  - name: research-bot
    title: Research Bot
    description: research
    domains: [research]
  - name: ops
    title: Ops
    description: operations
    domains: [operations]
`;
  const roster = makeRoster(valid);
  const chief = roster.bots.find((bot) => bot.name === "chief");
  assert.ok(chief);
  assert.deepEqual(chief.delegates, ["research-bot", "ops"]);

  assert.throws(
    () =>
      makeRoster(`
version: 1
bots:
  - name: chief
    title: Chief
    description: coordinator
    domains: [coordination]
    delegates: [ghost]
`),
    (error: unknown) =>
      error instanceof BotConfigError &&
      error.path === "/cfg/BOTS.yml" &&
      /delegates to "ghost", which is not defined/.test(error.message),
  );

  assert.throws(
    () =>
      makeRoster(`
version: 1
bots:
  - name: chief
    title: Chief
    description: coordinator
    domains: [coordination]
    delegates: [retired]
  - name: retired
    title: Retired
    description: disabled
    domains: [legacy]
    enabled: false
`),
    (error: unknown) =>
      error instanceof BotConfigError &&
      /delegates to "retired", which is disabled/.test(error.message),
  );
});

test("runtime names are exact normalized slugs while ownership uses bot names", async (t) => {
  assert.equal(runtimeBotName("Chief of Staff"), "bot.chief-of-staff");
  assert.equal(runtimeBotName("  RESEARCH  "), "bot.research");
  assert.equal(runtimeBotName("ops_bot.v2"), "bot.ops-bot-v2");
  assert.equal(normalizeBotName("Ops Bot"), "ops-bot");
  const root = await createFixture(t, {
    ".pi/BOTS.yml": `
version: 1
bots:
  - name: Chief of Staff
    title: Chief
    description: coordinator
    domains: [coordination]
`,
  });
  const roster = await discoverBotRoster(root, path.join(root, "agent"));
  assert.equal(roster.bots[0].runtimeName, "bot.chief-of-staff");
  assert.equal(roster.bots[0].name, "chief-of-staff");
  assert.deepEqual(roster.domainOwners, { coordination: "chief-of-staff" });
});

test("closer project configs win whole-bot definitions and shared instructions", async (t) => {
  const root = await createFixture(t, {
    "agent/BOTS.yml": "version: 1\nbots: []\n",
    ".pi/BOTS.yml": `
version: 1
instructions: outer shared
bots:
  - name: config
    title: Config
    description: outer config bot
    domains: [config]
    model: outer-model
`,
    "pkg/.pi/BOTS.yml": `
version: 1
instructions: inner shared
bots:
  - name: config
    title: Config
    description: inner config bot
    domains: [config]
    model: inner-model
`,
  });
  const roster = await discoverBotRoster(path.join(root, "pkg"), path.join(root, "agent"));
  assert.equal(roster.sharedInstructions, "inner shared");
  assert.equal(roster.bots.length, 1);
  assert.equal(roster.bots[0].model, "inner-model");
  assert.equal(roster.bots[0].description, "inner config bot");
  assert.deepEqual(roster.sources, [
    path.join(root, "agent/BOTS.yml"),
    path.join(root, ".pi/BOTS.yml"),
    path.join(root, "pkg/.pi/BOTS.yml"),
  ]);
  assert.equal(roster.projectRoot, root);
});

test("BOTS.yaml is discovered when BOTS.yml is absent", async (t) => {
  const root = await createFixture(t, {
    "agent/BOTS.yaml": `
version: 1
bots:
  - name: yaml-bot
    title: Yaml
    description: from yaml
    domains: [yaml]
`,
    ".pi/BOTS.yaml": `
version: 1
bots:
  - name: project-yaml
    title: Project Yaml
    description: project yaml
    domains: [project-yaml]
`,
  });
  const roster = await discoverBotRoster(root, path.join(root, "agent"));
  assert.deepEqual(roster.sources, [
    path.join(root, "agent/BOTS.yaml"),
    path.join(root, ".pi/BOTS.yaml"),
  ]);
  assert.deepEqual(
    roster.bots.map((bot) => bot.name).sort(),
    ["project-yaml", "yaml-bot"],
  );
});

test("collectBotConfigCandidates orders user first then outermost to closest", async (t) => {
  const root = await createFixture(t, {
    "agent/BOTS.yml": "version: 1\nbots: []\n",
    ".pi/BOTS.yml": "version: 1\nbots: []\n",
    "pkg/.pi/BOTS.yml": "version: 1\nbots: []\n",
    "pkg/sub/.pi/BOTS.yml": "version: 1\nbots: []\n",
  });
  const candidates = await collectBotConfigCandidates(path.join(root, "pkg", "sub"), {
    agentDir: path.join(root, "agent"),
  });
  assert.deepEqual(candidates.map((candidate) => candidate.path), [
    path.join(root, "agent/BOTS.yml"),
    path.join(root, ".pi/BOTS.yml"),
    path.join(root, "pkg/.pi/BOTS.yml"),
    path.join(root, "pkg/sub/.pi/BOTS.yml"),
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.scope), [
    "user",
    "project",
    "project",
    "project",
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.precedence), [0, 1, 2, 3]);
});
