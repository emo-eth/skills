import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, SessionManager } from "@oh-my-pi/pi-coding-agent";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function messageText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => typeof item?.text === "string" ? item.text : "").join("\n");
}

function resultValue(result: any): any {
  return JSON.parse(result?.content?.[0]?.text ?? "null");
}

function initializeRunner(session: any, sessionManager: any, abort: () => void = () => undefined) {
  const runner = session.extensionRunner;
  expect(runner).toBeDefined();
  runner.initialize({
    sendMessage: () => undefined,
    sendUserMessage: () => undefined,
    appendEntry: (customType: string, data?: unknown) => { sessionManager.appendCustomEntry(customType, data); },
    setLabel: () => undefined,
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => undefined,
    getCommands: () => [],
    setModel: async () => false,
    getThinkingLevel: () => "off",
    setThinkingLevel: () => undefined,
    getServiceTiers: () => ({}),
    setServiceTier: () => undefined,
    getSessionName: () => sessionManager.getSessionName(),
    setSessionName: async () => undefined,
  } as any, {
    getModel: () => session.model,
    isIdle: () => true,
    abort,
    hasPendingMessages: () => false,
    shutdown: () => undefined,
    getContextUsage: () => undefined,
    compact: async () => undefined,
    getSystemPrompt: () => session.systemPrompt,
  }, {
    getContextUsage: () => undefined,
    waitForIdle: async () => undefined,
    newSession: async () => ({ cancelled: true }),
    branch: async () => ({ cancelled: true }),
    navigateTree: async () => ({ cancelled: true }),
    compact: async () => undefined,
    switchSession: async () => ({ cancelled: true }),
    reload: async () => undefined,
  });
  return runner;
}

test("OMP native ExtensionRunner injects context and blocks a late tool call", async () => {
  const root = mkdtempSync(join(tmpdir(), "wall-clock-omp-runner-"));
  const sessionManager = SessionManager.create(pluginRoot, join(root, "sessions"));
  let runningSignal: AbortController | undefined;
  const { session } = await createAgentSession({
    cwd: pluginRoot,
    agentDir: join(root, "agent"),
    additionalExtensionPaths: [join(pluginRoot, "src", "omp.ts")],
    disableExtensionDiscovery: true,
    sessionManager,
    skills: [],
    rules: [],
    contextFiles: [],
  });
  try {
    const runner = initializeRunner(session, sessionManager, () => runningSignal?.abort());
    await runner.emit({ type: "session_start" });
    const command = runner.getCommand("wallclock");
    expect(command).toBeDefined();
    await command!.handler("start 1ms block-new", runner.createCommandContext());
    const messages = await runner.emitContext([]);
    expect(messageText(messages.at(-1))).toMatch(/Latest inference elapsed: 0s \(0ms\)/);
    await Bun.sleep(5);
    const blocked = await runner.emitToolCall({ type: "tool_call", toolCallId: "late", toolName: "read", input: { path: "README.md" } } as any);
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason ?? "").toMatch(/deadline has expired/);

    await command!.handler("stop", runner.createCommandContext());
    await command!.handler("start 30ms abort-running", runner.createCommandContext());
    const bash = session.getToolByName("bash");
    expect(bash).toBeDefined();
    const signal = new AbortController();
    runningSignal = signal;
    const startedAt = Date.now();
    await expect(bash!.execute("abort-call", { command: "sleep 0.3" }, signal.signal)).rejects.toThrow(/abort|cancel/i);
    expect(signal.signal.aborted).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(250);
  } finally {
    await session.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test("OMP native shared event bus scopes a real child runner", async () => {
  const root = mkdtempSync(join(tmpdir(), "wall-clock-omp-child-"));
  const parentManager = SessionManager.create(pluginRoot, join(root, "parent-sessions"));
  const childManager = SessionManager.create(pluginRoot, join(root, "child-sessions"));
  const common = {
    cwd: pluginRoot,
    agentDir: join(root, "agent"),
    additionalExtensionPaths: [join(pluginRoot, "src", "omp.ts")],
    disableExtensionDiscovery: true,
    skills: [],
    rules: [],
    contextFiles: [],
  };
  const parentResult = await createAgentSession({ ...common, sessionManager: parentManager });
  const childResult = await createAgentSession({ ...common, sessionManager: childManager, eventBus: parentResult.eventBus });
  try {
    const parentRunner = initializeRunner(parentResult.session, parentManager);
    const childRunner = initializeRunner(childResult.session, childManager);
    await parentRunner.emit({ type: "session_start" });
    await childRunner.emit({ type: "session_start" });
    await parentRunner.getCommand("wallclock")!.handler("start 60s block-new", parentRunner.createCommandContext());

    const assign = parentRunner.getRegisteredTool("wallclock_assign");
    expect(assign).toBeDefined();
    await assign!.definition.execute("assign-call", {
      parentPlanItemId: "one",
      objective: "One child slice",
      scope: ["src"],
      acceptance: ["Return evidence"],
      budgetMs: 50,
    }, undefined, undefined, parentRunner.createContext());
    const task = await parentRunner.emitToolCall({
      type: "tool_call",
      toolCallId: "task-call",
      toolName: "task",
      input: { task: "Inspect one file" },
    } as any);
    expect(task).toBeUndefined();

    const childSessionFile = childManager.getSessionFile();
    expect(childSessionFile).toBeTruthy();
    parentResult.eventBus.emit("task:subagent:lifecycle", {
      id: "native-child",
      agent: "pi",
      agentSource: "bundled",
      status: "started",
      sessionFile: childSessionFile,
      parentToolCallId: "task-call",
      index: 0,
    });
    const statusTool = parentRunner.getRegisteredTool("wallclock_status");
    const parentStatus = resultValue(await statusTool!.definition.execute(
      "status-call",
      { assignmentId: "assignment-1" },
      undefined,
      undefined,
      parentRunner.createContext(),
    ));
    expect(parentStatus.assignment?.childSessionId).toBe(childSessionFile);
    const childStatusTool = childRunner.getRegisteredTool("wallclock_status");
    const childStatus = resultValue(await childStatusTool!.definition.execute(
      "child-status-call",
      {},
      undefined,
      undefined,
      childRunner.createContext(),
    ));
    expect(childStatus.assignment?.id).toBe("assignment-1");
    const messages = await childRunner.emitContext([]);
    expect(messageText(messages.at(-1))).toMatch(/Assignment assignment-1/);
    await Bun.sleep(60);
    const blocked = await childRunner.emitToolCall({
      type: "tool_call",
      toolCallId: "child-read",
      toolName: "read",
      input: { path: "README.md" },
    } as any);
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason ?? "").toMatch(/deadline has expired/);
  } finally {
    await childResult.session.dispose();
    await parentResult.session.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
