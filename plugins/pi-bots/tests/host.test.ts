import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverBotRoster } from "../src/config.ts";
import { installPiBots, PiBotsController } from "../src/host.ts";
import { materializeBotAgents } from "../src/materialize.ts";
import {
  DELEGATION_CANCEL_EVENT,
  DELEGATION_REQUEST_EVENT,
  DELEGATION_RESPONSE_EVENT,
  type EventBus,
} from "../src/subagents.ts";

type HostContext = {
  cwd?: string;
  signal?: AbortSignal;
  sessionManager?: { getSessionId?: () => string };
  ui?: { notify?: (message: string, level?: string) => void };
};

type DelegationRequestEnvelope = {
  requestId: string;
  ownerRunId: string;
  nodeId: string;
  agent: string;
  task: string;
  context: string;
  cwd: string;
  timeoutMs: number;
  result: { kind: "text" };
};


type CancellationEnvelope = { requestId: string; ownerRunId: string; nodeId: string };

const USAGE = {
  input: 11,
  output: 7,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0.01,
  turns: 2,
  toolCalls: 1,
  durationMs: 5,
};

const BOTS_YML = `version: 1
instructions: |
  SHARED_INSTRUCTIONS_MARKER
defaults:
  memory: project
  context: fresh
  timeoutMs: 900000
  maxSubagentDepth: 3
bots:
  - name: engineering
    title: Engineering Bot
    description: Owns implementation and verification.
    domains: [engineering]
    delegates: [research]
    model: test/engine-a
    fallbackModels: [test/engine-b]
    thinking: high
    tools: [read, grep, bash, edit]
    instructions: |
      ENGINEERING_CHARTER_MARKER
  - name: research
    title: Research Bot
    description: Owns source-grounded research.
    domains: [research]
    tools: [read, grep]
    instructions: |
      RESEARCH_CHARTER_MARKER
`;

const DUPLICATE_DOMAIN_YML = `version: 1
bots:
  - name: alpha
    title: Alpha Bot
    description: First claim on the shared domain.
    domains: [shared]
  - name: beta
    title: Beta Bot
    description: Second claim on the shared domain.
    domains: [shared]
`;

type Workspace = { root: string; projectDir: string; agentDir: string; configPath: string };

async function createWorkspace(config = BOTS_YML): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-bots-host-"));
  const projectDir = path.join(root, "project");
  const agentDir = path.join(root, "agent");
  const configPath = path.join(projectDir, ".pi", "BOTS.yml");
  await mkdir(path.join(projectDir, ".git"), { recursive: true });
  await mkdir(path.join(projectDir, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(configPath, config);
  return { root, projectDir, agentDir, configPath };
}

async function withWorkspace<T>(run: (workspace: Workspace) => Promise<T>, config?: string): Promise<T> {
  const workspace = await createWorkspace(config);
  try {
    return await run(workspace);
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
}

async function withParentEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = { child: process.env.PI_SUBAGENT_CHILD, agent: process.env.PI_SUBAGENT_CHILD_AGENT };
  delete process.env.PI_SUBAGENT_CHILD;
  delete process.env.PI_SUBAGENT_CHILD_AGENT;
  try {
    return await run();
  } finally {
    if (previous.child === undefined) delete process.env.PI_SUBAGENT_CHILD;
    else process.env.PI_SUBAGENT_CHILD = previous.child;
    if (previous.agent === undefined) delete process.env.PI_SUBAGENT_CHILD_AGENT;
    else process.env.PI_SUBAGENT_CHILD_AGENT = previous.agent;
  }
}

async function withChildEnv<T>(agentName: string, run: () => Promise<T>): Promise<T> {
  const previous = { child: process.env.PI_SUBAGENT_CHILD, agent: process.env.PI_SUBAGENT_CHILD_AGENT };
  process.env.PI_SUBAGENT_CHILD = "1";
  process.env.PI_SUBAGENT_CHILD_AGENT = agentName;
  try {
    return await run();
  } finally {
    if (previous.child === undefined) delete process.env.PI_SUBAGENT_CHILD;
    else process.env.PI_SUBAGENT_CHILD = previous.child;
    if (previous.agent === undefined) delete process.env.PI_SUBAGENT_CHILD_AGENT;
    else process.env.PI_SUBAGENT_CHILD_AGENT = previous.agent;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

class FakeBus implements EventBus {
  readonly delegationRequests: DelegationRequestEnvelope[] = [];
  readonly cancellationRequests: CancellationEnvelope[] = [];
  respond: (request: DelegationRequestEnvelope) => void = (request) => {
    this.complete(request, { kind: "text", text: `handled ${request.task}` });
  };

  #handlers = new Map<string, Array<(payload: unknown) => void>>();

  constructor() {
    this.on(DELEGATION_REQUEST_EVENT, (payload) => {
      const request = payload as DelegationRequestEnvelope;
      this.delegationRequests.push(request);
      this.respond(request);
    });
    this.on(DELEGATION_CANCEL_EVENT, (payload) => {
      this.cancellationRequests.push(payload as CancellationEnvelope);
    });
  }

  on(event: string, handler: (payload: unknown) => void): () => void {
    const handlers = this.#handlers.get(event) ?? [];
    handlers.push(handler);
    this.#handlers.set(event, handlers);
    return () => {
      const current = this.#handlers.get(event) ?? [];
      const index = current.indexOf(handler);
      if (index >= 0) current.splice(index, 1);
    };
  }

  emit(event: string, payload: unknown): void {
    for (const handler of [...(this.#handlers.get(event) ?? [])]) handler(payload);
  }

  complete(request: DelegationRequestEnvelope, result: { kind: "text"; text: string }): void {
    this.emit(DELEGATION_RESPONSE_EVENT, {
      requestId: request.requestId,
      ownerRunId: request.ownerRunId,
      nodeId: request.nodeId,
      status: "completed",
      agent: request.agent,
      model: "test/model",
      thinking: "low",
      result,
      usage: USAGE,
    });
  }

  fail(request: DelegationRequestEnvelope, error: string): void {
    this.emit(DELEGATION_RESPONSE_EVENT, {
      requestId: request.requestId,
      ownerRunId: request.ownerRunId,
      nodeId: request.nodeId,
      status: "failed",
      agent: request.agent,
      error,
    });
  }
}

type HostEventHandler = (event: unknown, context: HostContext) => unknown;

type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    context: HostContext,
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
};

type RegisteredCommand = {
  description?: string;
  handler: (args: string, context: HostContext) => Promise<void>;
};

class FakeHost {
  readonly events = new FakeBus();
  readonly handlers = new Map<string, HostEventHandler>();
  readonly tools = new Map<string, RegisteredTool>();
  readonly commands = new Map<string, RegisteredCommand>();

  on(event: string, handler: HostEventHandler): void {
    this.handlers.set(event, handler);
  }

  registerTool(definition: RegisteredTool): void {
    this.tools.set(definition.name, definition);
  }

  registerCommand(name: string, options: RegisteredCommand): void {
    this.commands.set(name, options);
  }
}

function hostContext(workspace: Workspace, sessionId = "parent-session"): HostContext {
  return {
    cwd: workspace.projectDir,
    sessionManager: { getSessionId: () => sessionId },
  };
}

async function runTool(host: FakeHost, input: unknown, context: HostContext, toolCallId = "tool-call"): Promise<string> {
  const tool = host.tools.get("bots");
  assert.ok(tool);
  const result = await tool.execute(toolCallId, input, undefined, undefined, context);
  assert.deepEqual(result.content.map(({ type }) => type), ["text"]);
  return result.content[0].text;
}

async function runCommand(host: FakeHost, args: string, context: HostContext): Promise<string[]> {
  const command = host.commands.get("bots");
  assert.ok(command);
  const notifications: string[] = [];
  await command.handler(args, { ...context, ui: { notify: (message: string) => notifications.push(message) } });
  return notifications;
}

async function seedDomainFiles(workspace: Workspace): Promise<void> {
  await mkdir(path.join(workspace.projectDir, ".pi", "team-context"), { recursive: true });
  await mkdir(path.join(workspace.projectDir, ".pi", "agent-memory", "pi-bots", "research"), { recursive: true });
  await mkdir(path.join(workspace.projectDir, ".pi", "agent-memory", "pi-bots", "engineering"), { recursive: true });
  await writeFile(
    path.join(workspace.projectDir, ".pi", "team-context", "engineering.md"),
    "---\nversion: 1\ndomain: engineering\nowner: engineering\n---\n\nENGINEERING_DOMAIN_SECRET",
  );
  await writeFile(
    path.join(workspace.projectDir, ".pi", "team-context", "research.md"),
    "---\nversion: 1\ndomain: research\nowner: research\n---\n\nRESEARCH_DOMAIN_SECRET",
  );
  await writeFile(
    path.join(workspace.projectDir, ".pi", "agent-memory", "pi-bots", "research", "MEMORY.md"),
    "RESEARCH_MEMORY_SECRET",
  );
  await writeFile(
    path.join(workspace.projectDir, ".pi", "agent-memory", "pi-bots", "engineering", "MEMORY.md"),
    "ENGINEERING_MEMORY_SECRET",
  );
}

async function installedHost(workspace: Workspace): Promise<{ host: FakeHost; controller: PiBotsController }> {
  const host = new FakeHost();
  const controller = installPiBots(host, { agentDir: workspace.agentDir });
  assert.ok(controller);
  await host.handlers.get("session_start")!(undefined, hostContext(workspace));
  return { host, controller };
}

test("install wires session handlers, one bots tool, and the /bots command", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const host = new FakeHost();
      const controller = installPiBots(host, { agentDir: workspace.agentDir });
      assert.ok(controller);
      assert.deepEqual([...host.handlers.keys()].sort(), ["before_agent_start", "session_shutdown", "session_start"]);
      assert.deepEqual([...host.tools.keys()], ["bots"]);
      const tool = host.tools.get("bots");
      assert.ok(tool);
      assert.equal(tool.label, "Pi Bots");
      assert.match(tool.description, /native subagent/);
      assert.match(host.commands.get("bots")?.description ?? "", /Pi domain bots/);
      assert.equal(controller.currentRoster(), undefined);
      assert.deepEqual(controller.availableNames(), []);
    });
  });
});

test("session_start activates enabled bots from the project-native mirror", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const { controller } = await installedHost(workspace);
      assert.deepEqual(controller.availableNames(), ["bot.engineering", "bot.research"]);
      const roster = controller.currentRoster();
      assert.ok(roster);
      assert.deepEqual(roster.bots.map((bot) => bot.name), ["engineering", "research"]);
      assert.deepEqual(roster.domainOwners, { engineering: "engineering", research: "research" });
      assert.deepEqual(roster.sources, [workspace.configPath]);
    });
  });
});
test("session_start mirrors bots into the effective native subagent project root", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const nested = path.join(workspace.projectDir, "pkg");
      const cwd = path.join(nested, "src");
      await mkdir(path.join(nested, ".pi"), { recursive: true });
      await mkdir(cwd, { recursive: true });
      await writeFile(path.join(nested, ".pi", "BOTS.yml"), "version: 1\nbots: []\n");
      const controller = new PiBotsController(new FakeBus(), { agentDir: workspace.agentDir });
      await controller.reload(cwd);
      assert.equal(
        await pathExists(path.join(nested, ".pi", "agents", "pi-bots.generated", "bot.engineering.md")),
        true,
      );
      assert.equal(
        await pathExists(path.join(workspace.projectDir, ".pi", "agents", "pi-bots.generated")),
        false,
      );
    });
  });
});

test("overlapping reloads serialize distinct working directories", async () => {
  await withParentEnv(async () => {
    const first = await createWorkspace(BOTS_YML);
    const second = await createWorkspace(`version: 1
bots:
  - name: operations
    title: Operations Bot
    description: Owns operations.
    domains: [operations]
`);
    try {
      const controller = new PiBotsController(new FakeBus(), { agentDir: first.agentDir });
      const [firstRoster, secondRoster] = await Promise.all([
        controller.reload(first.projectDir),
        controller.reload(second.projectDir),
      ]);
      assert.deepEqual(firstRoster.sources, [first.configPath]);
      assert.deepEqual(secondRoster.sources, [second.configPath]);
      assert.deepEqual(secondRoster.bots.map((bot) => bot.name), ["operations"]);
      assert.deepEqual(controller.currentRoster()?.sources, [second.configPath]);
      assert.deepEqual(controller.availableNames(), ["bot.operations"]);
    } finally {
      await rm(first.root, { recursive: true, force: true });
      await rm(second.root, { recursive: true, force: true });
    }
  });
});
test("ensure joins an active same-directory reload instead of returning a cached roster", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const controller = new PiBotsController(new FakeBus(), { agentDir: workspace.agentDir });
      await controller.reload(workspace.projectDir);
      await writeFile(workspace.configPath, `version: 1
bots:
  - name: operations
    title: Operations Bot
    description: Owns operations.
    domains: [operations]
`);
      const pending = controller.reload(workspace.projectDir);
      const ensured = await controller.ensure(workspace.projectDir);
      await pending;
      assert.deepEqual(ensured.bots.map((bot) => bot.name), ["operations"]);
    });
  });
});

test("ensure reloads when another controller replaces the shared native mirror", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const first = new PiBotsController(new FakeBus(), { agentDir: workspace.agentDir });
      const second = new PiBotsController(new FakeBus(), { agentDir: workspace.agentDir });
      await first.reload(workspace.projectDir);
      await writeFile(workspace.configPath, `version: 1
bots:
  - name: operations
    title: Operations Bot
    description: Owns operations.
    domains: [operations]
`);
      await second.reload(workspace.projectDir);
      const refreshed = await first.ensure(workspace.projectDir);
      assert.deepEqual(refreshed.bots.map((bot) => bot.name), ["operations"]);
      assert.deepEqual(first.availableNames(), ["bot.operations"]);
    });
  });
});


test("session_start mirrors configured bots into project-native agent files", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const { controller } = await installedHost(workspace);
      const directory = path.join(workspace.projectDir, ".pi", "agents", "pi-bots.generated");
      assert.equal(
        await readFile(path.join(directory, ".gitignore"), "utf8"),
        "*.md\npi-bots-extension.ts\n",
      );
      const engineering = await readFile(path.join(directory, "bot.engineering.md"), "utf8");
      const research = await readFile(path.join(directory, "bot.research.md"), "utf8");
      assert.match(engineering, /^---\nname: "bot\.engineering"/);
      assert.match(engineering, /tools: "read, grep, bash, edit, bots, subagent"/);
      assert.match(engineering, /allowNestedSubagents: true/);
      assert.match(engineering, /subagentOnlyExtensions: ".*pi-bots\.generated\/pi-bots-extension\.ts"/);
      assert.match(engineering, /mutationTools: "bots"/);
      assert.match(engineering, /model: "test\/engine-a"/);
      assert.match(engineering, /ENGINEERING_CHARTER_MARKER/);
      assert.match(engineering, /`bot\.research`/);
      assert.match(research, /^---\nname: "bot\.research"/);
      const extension = await readFile(path.join(directory, "pi-bots-extension.ts"), "utf8");
      assert.ok(extension.includes(JSON.stringify(workspace.agentDir)));
      await writeFile(path.join(directory, "bot.stale.md"), "stale");
      await controller.reload(workspace.projectDir);
      assert.equal(await pathExists(path.join(directory, "bot.stale.md")), false);
    });
  });
});
test("materialization refreshes a stale candidate after acquiring publication locks", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const initial = await discoverBotRoster(workspace.projectDir, workspace.agentDir);
      await writeFile(workspace.configPath, `version: 1
bots:
  - name: operations
    title: Operations Bot
    description: Owns operations.
    domains: [operations]
`);
      const materialized = await materializeBotAgents(
        initial,
        () => discoverBotRoster(workspace.projectDir, workspace.agentDir),
      );
      assert.deepEqual(materialized.roster.bots.map((bot) => bot.name), ["operations"]);
      assert.equal(
        await pathExists(path.join(materialized.directory, "bot.operations.md")),
        true,
      );
      assert.equal(
        await pathExists(path.join(materialized.directory, "bot.engineering.md")),
        false,
      );
    });
  });
});

test("agent materialization rejects a generated-directory symlink without touching its target", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const outside = path.join(workspace.root, "outside");
      const agents = path.join(workspace.projectDir, ".pi", "agents");
      const generated = path.join(agents, "pi-bots.generated");
      await mkdir(outside, { recursive: true });
      await mkdir(agents, { recursive: true });
      await writeFile(path.join(outside, "keep.md"), "KEEP");
      await symlink(outside, generated, "dir");
      const controller = new PiBotsController(new FakeBus(), { agentDir: workspace.agentDir });
      await assert.rejects(controller.reload(workspace.projectDir), /unsafe generated agent symlink/);
      assert.equal(await readFile(path.join(outside, "keep.md"), "utf8"), "KEEP");
      assert.equal(await pathExists(path.join(outside, "bot.engineering.md")), false);
    });
  });
});
test("agent materialization rejects a generated-generation symlink escape", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const outside = path.join(workspace.root, "outside");
      const piDirectory = path.join(workspace.projectDir, ".pi");
      const agents = path.join(piDirectory, "agents");
      const generations = path.join(piDirectory, "pi-bots-generations");
      const generated = path.join(agents, "pi-bots.generated");
      await mkdir(outside, { recursive: true });
      await mkdir(agents, { recursive: true });
      await mkdir(generations, { recursive: true });
      await writeFile(path.join(outside, "keep.md"), "KEEP");
      await symlink(outside, path.join(generations, "evil"), "dir");
      await symlink("../pi-bots-generations/evil", generated, "dir");
      const controller = new PiBotsController(new FakeBus(), { agentDir: workspace.agentDir });
      await assert.rejects(controller.reload(workspace.projectDir), /unsafe generated agent symlink/);
      assert.equal(await readFile(path.join(outside, "keep.md"), "utf8"), "KEEP");
      assert.equal(await pathExists(path.join(outside, "bot.engineering.md")), false);
    });
  });
});



test("bots list reports roster, registration health, and the native-subagent boundary", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const { host } = await installedHost(workspace);
      const output = await runTool(host, { action: "list" }, hostContext(workspace));
      assert.match(output, /- engineering — Engineering Bot \[available\]/);
      assert.match(output, /runtime: bot\.engineering/);
      assert.match(output, /domains: engineering/);
      assert.match(output, /delegates: research/);
      assert.match(output, /models: test\/engine-a → test\/engine-b/);
      assert.match(output, /memory: project/);
      assert.match(output, /- research — Research Bot \[available\]/);
      assert.match(output, /runtime: bot\.research/);
      assert.match(output, /domains: research/);
      assert.match(output, /delegates: none/);
      assert.match(output, /models: Pi default/);
      assert.ok(output.includes(`Sources: ${workspace.configPath}`));
      assert.match(
        output,
        /Background, schedules, status, steering, stop, resume, and FleetView use the native subagent surface\./,
      );
    });
  });
});

test("before_agent_start injects the parent roster without live domain or memory contents", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const { host } = await installedHost(workspace);
      await seedDomainFiles(workspace);
      const handler = host.handlers.get("before_agent_start");
      assert.ok(handler);
      const result = (await handler({ systemPrompt: "BASE_PROMPT" }, hostContext(workspace))) as {
        systemPrompt: string;
      };
      assert.match(result.systemPrompt, /^BASE_PROMPT/);
      assert.match(result.systemPrompt, /- `bot\.engineering` \(project\) — Engineering Bot/);
      assert.match(result.systemPrompt, /- `bot\.research` \(project\) — Research Bot/);
      assert.match(result.systemPrompt, /domains: engineering/);
      assert.match(result.systemPrompt, /domains: research/);
      assert.match(result.systemPrompt, /never embedded in this prompt/);
      assert.equal(result.systemPrompt.includes("ENGINEERING_DOMAIN_SECRET"), false);
      assert.equal(result.systemPrompt.includes("RESEARCH_DOMAIN_SECRET"), false);
      assert.equal(result.systemPrompt.includes("RESEARCH_MEMORY_SECRET"), false);
      assert.equal(result.systemPrompt.includes("Private memory"), false);
    });
  });
});

test("bots run delegates the foreground task to the exact runtime agent and returns the envelope", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const { host } = await installedHost(workspace);
      const context = hostContext(workspace, "parent-run-7");
      const output = await runTool(
        host,
        { action: "run", bot: "research", task: "  Find primary sources  " },
        context,
        "call-9",
      );
      assert.deepEqual(host.events.delegationRequests.map((request) => request.agent), ["bot.research"]);
      const request = host.events.delegationRequests[0];
      assert.equal(request.task, "Find primary sources");
      assert.equal(request.cwd, workspace.projectDir);
      assert.equal(request.ownerRunId, "parent-run-7");
      assert.equal(request.nodeId, "call-9:research");
      assert.equal(request.context, "fresh");
      assert.equal(request.timeoutMs, 900000);
      assert.deepEqual(request.result, { kind: "text" });
      assert.deepEqual(host.events.cancellationRequests, []);
      assert.deepEqual(JSON.parse(output), {
        bot: "research",
        runtimeName: "bot.research",
        status: "completed",
        result: "handled Find primary sources",
        model: "test/model",

        thinking: "low",
        usage: USAGE,
      });
      const second = JSON.parse(
        await runTool(host, { action: "run", bot: "bot.engineering", task: "Ship the module" }, context, "call-10"),
      );
      assert.equal(host.events.delegationRequests[1].agent, "bot.engineering");
      assert.equal(second.bot, "engineering");
      assert.equal(second.result, "handled Ship the module");
    });
  });
});
test("bots run rejects a multibyte task above the native one-mebibyte boundary", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const { host } = await installedHost(workspace);
      await assert.rejects(
        runTool(
          host,
          { action: "run", bot: "research", task: "界".repeat(400_000) },
          hostContext(workspace),
        ),
        /maximum UTF-8 size is 1048576 bytes/,
      );
      assert.deepEqual(host.events.delegationRequests, []);
    });
  });
});

test("failed delegation surfaces status and error to the caller", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const { host } = await installedHost(workspace);
      host.events.respond = (request) => host.events.fail(request, "model exploded");
      await assert.rejects(
        runTool(host, { action: "run", bot: "engineering", task: "BREAK" }, hostContext(workspace)),
        /Bot engineering ended with failed: model exploded/,
      );
      assert.equal(host.events.delegationRequests.length, 1);
      assert.deepEqual(host.events.cancellationRequests, []);
    });
  });
});

test("bots context serves shared domain records with filtering and domain validation", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const { host } = await installedHost(workspace);
      await seedDomainFiles(workspace);
      const context = hostContext(workspace);
      const all = await runTool(host, { action: "context" }, context);
      assert.match(all, /Domain: engineering \(owner: engineering, path: .*team-context.engineering\.md\)/);
      assert.match(all, /ENGINEERING_DOMAIN_SECRET/);
      assert.match(all, /Domain: research \(owner: research, path: .*team-context.research\.md\)/);
      assert.match(all, /RESEARCH_DOMAIN_SECRET/);
      assert.equal(all.includes("Private memory"), false);
      assert.equal(all.includes("RESEARCH_MEMORY_SECRET"), false);
      assert.equal(all.includes("ENGINEERING_MEMORY_SECRET"), false);
      const filtered = await runTool(host, { action: "context", domain: "engineering" }, context);
      assert.match(filtered, /ENGINEERING_DOMAIN_SECRET/);
      assert.equal(filtered.includes("RESEARCH_DOMAIN_SECRET"), false);
      const unrelatedSecret = path.join(workspace.root, "unrelated-secret.txt");
      const engineeringPath = path.join(workspace.projectDir, ".pi", "team-context", "engineering.md");
      await writeFile(unrelatedSecret, "UNRELATED_SECRET");
      await rm(engineeringPath);
      await symlink(unrelatedSecret, engineeringPath);
      const targeted = await runTool(host, { action: "context", domain: "research" }, context);
      assert.match(targeted, /RESEARCH_DOMAIN_SECRET/);
      assert.equal(targeted.includes("UNRELATED_SECRET"), false);
      await assert.rejects(
        runTool(host, { action: "context", domain: "not-a-domain" }, context),
        /Unknown enabled domain: not-a-domain/,
      );
    });
  });
});

test("parent identity cannot record domain state or private memory", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const { host } = await installedHost(workspace);
      const context = hostContext(workspace);
      await assert.rejects(
        runTool(
          host,
          { action: "record", domain: "engineering", kind: "observation", summary: "parent write" },
          context,
        ),
        /Only a configured bot child can write bot state\./,
      );
      await assert.rejects(
        runTool(host, { action: "remember", summary: "parent memory" }, context),
        /Only a configured bot child can write bot state\./,
      );
      assert.equal(await pathExists(path.join(workspace.projectDir, ".pi", "team-context", "engineering.md")), false);
      assert.equal(
        await pathExists(path.join(workspace.projectDir, ".pi", "agent-memory", "pi-bots", "research", "MEMORY.md")),
        false,
      );
    });
  });
});

test("/bots list, run, context, doctor, and reload behave end to end", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const { host, controller } = await installedHost(workspace);
      await seedDomainFiles(workspace);
      const context = hostContext(workspace);
      const listed = await runCommand(host, "", context);
      assert.equal(listed.length, 1);
      assert.match(listed[0], /- engineering — Engineering Bot \[available\]/);
      const ran = await runCommand(host, "run research  Check the archives  ", context);
      const parsedRun = JSON.parse(ran[0]);
      assert.equal(parsedRun.runtimeName, "bot.research");
      assert.equal(parsedRun.result, "handled Check the archives");
      const contextOut = await runCommand(host, "context research", context);
      assert.match(contextOut[0], /RESEARCH_DOMAIN_SECRET/);
      assert.equal(contextOut[0].includes("ENGINEERING_DOMAIN_SECRET"), false);
      const doctor = await runCommand(host, "doctor", context);
      assert.deepEqual(doctor[0].split("\n"), [
        "Pi Bots doctor",
        "Mode: parent",
        "Configuration: valid",
        `Sources: ${workspace.configPath}`,
        "Enabled bots: 2",
        `Native agent files: 2/2 in ${path.join(workspace.projectDir, ".pi", "agents", "pi-bots.generated")}`,
        "Domain owners: 2",
        "State reads: available",
        "Background lifecycle: native pi-subagents",
        "Schedules require the native pi-subagents schedule launcher",
      ]);
      const reloaded = await runCommand(host, "reload", context);
      assert.deepEqual(reloaded, ["Reloaded 2 enabled bots."]);
      assert.deepEqual(controller.availableNames(), ["bot.engineering", "bot.research"]);
      assert.match((await runCommand(host, "list", context))[0], /- research — Research Bot \[available\]/);
      await assert.rejects(runCommand(host, "bogus", context), /Usage: \/bots \[list\|run/);
    });
  });
});

test("session_shutdown disposes every runtime registration", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const { host, controller } = await installedHost(workspace);
      assert.equal(controller.availableNames().length, 2);
      await host.handlers.get("session_shutdown")!(undefined, hostContext(workspace));
      assert.deepEqual(controller.availableNames(), []);
    });
  });
});

test("session_start reports configuration failure and the prompt degrades instead of throwing", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const host = new FakeHost();
      const controller = installPiBots(host, { agentDir: workspace.agentDir });
      assert.ok(controller);
      const notifications: Array<{ message: string; level?: string }> = [];
      const context: HostContext = {
        cwd: workspace.projectDir,
        ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) },
      };
      await host.handlers.get("session_start")!(undefined, context);
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].level, "error");
      assert.match(notifications[0].message, /^Pi Bots failed to load: /);
      assert.match(notifications[0].message, /BOTS\.yml/);
      assert.match(controller.currentError() ?? "", /BOTS\.yml/);
      const result = (await host.handlers.get("before_agent_start")!({ systemPrompt: "BASE" }, context)) as {
        systemPrompt: string;
      };
      assert.match(result.systemPrompt, /^BASE/);
      assert.match(result.systemPrompt, /Pi Bots is unavailable: .+BOTS\.yml/);
      await assert.rejects(runTool(host, { action: "list" }, context));
    }, DUPLICATE_DOMAIN_YML);
  });
});

test("child controller injects live state, authorizes owned writes, and denies peer runs", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      await seedDomainFiles(workspace);
      const parent = new PiBotsController(new FakeBus(), { agentDir: workspace.agentDir });
      await parent.reload(workspace.projectDir);
      await withChildEnv("bot.research", async () => {
        const bus = new FakeBus();
        const controller = new PiBotsController(bus, { agentDir: workspace.agentDir });
        assert.deepEqual(controller.availableNames(), []);
        await controller.reload(workspace.projectDir);
        assert.deepEqual(controller.availableNames(), []);
        const context = { cwd: workspace.projectDir };
        const prompt = await controller.prompt(workspace.projectDir, "CHILD_BASE");
        assert.match(prompt, /^CHILD_BASE/);
        assert.match(prompt, /Live Pi Bots state/);
        assert.match(prompt, /Bot: research \(bot\.research\)/);
        assert.match(prompt, /Owned domains: research/);
        assert.match(prompt, /RESEARCH_MEMORY_SECRET/);
        assert.match(prompt, /ENGINEERING_DOMAIN_SECRET/);
        assert.equal(prompt.includes("ENGINEERING_MEMORY_SECRET"), false);
        const record = JSON.parse(
          await controller.execute(
            { action: "record", domain: "research", kind: "observation", summary: "CHILD_RECORD_SUMMARY" },
            context,
          ),
        );
        assert.equal(record.domain, "research");
        assert.equal(record.kind, "observation");
        assert.equal(typeof record.id, "string");
        assert.equal(Number.isNaN(Date.parse(record.recordedAt)), false);
        const verified = JSON.parse(
          await controller.execute(
            {
              action: "record",
              domain: "research",
              kind: "verified",
              summary: "VERIFIED_SUMMARY",
              evidence: "EVIDENCE_LINK",
            },
            context,
          ),
        );
        assert.equal(verified.kind, "verified");
        const contextOutput = await controller.execute({ action: "context", domain: "research" }, context);
        assert.match(contextOutput, /Domain: research \(owner: research, path: .*team-context.research\.md\)/);
        assert.match(contextOutput, /## .* observation/);
        assert.match(contextOutput, /CHILD_RECORD_SUMMARY/);
        assert.match(contextOutput, /Evidence: EVIDENCE_LINK/);
        assert.equal(contextOutput.includes("ENGINEERING_DOMAIN_SECRET"), false);
        await assert.rejects(
          controller.execute(
            { action: "record", domain: "engineering", kind: "observation", summary: "not mine" },
            context,
          ),
          /bot research may not record domain engineering owned by engineering/,
        );
        await assert.rejects(
          controller.execute({ action: "record", domain: "research", kind: "verified", summary: "no evidence" }, context),
          /requires evidence/,
        );
        await controller.execute({ action: "remember", summary: "CHILD_MEMORY_NOTE" }, context);
        const promptAfter = await controller.prompt(workspace.projectDir, "CHILD_BASE");
        assert.match(promptAfter, /CHILD_RECORD_SUMMARY/);
        assert.match(promptAfter, /CHILD_MEMORY_NOTE/);
        await assert.rejects(
          controller.execute({ action: "run", bot: "engineering", task: "peer work" }, context),
          /Bots delegate to peers with Pi's native subagent tool\./,
        );
        const doctorOutput = await controller.execute({ action: "doctor" }, context);
        assert.equal(doctorOutput.split("\n")[1], "Mode: bot child (bot.research)");
        assert.match(doctorOutput, /Native agent files: discovered from project mirror/);
        assert.match(doctorOutput, /Background lifecycle: native pi-subagents/);
      });
    });
  });
});

test("a long-lived child cannot reclaim a domain after roster ownership transfers", async () => {
  await withParentEnv(async () => {
    await withWorkspace(async (workspace) => {
      const parent = new PiBotsController(new FakeBus(), { agentDir: workspace.agentDir });
      await parent.reload(workspace.projectDir);
      let formerOwner: PiBotsController | undefined;
      await withChildEnv("bot.research", async () => {
        formerOwner = new PiBotsController(new FakeBus(), { agentDir: workspace.agentDir });
        await formerOwner.reload(workspace.projectDir);
      });
      await writeFile(workspace.configPath, `version: 1
bots:
  - name: beta
    title: Beta Bot
    description: Owns transferred research.
    domains: [research]
    memory: project
`);
      await parent.reload(workspace.projectDir);
      await withChildEnv("bot.beta", async () => {
        const currentOwner = new PiBotsController(new FakeBus(), { agentDir: workspace.agentDir });
        await currentOwner.reload(workspace.projectDir);
        await currentOwner.execute(
          { action: "record", domain: "research", kind: "observation", summary: "BETA_RECORD" },
          { cwd: workspace.projectDir },
        );
      });
      assert.ok(formerOwner);
      await assert.rejects(
        formerOwner.execute(
          { action: "record", domain: "research", kind: "observation", summary: "STALE_ALPHA_RECORD" },
          { cwd: workspace.projectDir },
        ),
        /no enabled bot for runtime name "bot\.research"/,
      );
      const state = await readFile(
        path.join(workspace.projectDir, ".pi", "team-context", "research.md"),
        "utf8",
      );
      assert.match(state, /owner: beta/);
      assert.match(state, /BETA_RECORD/);
      assert.equal(state.includes("STALE_ALPHA_RECORD"), false);
    });
  });
});
