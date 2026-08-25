import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { NO_CODE_COMMENTS_PROMPT } from "../src/host.ts";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type NativeRunner = {
  initialize: (...parts: object[]) => void;
  emitToolCall: (event: unknown) => Promise<any>;
  emit: (event: unknown) => Promise<unknown>;
  emitBeforeAgentStart: (prompt: string, images: unknown[] | undefined, systemPrompt: string[]) => Promise<any>;
  getCommand: (name: string) => unknown;
};

function initializeRunner(session: { extensionRunner: unknown; model: unknown }, sessionManager: SessionManager): NativeRunner {
  const runner = session.extensionRunner as NativeRunner;
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
  return runner;
}

test("OMP ExtensionRunner loads and rewrites a write payload", async () => {
  const root = mkdtempSync(join(tmpdir(), "no-code-comments-omp-runner-"));
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
    const runner = initializeRunner(session, sessionManager);
    await runner.emit({ type: "session_start" });
    expect(runner.getCommand("no-code-comments")).toBeDefined();
    const result = await runner.emitToolCall({
      type: "tool_call",
      toolCallId: "write-1",
      toolName: "write",
      input: { path: "sample.ts", content: "const a = 1; // remove\n" },
    });
    expect(result?.input).toEqual({ path: "sample.ts", content: "const a = 1;\n" });
    const prompt = await runner.emitBeforeAgentStart("", [], []);
    expect(prompt?.systemPrompt).toContain(NO_CODE_COMMENTS_PROMPT);
  } finally {
    await session.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
