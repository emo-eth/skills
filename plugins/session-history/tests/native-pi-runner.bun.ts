import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type ToolResult = {
  content: Array<{ type: string; text: string }>;
};

function resultValue(result: ToolResult): unknown {
  return JSON.parse(result.content[0]?.text ?? "null");
}

test("Pi ExtensionRunner loads session history tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "session-history-pi-runner-"));
  const loader = new DefaultResourceLoader({
    cwd: pluginRoot,
    agentDir: join(root, "agent"),
    additionalExtensionPaths: [join(pluginRoot, "src", "pi.ts")],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const sessionManager = SessionManager.create(pluginRoot, join(root, "sessions"));
  const fakePython = join(root, "fake-python");
  const expected = {
    answer: "native Pi tool result",
    citations: [],
    degraded: false,
    warnings: [],
    conflicts: [],
    elapsed_ms: 1,
  };
  writeFileSync(fakePython, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(expected))});\n`);
  chmodSync(fakePython, 0o755);
  const previousPython = process.env.SESSION_HISTORY_PYTHON;
  process.env.SESSION_HISTORY_PYTHON = fakePython;

  const { session } = await createAgentSession({
    cwd: pluginRoot,
    agentDir: join(root, "agent"),
    resourceLoader: loader,
    sessionManager,
  });

  try {
    const runner = session.extensionRunner;
    runner.bindCore({
      sendMessage: () => undefined,
      sendUserMessage: () => undefined,
      appendEntry: (customType: string, data?: unknown) => { sessionManager.appendCustomEntry(customType, data); },
      setSessionName: async () => undefined,
      getSessionName: () => sessionManager.getSessionName(),
      setLabel: () => undefined,
      getActiveTools: () => session.getActiveToolNames(),
      getAllTools: () => session.getAllTools(),
      setActiveTools: (names: string[]) => session.setActiveToolsByName(names),
      refreshTools: async () => undefined,
      getCommands: () => [],
      setModel: async () => false,
      getThinkingLevel: () => session.thinkingLevel,
      setThinkingLevel: () => undefined,
    }, {
      getModel: () => session.model,
      getScopedModels: () => [],
      isIdle: () => true,
      isProjectTrusted: () => true,
      getSignal: () => undefined,
      abort: () => undefined,
      hasPendingMessages: () => false,
      shutdown: () => undefined,
      getContextUsage: () => undefined,
      compact: () => undefined,
      getSystemPrompt: () => session.systemPrompt,
    });

    const recall = session.getToolDefinition("session_recall");
    const status = session.getToolDefinition("session_status");
    expect(recall).toBeDefined();
    expect(status).toBeDefined();
    expect(session.getToolDefinition("session_history_search")).toBeUndefined();

    if (!recall) throw new Error("Pi did not register session_recall");
    const result = await recall.execute(
      "native-call",
      { query: "native test" },
      new AbortController().signal,
      undefined,
      runner.createContext(),
    ) as unknown as ToolResult;
    expect(resultValue(result)).toEqual(expected);
  } finally {
    await session.dispose();
    if (previousPython === undefined) delete process.env.SESSION_HISTORY_PYTHON;
    else process.env.SESSION_HISTORY_PYTHON = previousPython;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
