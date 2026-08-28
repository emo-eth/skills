import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAgentSession as createPiSession,
  DefaultResourceLoader,
  SessionManager as PiSessionManager,
} from "@earendil-works/pi-coding-agent";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function messageText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => typeof item?.text === "string" ? item.text : "").join("\n");
}

test("Pi native ExtensionRunner injects context and blocks a late tool call", { timeout: 30_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "wall-clock-pi-runner-"));
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
  const sessionManager = PiSessionManager.create(pluginRoot, join(root, "sessions"));
  const { session } = await createPiSession({
    cwd: pluginRoot,
    agentDir: join(root, "agent"),
    resourceLoader: loader,
    sessionManager,
  });
  try {
    const runner = session.extensionRunner;
    const submittedUserMessages: Array<{ content: unknown; options: unknown }> = [];
    let runningSignal: AbortController | undefined;
    runner.bindCore({
      sendMessage: () => undefined,
      sendUserMessage: (content: unknown, options: unknown) => { submittedUserMessages.push({ content, options }); },
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
    } as any, {
      getModel: () => session.model,
      getScopedModels: () => [],
      isIdle: () => true,
      isProjectTrusted: () => true,
      getSignal: () => runningSignal?.signal,
      abort: () => runningSignal?.abort(),
      hasPendingMessages: () => false,
      shutdown: () => undefined,
      getContextUsage: () => undefined,
      compact: () => undefined,
      getSystemPrompt: () => session.systemPrompt,
    });
    const command = runner.getCommand("wallclock");
    assert.ok(command);
    await command.handler("start 1ms block-new", runner.createCommandContext());
    const messages = await runner.emitContext([]);
    assert.match(messageText(messages.at(-1)), /<wallclock>/);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const blocked = await runner.emitToolCall({ type: "tool_call", toolCallId: "late", toolName: "read", input: { path: "README.md" } } as any);
    assert.equal(blocked?.block, true);
    assert.match(blocked?.reason ?? "", /deadline has expired/);

    await command.handler("stop", runner.createCommandContext());
    await command.handler("5m fix merge conflicts in all open PRs", runner.createCommandContext());
    assert.deepEqual(submittedUserMessages, [{ content: "fix merge conflicts in all open PRs", options: undefined }]);
    await command.handler("stop", runner.createCommandContext());
    await command.handler("turn-limit 1s block-new", runner.createCommandContext());
    const turnContext = await runner.emitContext([]);
    assert.match(messageText(turnContext.at(-1)), /mode turn-limit/);
    await runner.emit({ type: "agent_settled" } as any);
    const resetContext = await runner.emitContext([]);
    assert.deepEqual(resetContext, []);
    await command.handler("set 2s", runner.createCommandContext());
    await command.handler("stop", runner.createCommandContext());


    runningSignal = new AbortController();
    await command.handler("start 30ms abort-running", runner.createCommandContext());
    const bash = session.getToolDefinition("bash");
    assert.ok(bash);
    const gate = await runner.emitToolCall({
      type: "tool_call",
      toolCallId: "abort-call",
      toolName: "bash",
      input: { command: "sleep 0.3" },
    } as any);
    assert.equal(gate, undefined);
    const startedAt = Date.now();
    let executionError: unknown;
    try {
      await bash.execute("abort-call", { command: "sleep 0.3" }, runningSignal.signal, undefined, runner.createContext());
    } catch (error) {
      executionError = error;
    }
    assert.match(executionError instanceof Error ? executionError.message : "", /abort|cancel/i);
    await runner.emitToolResult({
      type: "tool_result",
      toolCallId: "abort-call",
      toolName: "bash",
      input: { command: "sleep 0.3" },
      content: [{ type: "text", text: executionError instanceof Error ? executionError.message : "Unknown execution error" }],
      details: undefined,
      isError: true,
    } as any);
    assert.equal(runningSignal.signal.aborted, true);
    assert.ok(Date.now() - startedAt < 250);
  } finally {
    session.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
