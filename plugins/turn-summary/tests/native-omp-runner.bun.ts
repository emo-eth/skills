import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { TURN_SUMMARY_REMINDER } from "../src/summary.ts";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type NativeCommand = {
  handler: (args: string, context: unknown) => unknown;
};

type NativeRunner = {
  initialize: (...parts: object[]) => void;
  emit: (event: unknown) => Promise<unknown>;
  emitContext: (messages: unknown[]) => Promise<unknown>;
  getCommand: (name: string) => NativeCommand | undefined;
  createCommandContext: () => unknown;
};

function messageText(value: unknown): string {
  if (!Array.isArray(value)) throw new Error("OMP context result is not a message list");
  const message = value.at(-1);
  if (typeof message !== "object" || message === null || !("content" in message)) {
    throw new Error("OMP context result has no final message");
  }
  const content = message.content;
  if (!Array.isArray(content)) throw new Error("OMP context message has no content");
  const text = content
    .filter((item): item is { text: string } => (
      typeof item === "object" && item !== null && "text" in item && typeof item.text === "string"
    ))
    .map((item) => item.text)
    .join("\n");
  return text;
}

function initializeRunner(session: { extensionRunner: unknown; model: unknown }, sessionManager: SessionManager): NativeRunner {
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
  return runner;
}

test("OMP ExtensionRunner loads the adapter and injects the reminder through context", async () => {
  const root = mkdtempSync(join(tmpdir(), "turn-summary-omp-runner-"));
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
    const command = runner.getCommand("summary");
    expect(command).toBeDefined();
    expect(messageText(await runner.emitContext([]))).toBe(TURN_SUMMARY_REMINDER);
    expect(messageText(await runner.emitContext([]))).toBe(TURN_SUMMARY_REMINDER);
  } finally {
    await session.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
