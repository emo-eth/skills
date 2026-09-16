import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, SessionManager } from "@oh-my-pi/pi-coding-agent";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type NativeRunner = {
  initialize: (...parts: object[]) => void;
  emit: (event: unknown) => Promise<unknown>;
};

type ToolResult = {
  content: Array<{ type: string; text: string }>;
};

function resultValue(result: ToolResult): unknown {
  return JSON.parse(result.content[0]?.text ?? "null");
}

test("OMP ExtensionRunner loads session history tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "session-history-omp-runner-"));
  const sessionManager = SessionManager.create(pluginRoot, join(root, "sessions"));
  const fakePython = join(root, "fake-python");
  const recallResult = {
    answer: "native tool result",
    citations: [],
    degraded: false,
    warnings: [],
    conflicts: [],
    elapsed_ms: 1,
  };
  const statusResult = {
    healthy: true,
    cass_available: true,
    hybrid_ready: true,
    sources: [],
    warnings: [],
    exclusions: { sessions: [], sources: [] },
    purged: { sessions: [], sources: [] },
  };
  writeFileSync(
    fakePython,
    `#!/usr/bin/env node\nconst recall = ${JSON.stringify(recallResult)};\nconst status = ${JSON.stringify(statusResult)};\nprocess.stdout.write(JSON.stringify(process.argv.includes("status") ? status : recall));\n`,
  );
  chmodSync(fakePython, 0o755);
  const previousPython = process.env.SESSION_HISTORY_PYTHON;
  process.env.SESSION_HISTORY_PYTHON = fakePython;

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
        navigateTree: async () => ({ cancelled: true }),
        compact: async () => undefined,
        switchSession: async () => ({ cancelled: true }),
        reload: async () => undefined,
      },
    );
    await runner.emit({ type: "session_start" });
    const recall = session.getToolByName("session_recall");
    const status = session.getToolByName("session_status");
    expect(recall).toBeDefined();
    expect(status).toBeDefined();
    expect(session.getToolByName("session_history_search")).toBeUndefined();

    const result = await recall?.execute(
      "native-call",
      { query: "native test" },
      new AbortController().signal,
    ) as unknown as ToolResult;
    expect(resultValue(result)).toEqual(recallResult);

    const statusToolResult = await status?.execute(
      "native-health",
      {},
      new AbortController().signal,
    ) as unknown as ToolResult;
    expect(resultValue(statusToolResult)).toEqual(statusResult);
  } finally {
    await session.dispose();
    if (previousPython === undefined) delete process.env.SESSION_HISTORY_PYTHON;
    else process.env.SESSION_HISTORY_PYTHON = previousPython;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
