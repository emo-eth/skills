import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, SessionManager } from "@oh-my-pi/pi-coding-agent";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type NativeCommand = {
  description: string;
  handler: (args: string, context: unknown) => unknown;
};

type NativeRunner = {
  initialize: (...parts: object[]) => void;
  emit: (event: unknown) => Promise<unknown>;
  getCommand: (name: string) => NativeCommand | undefined;
  createCommandContext: () => unknown;
};

test("OMP ExtensionRunner loads /linear and executes out-of-band", async () => {
  const root = mkdtempSync(join(tmpdir(), "linear-command-omp-runner-"));
  const mockBin = join(root, "mock-linear");
  const logFile = join(root, "mock-linear.log");

  const scriptContent = `#!/bin/sh
echo "$@" >> "${logFile}"
echo "Created issue EMO-777: Native OMP test"
echo "https://linear.app/emo-eth/issue/EMO-777/native-omp-test"
`;
  writeFileSync(mockBin, scriptContent, "utf8");
  chmodSync(mockBin, 0o755);

  const previousBin = process.env.LINEAR_BIN_PATH;
  process.env.LINEAR_BIN_PATH = mockBin;

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

    const command = runner.getCommand("linear");
    expect(command).toBeDefined();
    expect(command!.description).toContain("Linear");

    const initialEntryCount = sessionManager.getEntries().length;

    await command!.handler(
      "--project Saddle Fix crash on boot",
      runner.createCommandContext(),
    );

    const logContent = readFileSync(logFile, "utf8");
    expect(logContent).toContain("issue create");
    expect(logContent).toContain("Saddle");
    expect(logContent).toContain("Fix crash on boot");
    expect(logContent).toContain("--no-interactive");

    const finalEntryCount = sessionManager.getEntries().length;
    expect(finalEntryCount).toBe(initialEntryCount);
  } finally {
    await session.dispose();
    if (previousBin === undefined) delete process.env.LINEAR_BIN_PATH;
    else process.env.LINEAR_BIN_PATH = previousBin;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
