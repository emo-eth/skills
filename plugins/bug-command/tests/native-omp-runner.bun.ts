import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, SessionManager } from "@oh-my-pi/pi-coding-agent";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type NativeCommand = {
  handler: (args: string, context: unknown) => unknown;
};

type NativeRunner = {
  initialize: (...parts: object[]) => void;
  emit: (event: unknown) => Promise<unknown>;
  getCommand: (name: string) => NativeCommand | undefined;
  createCommandContext: () => unknown;
};

test("OMP ExtensionRunner loads /bug and writes a contextual record", async () => {
  const root = mkdtempSync(join(tmpdir(), "bug-command-omp-runner-"));
  const destination = join(root, "BUGS.md");
  const previousPath = process.env.BUGS_PATH;
  process.env.BUGS_PATH = destination;
  const sessionManager = SessionManager.create(pluginRoot, join(root, "sessions"));
  const { session } = await createAgentSession({
    cwd: pluginRoot,
    agentDir: join(root, "agent"),
    additionalExtensionPaths: [join(pluginRoot, "src", "omp.ts")],
    disableExtensionDiscovery: true,
    enableLsp: false,
    enableMCP: false,
    contextFiles: [],
    sessionManager,
    skills: [],
    rules: [],
  });

  try {
    const runner = session.extensionRunner as unknown as NativeRunner;
    runner.initialize(
      {
        sendMessage: () => undefined,
        sendUserMessage: () => undefined,
        appendEntry: () => undefined,
        setLabel: () => undefined,
        getActiveTools: () => [],
        getAllTools: () => [],
        setActiveTools: () => undefined,
        setModel: async () => false,
        getThinkingLevel: () => "off",
        setThinkingLevel: () => undefined,
        getServiceTiers: () => ({}),
        setServiceTier: () => undefined,
        getSessionName: () => sessionManager.getSessionName(),
        setSessionName: async () => undefined,
      },
      {
        getModel: () => session.model,
        isIdle: () => true,
        abort: () => undefined,
        hasPendingMessages: () => false,
        shutdown: () => undefined,
        getContextUsage: () => undefined,
        compact: async () => undefined,
        getSystemPrompt: () => "",
      },
      {
        getContextUsage: () => undefined,
        waitForIdle: async () => undefined,
        newSession: async () => ({ cancelled: true }),
        branch: async () => ({ cancelled: true }),
        navigateTree: async () => ({ cancelled: true }),
        compact: async () => undefined,
        switchSession: async () => ({ cancelled: true }),
        reload: async () => undefined,
      },
    );
    await runner.emit({ type: "session_start" });
    for (const name of ["bug", "fear", "journal", "grasp", "do"]) {
      expect(runner.getCommand(name)).toBeDefined();
    }
    const command = runner.getCommand("bug");
    await command!.handler("native OMP bug", runner.createCommandContext());

    const line = readFileSync(destination, "utf8").trim();
    const record = JSON.parse(line.slice(2)) as Record<string, unknown>;
    expect(record.schema).toBe("bug.v1");
    expect(record.host).toBe("omp");
    expect(record.agent).toBe("OMP");
    expect(record.note).toBe("native OMP bug");
    expect(typeof record.datetime).toBe("string");
    expect(record.sessionId || record.sessionFile).toBeTruthy();
  } finally {
    await session.dispose();
    if (previousPath === undefined) delete process.env.BUGS_PATH;
    else process.env.BUGS_PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
