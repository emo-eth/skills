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

test("OMP ExtensionRunner loads only the X search and fetch tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "grok-search-omp-runner-"));
  const sessionManager = SessionManager.create(pluginRoot, join(root, "sessions"));
  const fakePython = join(root, "fake-python");
  const expected = {
    model: "grok-test",
    answer: "native tool result",
    citations: [],
    degraded: false,
  };
  writeFileSync(fakePython, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(expected))});\n`);
  chmodSync(fakePython, 0o755);
  const previousPython = process.env.GROK_SEARCH_PYTHON;
  process.env.GROK_SEARCH_PYTHON = fakePython;

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

    const search = session.getToolByName("grok_search");
    const fetch = session.getToolByName("grok_fetch");
    expect(search).toBeDefined();
    expect(fetch).toBeDefined();
    expect(session.getToolByName("grok_prompt")).toBeUndefined();

    const result = await search?.execute(
      "native-call",
      { query: "Recent posts" },
      new AbortController().signal,
    ) as unknown as ToolResult;
    expect(resultValue(result)).toEqual(expected);
  } finally {
    await session.dispose();
    if (previousPython === undefined) delete process.env.GROK_SEARCH_PYTHON;
    else process.env.GROK_SEARCH_PYTHON = previousPython;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
