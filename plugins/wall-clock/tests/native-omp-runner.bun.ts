import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthStorage, createMockModel } from "@oh-my-pi/pi-ai";
import { createAgentSession, ModelRegistry, SessionManager, Settings } from "@oh-my-pi/pi-coding-agent";

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

function reportInput(assignmentId: string, status: "complete" | "partial" | "blocked" | "expired") {
  return {
    assignmentId,
    status,
    completed: status === "complete" ? ["Completed the delegated check"] : [],
    evidence: ["OMP native task child executed the wall-clock tools"],
    partial: status === "complete" ? [] : ["The late read was blocked"],
    skipped: [],
    validation: ["Native task result returned through yield"],
    shortcuts: [],
    risks: [],
    unknowns: [],
    recommendedParentAction: "Use the child evidence",
  };
}

async function createMockTaskSession(root: string, responses: any[]) {
  const provider = `wall-clock-mock-${root.split("-").at(-1)}`;
  const modelId = "task-model";
  const authStorage = await AuthStorage.create(join(root, "agent.db"));
  const modelRegistry = new ModelRegistry(authStorage, join(root, "models.yml"));
  const mock = createMockModel({ id: modelId, provider, responses });
  modelRegistry.registerProvider(provider, {
    baseUrl: "mock://wall-clock",
    apiKey: "wall-clock-test-key",
    api: "mock",
    streamSimple: (_model, context, options) => mock.stream(mock, context, options),
    models: [{
      id: modelId,
      name: "Wall-clock task model",
      api: "mock",
      reasoning: false,
      input: ["text"],
      supportsTools: true,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32_000,
      maxTokens: 4_096,
    }],
  });
  const model = modelRegistry.find(provider, modelId);
  expect(model).toBeDefined();
  const settings = Settings.isolated({
    "async.enabled": false,
    "includeWorkspaceTree": false,
    "task.agentModelOverrides": { task: `${provider}/${modelId}` },
    "task.enableLsp": false,
    "task.isolation.mode": "none",
    "task.maxRuntimeMs": 10_000,
    "task.prewalk": false,
  });
  const sessionManager = SessionManager.create(pluginRoot, join(root, "sessions"));
  const created = await createAgentSession({
    cwd: pluginRoot,
    agentDir: join(root, "agent"),
    additionalExtensionPaths: [join(pluginRoot, "src", "omp.ts")],
    disableExtensionDiscovery: true,
    enableLsp: false,
    enableMCP: false,
    contextFiles: [],
    model: model!,
    modelRegistry,
    rules: [],
    sessionManager,
    settings,
    skills: [],
  });
  return { ...created, authStorage, mock, sessionManager };
}

function initializeRunner(
  session: any,
  sessionManager: any,
  abort: () => void = () => undefined,
  sendUserMessage: (content: unknown, options: unknown) => void = () => undefined,
) {
  const runner = session.extensionRunner;
  expect(runner).toBeDefined();
  runner.initialize({
    sendMessage: () => undefined,
    sendUserMessage,
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
    const submittedUserMessages: Array<{ content: unknown; options: unknown }> = [];
    const runner = initializeRunner(
      session,
      sessionManager,
      () => runningSignal?.abort(),
      (content, options) => { submittedUserMessages.push({ content, options }); },
    );
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
    await command!.handler("5m fix merge conflicts in all open PRs", runner.createCommandContext());
    expect(submittedUserMessages).toEqual([{ content: "fix merge conflicts in all open PRs", options: undefined }]);

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

test("OMP native wallclock command starts the trailing prompt after activation", async () => {
  const root = mkdtempSync(join(tmpdir(), "wall-clock-omp-prompt-"));
  const created = await createMockTaskSession(root, [
    { content: [{ type: "text", text: "prompt received" }] },
  ]);
  let promptTask: Promise<void> | undefined;
  try {
    const runner = initializeRunner(
      created.session,
      created.sessionManager,
      () => undefined,
      (content, options) => {
        promptTask = created.session.sendUserMessage(content, options);
      },
    );
    await runner.emit({ type: "session_start" });

    await runner.getCommand("wallclock")!.handler(
      "5m fix merge conflicts in all open PRs",
      runner.createCommandContext(),
    );
    expect(promptTask).toBeDefined();
    await promptTask;

    expect(created.mock.calls).toHaveLength(1);
    expect(JSON.stringify(created.mock.calls[0]?.context)).toContain("fix merge conflicts in all open PRs");
    expect(JSON.stringify(created.mock.calls[0]?.context)).toContain("Expiry policy: block-new");
  } finally {
    await created.session.dispose();
    created.authStorage.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test("OMP native fast lane requires bounded delegation from an explicit do-it-now skill", async () => {
  const root = mkdtempSync(join(tmpdir(), "wall-clock-omp-fast-lane-"));
  const sessionManager = SessionManager.create(pluginRoot, join(root, "sessions"));
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
    const runner = initializeRunner(session, sessionManager);
    await runner.emit({ type: "session_start" });
    await runner.emit({
      type: "before_agent_start",
      prompt: [
        '[IMPORTANT: User invoked the "do-it-now" skill; follow its instructions. Full skill below.]',
        "# Do It Now",
        "---",
        "[Skill directory: /skills/do-it-now]",
        "User: refresh the ticket list",
      ].join("\n"),
      systemPrompt: session.systemPrompt,
    });
    const messages = await runner.emitContext([]);
    expect(messageText(messages.at(-1))).toMatch(/refresh the ticket list/);
    const blocked = await runner.emitToolCall({
      type: "tool_call",
      toolCallId: "fast-lane-task",
      toolName: "task",
      input: { task: "Refresh the ticket list" },
    } as any);
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason ?? "").toMatch(/active, unbound/);
    const batchInput = {
      tasks: [{
        task: "Refresh the ticket list",
        wallClock: {
          parentPlanItemId: "refresh",
          objective: "Refresh the ticket list",
          scope: ["tickets"],
          acceptance: ["Return the refreshed list"],
          budgetMs: 30_000,
        },
      }],
    };
    const admitted = await runner.emitToolCall({
      type: "tool_call",
      toolCallId: "fast-lane-batch",
      toolName: "task",
      input: batchInput,
    } as any);
    expect(admitted).toBeUndefined();
    expect(batchInput.tasks[0]?.task ?? "").toMatch(/Assignment assignment-1/);
    expect(batchInput.tasks[0]?.wallClock).toBeUndefined();
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

test("OMP native TaskTool creates a child that blocks late work, reports, and yields", async () => {
  const root = mkdtempSync(join(tmpdir(), "wall-clock-omp-task-block-"));
  const assignmentId = "block-assignment";
  let created: Awaited<ReturnType<typeof createMockTaskSession>>;
  created = await createMockTaskSession(root, [
    async () => {
      await Bun.sleep(120);
      return { content: [{ type: "toolCall", name: "wallclock_status", arguments: {} }] };
    },
    { content: [{ type: "toolCall", name: "read", arguments: { path: "README.md" } }] },
    { content: [{ type: "toolCall", name: "yield", arguments: { result: { data: { outcome: "premature" } } } }] },
    { content: [{ type: "toolCall", name: "wallclock_report", arguments: reportInput(assignmentId, "expired") }] },
    { content: [{ type: "toolCall", name: "yield", arguments: { result: { data: { outcome: "late work blocked and reported" } } } }] },
  ]);
  const lifecycle: any[] = [];
  created.eventBus.on("task:subagent:lifecycle", (event: any) => { lifecycle.push(event); });
  try {
    const runner = initializeRunner(created.session, created.sessionManager);
    await runner.emit({ type: "session_start" });
    await runner.getCommand("wallclock")!.handler("start 5s block-new", runner.createCommandContext());
    const assign = runner.getRegisteredTool("wallclock_assign")!;
    await assign.definition.execute("assign-call", {
      id: assignmentId,
      parentPlanItemId: "block-new",
      objective: "Prove a native OMP task child blocks late work",
      scope: ["README.md"],
      acceptance: ["The late read is blocked and the child reports before yield"],
      budgetMs: 40,
    }, undefined, undefined, runner.createContext());

    const task = created.session.getToolByName("task");
    expect(task).toBeDefined();
    const result = await task!.execute("task-call", { agent: "task", task: "Read README.md after the assigned delay" });
    const child = result.details?.results?.[0] as any;
    expect(child?.exitCode).toBe(0);
    expect(child?.aborted).not.toBe(true);
    expect(child?.extractedToolData?.yield?.at(-1)?.data).toEqual({ outcome: "late work blocked and reported" });
    expect(lifecycle.map((event) => event.status)).toEqual(["started", "completed"]);
    expect(JSON.stringify(created.mock.calls[0]?.context)).toMatch(/Assignment block-assignment/);
    const delayedStatusResult = created.mock.calls[1]?.context.messages.find((message: any) =>
      message.role === "toolResult" && message.toolName === "wallclock_status");
    const delayedStatus = resultValue(delayedStatusResult);
    expect(lifecycle[0]?.sessionFile).toStartWith(delayedStatus?.sessionId?.slice(0, -6));
    expect(delayedStatus?.phase).toBe("expired");
    const lateReadResult = created.mock.calls[2]?.context.messages.find((message: any) =>
      message.role === "toolResult" && message.toolName === "read");
    expect(messageText(lateReadResult)).toMatch(/wall-clock deadline has expired/i);
    const prematureYieldResult = created.mock.calls[3]?.context.messages.find((message: any) =>
      message.role === "toolResult" && message.toolName === "yield");
    expect(messageText(prematureYieldResult)).toMatch(/wallclock_report/);

    const state = created.sessionManager.getEntries().filter((entry: any) =>
      entry.type === "custom" && entry.customType === "wall-clock-state").at(-1) as any;
    expect(state?.data?.reports?.[0]?.assignmentId).toBe(assignmentId);
    expect(state?.data?.reports?.[0]?.status).toBe("expired");
  } finally {
    await created.session.dispose();
    created.authStorage.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test("OMP native TaskTool aborts a running child bash action at assignment expiry", async () => {
  const root = mkdtempSync(join(tmpdir(), "wall-clock-omp-task-abort-"));
  const assignmentId = "abort-assignment";
  const created = await createMockTaskSession(root, [
    { content: [{ type: "toolCall", name: "wallclock_status", arguments: {} }] },
    { content: [{ type: "toolCall", name: "bash", arguments: { command: "sleep 5" } }] },
  ]);
  const lifecycle: any[] = [];
  const childEvents: any[] = [];
  created.eventBus.on("task:subagent:lifecycle", (event: any) => { lifecycle.push(event); });
  created.eventBus.on("task:subagent:event", (payload: any) => { childEvents.push(payload.event); });
  const taskSignal = new AbortController();
  try {
    const runner = initializeRunner(created.session, created.sessionManager, () => taskSignal.abort());
    await runner.emit({ type: "session_start" });
    await runner.getCommand("wallclock")!.handler("start 5s abort-running", runner.createCommandContext());
    const assign = runner.getRegisteredTool("wallclock_assign")!;
    await assign.definition.execute("assign-call", {
      id: assignmentId,
      parentPlanItemId: "abort-running",
      objective: "Prove a native OMP task child is aborted",
      scope: ["bash"],
      acceptance: ["A running child bash action is cancelled at expiry"],
      budgetMs: 500,
    }, undefined, undefined, runner.createContext());

    const task = created.session.getToolByName("task");
    expect(task).toBeDefined();
    const startedAt = Date.now();
    const result = await task!.execute(
      "task-call",
      { agent: "task", task: "Run sleep 5 with bash and wait for it" },
      taskSignal.signal,
    );
    const child = result.details?.results?.[0] as any;
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(taskSignal.signal.aborted).toBe(true);
    const childStatusResult = created.mock.calls[1]?.context.messages.find((message: any) =>
      message.role === "toolResult" && message.toolName === "wallclock_status");
    const childStatus = resultValue(childStatusResult);
    expect(childStatus?.assignment?.id).toBe(assignmentId);
    expect(childStatus?.phase).toBe("active");
    expect(childEvents.some((event) => event.type === "tool_execution_start" && event.toolName === "bash")).toBe(true);
    expect(child?.aborted).toBe(true);
    expect(lifecycle.some((event) => event.status === "started")).toBe(true);
    expect(lifecycle.some((event) => event.status === "aborted")).toBe(true);

    const state = created.sessionManager.getEntries().filter((entry: any) =>
      entry.type === "custom" && entry.customType === "wall-clock-state").at(-1) as any;
    expect(state?.data?.reports?.[0]?.assignmentId).toBe(assignmentId);
    expect(state?.data?.reports?.[0]?.status).toBe("expired");
    expect(state?.data?.reports?.[0]?.risks?.[0]).toMatch(/No structured child evidence/);
  } finally {
    await created.session.dispose();
    created.authStorage.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
