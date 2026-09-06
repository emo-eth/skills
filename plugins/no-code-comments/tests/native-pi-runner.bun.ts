import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { NO_CODE_COMMENTS_PROMPT } from "../src/host.ts";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type ToolCallEvent = { type: string; toolCallId: string; toolName: string; input: Record<string, unknown> };
type ToolDefinition = {
  execute: (id: string, args: Record<string, unknown>, signal: AbortSignal, onProgress: unknown, context: unknown) => Promise<unknown>;
};

test("Pi ExtensionRunner keeps advisory policy prompt and leaves commented tool inputs byte-identical", async () => {
  const root = mkdtempSync(join(tmpdir(), "no-code-comments-pi-runner-"));
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: join(root, "agent"),
    additionalExtensionPaths: [join(pluginRoot, "src", "pi.ts")],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const sessionManager = SessionManager.create(root, join(root, "sessions"));
  const { session } = await createAgentSession({
    cwd: root,
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
      getSystemPrompt: () => "BASE_SENTINEL",
    });

    expect(runner.getCommand("no-code-comments")).toBeDefined();
    const prompt = await runner.emitBeforeAgentStart("probe", undefined, "BASE_SENTINEL", {});
    const systemPrompt = prompt?.systemPrompt;
    expect(typeof systemPrompt).toBe("string");
    expect(systemPrompt).toContain("BASE_SENTINEL");
    expect(systemPrompt).toContain(NO_CODE_COMMENTS_PROMPT);
    expect(systemPrompt).toContain("advisory");

    const commentedWrite = "const a = 1; // prose\nconst b = 2; /* kept */\n";
    const write = session.getToolDefinition("write") as unknown as ToolDefinition | undefined;
    expect(write).toBeDefined();
    const writeEvent: ToolCallEvent = {
      type: "tool_call",
      toolCallId: "write-1",
      toolName: "write",
      input: { path: "sample.ts", content: commentedWrite },
    };
    const gate = await runner.emitToolCall(writeEvent);
    expect(gate).toBeUndefined();
    expect(writeEvent.input).toEqual({ path: "sample.ts", content: commentedWrite });
    await write!.execute("write-1", writeEvent.input, new AbortController().signal, undefined, runner.createContext());
    expect(readFileSync(join(root, "sample.ts"), "utf8")).toBe(commentedWrite);

    const edit = session.getToolDefinition("edit") as unknown as ToolDefinition | undefined;
    expect(edit).toBeDefined();
    const editArgs = {
      path: "sample.ts",
      edits: [{ oldText: "const a = 1; // prose\n", newText: "const a = 2; // prose\n" }],
    };
    const editGate = await runner.emitToolCall({
      type: "tool_call",
      toolCallId: "edit-1",
      toolName: "edit",
      input: editArgs,
    });
    expect(editGate).toBeUndefined();
    expect(editArgs).toEqual({
      path: "sample.ts",
      edits: [{ oldText: "const a = 1; // prose\n", newText: "const a = 2; // prose\n" }],
    });
    await edit!.execute("edit-1", editArgs, new AbortController().signal, undefined, runner.createContext());
    expect(readFileSync(join(root, "sample.ts"), "utf8")).toBe("const a = 2; // prose\nconst b = 2; /* kept */\n");
  } finally {
    await session.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
