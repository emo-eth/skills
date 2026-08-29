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

test("Pi ExtensionRunner loads and executes the three Grok tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "grok-search-pi-runner-"));
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
    model: "grok-test",
    answer: "native Pi tool result",
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


    const search = session.getToolDefinition("grok_search");
    const fetch = session.getToolDefinition("grok_fetch");
    const prompt = session.getToolDefinition("grok_prompt");
    expect(search).toBeDefined();
    expect(fetch).toBeDefined();
    expect(prompt).toBeDefined();

    if (!prompt) throw new Error("Pi did not register grok_prompt");
    const result = await prompt.execute(
      "native-call",
      { prompt: "Reply exactly OK" },
      new AbortController().signal,
      undefined,
      runner.createContext(),
    ) as unknown as ToolResult;
    expect(resultValue(result)).toEqual(expected);
  } finally {
    await session.dispose();
    if (previousPython === undefined) delete process.env.GROK_SEARCH_PYTHON;
    else process.env.GROK_SEARCH_PYTHON = previousPython;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
