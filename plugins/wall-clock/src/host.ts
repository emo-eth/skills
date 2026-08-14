import { parseDeadlineSpec } from "./time.ts";
import { stateFromEntries } from "./store.ts";
import { classifyAction, isWallClockControlTool, WallClockController } from "./controller.ts";
import type {
  ActionClass,
  ActivationInput,
  Assignment,
  AssignmentInput,
  ChildReportInput,
  Clock,
  ExpiryPolicy,
  PlanItem,
  ToolProposal,
  WallClockMode,
} from "./types.ts";

const FAST_LANE_DURATION_MS = 120_000;
const WRAP_IT_UP_DURATION_MS = 120_000;
const FAST_LANE_WRAP_UP_MS = 15_000;
const FAST_LANE_MAX_TOOL_CALLS = 12;
const MAX_CORRELATION_ENTRIES = 4_096;

type FastLaneKind = "do-it-now" | "wrap-it-up";

type FastLaneConfig = {
  displayName: string;
  durationMs: number;
};

const FAST_LANE_CONFIGS: Record<FastLaneKind, FastLaneConfig> = {
  "do-it-now": { displayName: "Do-it-now", durationMs: FAST_LANE_DURATION_MS },
  "wrap-it-up": { displayName: "Wrap-it-up", durationMs: WRAP_IT_UP_DURATION_MS },
};

type FastLaneInvocation = {
  kind: FastLaneKind;
  request: string;
};

type FastLaneState = FastLaneInvocation & {
  toolCalls: number;
};


export type RuntimeContext = {
  sessionId?: string;
  assignmentId?: string;
  sessionManager?: { getSessionFile?: () => string | undefined; getEntries?: () => unknown[]; getBranch?: () => unknown[] };
  ui?: { notify?: (message: string, level?: string) => void; setStatus?: (key: string, value: string | undefined) => void };
  signal?: AbortSignal;
  abort?: () => void | Promise<void>;
  isIdle?: () => boolean;
};

export type RuntimeHost = {
  on(event: string, handler: (event: any, ctx: RuntimeContext) => unknown): void;
  events?: { on(event: string, handler: (event: any) => unknown): void };
  registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: RuntimeContext) => unknown }): void;
  registerTool?: (definition: { name: string; label: string; description: string; parameters: unknown; execute: (...args: any[]) => unknown }) => void;
  appendEntry?: (customType: string, data?: unknown) => void;
  sendMessage?: (message: unknown, options?: unknown) => void;
  sendUserMessage?: (message: string, options?: { deliverAs?: "steer" | "followUp" }) => void;
  setStatus?: (key: string, value: string | undefined) => void;
};

type AbortRequest = {
  sessionId: string;
  assignmentId?: string;
  targets: Array<{ actionId: string; context: RuntimeContext }>;
};

export type HostEnforcement = {
  name: string;
  canBlockNew: boolean;
  canAbortAction?: (proposal: ToolProposal, context: RuntimeContext | undefined) => boolean;
  abortRunning?: (request: AbortRequest) => void | Promise<void>;
  abortObserved?: (event: unknown, context: RuntimeContext | undefined) => boolean;
  canAbortProvider?: (context?: RuntimeContext) => boolean;
  abortProvider?: (request: { sessionId: string; context: RuntimeContext }) => void | Promise<void>;
};

type ChildBinding = {
  parentSessionId: string;
  assignmentId: string;
};

type ActionLink = {
  sessionId: string;
  assignmentId?: string;
  assignmentIds?: string[];
  actionId: string;
  directSessionId: string;
  rawActionId: string;
  action: ActionClass;
};

export type HostCoordination = {
  controller: WallClockController;
  childBindings: Map<string, ChildBinding>;
  actionAssignments: Map<string, ActionLink>;
  actionContexts: Map<string, RuntimeContext>;
  providerContexts: Map<string, RuntimeContext>;
  persistenceOwners: Map<string, () => void>;
  timers: Map<string, { handle: unknown; cancel: (handle: unknown) => void }>;
  processedLifecycleEvents: Set<string>;
  blockedChildSessions: Set<string>;
  settledSessions: Set<string>;
};

export function createHostCoordination(controller = new WallClockController()): HostCoordination {
  return {
    controller,
    childBindings: new Map(),
    actionAssignments: new Map(),
    actionContexts: new Map(),
    providerContexts: new Map(),
    persistenceOwners: new Map(),
    timers: new Map(),
    processedLifecycleEvents: new Set(),
    blockedChildSessions: new Set(),
    settledSessions: new Set(),
  };
}

export type HostExtensionOptions = {
  controller?: WallClockController;
  coordination?: HostCoordination;
  clock?: Clock;
  enforcement?: HostEnforcement;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancelSchedule?: (handle: unknown) => void;
  scheduleStatus?: (callback: () => void, delayMs: number) => unknown;
  cancelStatusSchedule?: (handle: unknown) => void;
  publishChildCoordination?: (childSessionIds: string[], coordination: HostCoordination) => void;
  resolveChildCoordination?: (childSessionId: string) => HostCoordination | undefined;
  releaseChildCoordination?: (childSessionIds: string[]) => void;
};

type Scope = {
  sessionId: string;
  assignmentId?: string;
};
type AssignmentResolution = {
  assignment?: Assignment;
  assignmentInputs?: AssignmentInput[];
  reason?: string;
};

export function installHostExtension(host: RuntimeHost, options: HostExtensionOptions = {}): WallClockController {
  let coordination = options.coordination ?? createHostCoordination(options.controller ?? new WallClockController(options.clock));
  let controller = coordination.controller;
  const enforcement = options.enforcement;
  const schedule = options.schedule ?? ((callback: () => void, delayMs: number) => {
    const handle = setTimeout(callback, delayMs);
    handle.unref?.();
    return handle;
  });
  const cancelSchedule = options.cancelSchedule ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const scheduleStatus = options.scheduleStatus ?? ((callback: () => void, delayMs: number) => {
    const handle = setTimeout(callback, delayMs);
    handle.unref?.();
    return handle;
  });
  const cancelStatusSchedule = options.cancelStatusSchedule ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let currentDirectSessionId: string | undefined;
  let actionSequence = 0;
  const fastLanes = new Map<string, FastLaneState>();
  let statusRefresh: { handle: unknown; generation: number } | undefined;
  let statusRefreshGeneration = 0;

  const adoptCoordination = (next: HostCoordination | undefined): void => {
    if (!next?.controller || !next?.childBindings) return;
    coordination = next;
    controller = next.controller;
  };

  const directSessionId = (ctx?: RuntimeContext): string | undefined => {
    const explicit = ctx?.sessionId ?? ctx?.sessionManager?.getSessionFile?.();
    if (explicit) return explicit;
    return undefined;
  };

  const scopeFor = (ctx?: RuntimeContext, event?: any): Scope | undefined => {
    const direct = directSessionId(ctx) ?? (typeof event?.sessionId === "string" ? event.sessionId : undefined);
    const child = direct ? coordination.childBindings.get(direct) : undefined;
    if (child) return { sessionId: child.parentSessionId, assignmentId: child.assignmentId };
    const assignmentId = typeof event?.assignmentId === "string"
      ? event.assignmentId
      : typeof ctx?.assignmentId === "string" ? ctx.assignmentId : undefined;
    const currentBinding = currentDirectSessionId ? coordination.childBindings.get(currentDirectSessionId) : undefined;
    const sessionId = direct ?? currentBinding?.parentSessionId ?? currentDirectSessionId;
    if (assignmentId === undefined && currentBinding) return { sessionId: currentBinding.parentSessionId, assignmentId: currentBinding.assignmentId };
    return sessionId ? { sessionId, assignmentId } : undefined;
  };
  const actionScopeFor = (ctx?: RuntimeContext, event?: any): Scope | undefined => {
    const direct = directSessionId(ctx) ?? (typeof event?.sessionId === "string" ? event.sessionId : undefined);
    const child = direct ? coordination.childBindings.get(direct) : undefined;
    if (child) return { sessionId: child.parentSessionId, assignmentId: child.assignmentId };
    const assignmentId = typeof event?.assignmentId === "string"
      ? event.assignmentId
      : typeof ctx?.assignmentId === "string" ? ctx.assignmentId : undefined;
    return direct ? { sessionId: direct, assignmentId } : undefined;
  };

  const blockedChildSession = (ctx?: RuntimeContext, event?: any): boolean => {
    const direct = directSessionId(ctx) ?? (typeof event?.sessionId === "string" ? event.sessionId : undefined);
    return direct !== undefined && coordination.blockedChildSessions.has(direct);
  };
  const rememberContext = (ctx?: RuntimeContext, event?: any): Scope | undefined => {
    const direct = directSessionId(ctx) ?? (typeof event?.sessionId === "string" ? event.sessionId : undefined);
    if (direct) currentDirectSessionId = direct;
    const scope = scopeFor(ctx, event);
    if (direct && scope?.sessionId === direct) coordination.persistenceOwners.set(direct, () => writeOwnedState(direct));
    return scope;
  };

  const writeOwnedState = (sessionId: string): void => {
    const state = controller.snapshot(sessionId);
    if (state) host.appendEntry?.("wall-clock-state", state);
  };

  const requireStableScope = (ctx?: RuntimeContext): Scope => {
    const scope = actionScopeFor(ctx);
    if (!scope) throw new Error("Wall-clock requires a stable host session identifier");
    rememberContext(ctx);
    return scope;
  };

  const requireOwnerSession = (ctx?: RuntimeContext): string => {
    const direct = directSessionId(ctx);
    if (!direct) throw new Error("Wall-clock activation requires a stable host session identifier");
    if (coordination.childBindings.has(direct)) {
      throw new Error("Wall-clock activation is owned by this child session's parent");
    }
    currentDirectSessionId = direct;
    coordination.persistenceOwners.set(direct, () => writeOwnedState(direct));
    return direct;
  };

  const persist = (sessionId: string): void => {
    coordination.persistenceOwners.get(sessionId)?.();
  };

  const clearDeadline = (sessionId: string, assignmentId?: string): void => {
    const key = deadlineKey(sessionId, assignmentId);
    const timer = coordination.timers.get(key);
    if (timer !== undefined) {
      timer.cancel(timer.handle);
      coordination.timers.delete(key);
    }
  };

  const clearSessionDeadlines = (sessionId: string): void => {
    const prefix = `${encodeURIComponent(sessionId)}:`;
    for (const key of coordination.timers.keys()) {
      if (key.startsWith(prefix)) {
        const timer = coordination.timers.get(key);
        if (timer) timer.cancel(timer.handle);
        coordination.timers.delete(key);
      }
    }
  };

  const clearStatusRefresh = (): void => {
    statusRefreshGeneration += 1;
    if (!statusRefresh) return;
    cancelStatusSchedule(statusRefresh.handle);
    statusRefresh = undefined;
  };

  const scheduleStatusRefresh = (sessionId: string, ctx?: RuntimeContext, assignmentId?: string): void => {
    clearStatusRefresh();
    const generation = statusRefreshGeneration;
    const tick = (): void => {
      if (generation !== statusRefreshGeneration) return;
      updateStatus(host, controller, sessionId, ctx, assignmentId);
      scheduleNext();
    };
    const scheduleNext = (): void => {
      const status = controller.status(sessionId, assignmentId);
      if (status.phase !== "active" && status.phase !== "wrap-up") {
        statusRefresh = undefined;
        return;
      }
      const handle = scheduleStatus(tick, Math.min(1_000, Math.max(1, status.remainingMs)));
      statusRefresh = { handle, generation };
    };
    scheduleNext();
  };

  const ensureActivationSupport = (expiryPolicy: ExpiryPolicy, mode?: WallClockMode): void => {
    if (!enforcement?.canBlockNew) {
      throw new Error("Wall-clock activation rejected: this host has no tested pre-action blocking seam");
    }
    if (expiryPolicy === "abort-running") {
      if (!enforcement.abortRunning || !enforcement.abortObserved || !enforcement.canAbortAction) {
        throw new Error("Wall-clock activation rejected: this host cannot prove abort-running enforcement");
      }
      if (mode === "turn-limit" && (!enforcement.canAbortProvider || !enforcement.abortProvider)) {
        throw new Error("Wall-clock activation rejected: this host cannot prove abort-running provider enforcement");
      }
    }
  };

  const ensureChildCoordination = async (ctx?: RuntimeContext): Promise<void> => {
    const direct = directSessionId(ctx);
    if (!direct || coordination.childBindings.has(direct) || !options.resolveChildCoordination) return;
    let next = options.resolveChildCoordination(direct);
    if (!next) {
      await Promise.resolve();
      next = options.resolveChildCoordination(direct);
    }
    adoptCoordination(next);
  };

  const scheduleDeadline = (sessionId: string, assignmentId?: string, ctx?: RuntimeContext): void => {
    clearDeadline(sessionId, assignmentId);
    const status = controller.status(sessionId, assignmentId);
    if (!status.active || status.deadlineMs === undefined) return;
    const delayMs = Math.max(0, status.deadlineMs - (options.clock?.now() ?? Date.now()));
    const timer = schedule(() => {
      void handleExpiry(sessionId, assignmentId, ctx).catch((error) => notify(ctx, `Wall-clock expiry handling failed: ${errorMessage(error)}`, "error"));
    }, delayMs);
    coordination.timers.set(deadlineKey(sessionId, assignmentId), { handle: timer, cancel: cancelSchedule });
  };

  const handleExpiry = async (sessionId: string, assignmentId?: string, fallbackContext?: RuntimeContext): Promise<void> => {
    const status = controller.status(sessionId, assignmentId);
    const abortRunning = status.expiryPolicy === "abort-running";
    if (!status.active || status.phase !== "expired") return;
    if (abortRunning && assignmentId === undefined) {
      const providerContext = coordination.providerContexts.get(sessionId);
      if (providerContext) {
        coordination.providerContexts.delete(sessionId);
        if (!enforcement?.abortProvider) {
          throw new Error(`The ${enforcement?.name ?? "host"} cannot abort the active provider request`);
        }
        await enforcement.abortProvider({ sessionId, context: providerContext });
      }
    }
    const actions = controller.runningActions(sessionId).filter((action) => {
      if (action.abortRequestedAt !== undefined) return false;
      if (assignmentId !== undefined) return action.assignmentId === assignmentId;
      return abortRunning || action.assignmentId !== undefined;
    });
    if (actions.length === 0) return;
    if (!enforcement?.abortRunning) {
      throw new Error(`The ${enforcement?.name ?? "host"} cannot abort an expired child assignment`);
    }
    const targets = actions.map((action) => ({
      actionId: action.actionId,
      context: coordination.actionContexts.get(action.actionId) ?? fallbackContext,
    }));
    if (targets.some((target) => !target.context)) {
      throw new Error(`The ${enforcement.name} lost an executor context for an admitted action`);
    }
    for (const action of actions) controller.requestAbort(sessionId, action.actionId);
    await enforcement.abortRunning({
      sessionId,
      assignmentId,
      targets: targets as Array<{ actionId: string; context: RuntimeContext }>,
    });
  };

  const activateSession = (ctx: RuntimeContext | undefined, input: ActivationInput, plan: PlanItem[] = []) => {
    const sessionId = requireOwnerSession(ctx);
    ensureActivationSupport(input.expiryPolicy, input.mode);
    const status = controller.activate(sessionId, input, plan);
    scheduleDeadline(sessionId, undefined, ctx);
    persist(sessionId);
    updateStatus(host, controller, sessionId, ctx);
    scheduleStatusRefresh(sessionId, ctx);
    return status;
  };

  const setDurationSession = (ctx: RuntimeContext | undefined, durationMs: number) => {
    const sessionId = requireOwnerSession(ctx);
    const status = controller.status(sessionId);
    if (!status.active) throw new Error("Wall-clock is not active for this session");
    const updated = controller.setDuration(sessionId, durationMs);
    scheduleDeadline(sessionId, undefined, ctx);
    persist(sessionId);
    updateStatus(host, controller, sessionId, ctx);
    scheduleStatusRefresh(sessionId, ctx);
    return updated;
  };

  const resetSessionTurnById = (sessionId: string, ctx?: RuntimeContext) => {
    const status = controller.status(sessionId);
    if (!status.active || status.mode !== "turn-limit") return status;
    const reset = controller.resetTurn(sessionId);
    coordination.providerContexts.delete(sessionId);
    scheduleDeadline(sessionId, undefined, ctx);
    persist(sessionId);
    updateStatus(host, controller, sessionId, ctx);
    scheduleStatusRefresh(sessionId, ctx);
    return reset;
  };

  const stopSessionById = (sessionId: string, ctx?: RuntimeContext) => {
    const status = controller.status(sessionId);
    if (!status.active) {
      coordination.settledSessions.delete(sessionId);
      coordination.providerContexts.delete(sessionId);
      fastLanes.delete(sessionId);
      clearSessionDeadlines(sessionId);
      return status;
    }
    controller.stop(sessionId);
    coordination.settledSessions.delete(sessionId);
    coordination.providerContexts.delete(sessionId);
    fastLanes.delete(sessionId);
    clearSessionDeadlines(sessionId);
    clearStatusRefresh();
    persist(sessionId);
    updateStatus(host, controller, sessionId, ctx);
    return controller.status(sessionId);
  };

  const stopSession = (ctx: RuntimeContext | undefined) => {
    const sessionId = requireOwnerSession(ctx);
    return stopSessionById(sessionId, ctx);
  };

  const tryStopSettledSession = (sessionId: string, ctx?: RuntimeContext): void => {
    if (!coordination.settledSessions.has(sessionId)) return;
    const status = controller.status(sessionId);
    if (!status.active) {
      coordination.settledSessions.delete(sessionId);
      return;
    }
    if (controller.runningActions(sessionId).length > 0) return;
    for (const binding of coordination.childBindings.values()) {
      if (binding.parentSessionId === sessionId) return;
    }
    if (status.mode === "turn-limit") {
      controller.armTurn(sessionId);
      coordination.providerContexts.delete(sessionId);
      clearDeadline(sessionId);
      clearStatusRefresh();
      persist(sessionId);
      return;
    }
    coordination.settledSessions.delete(sessionId);
    stopSessionById(sessionId, ctx);
  };

  const beginSessionTurn = (sessionId: string, ctx?: RuntimeContext): void => {
    if (!coordination.settledSessions.has(sessionId)) return;
    const status = controller.status(sessionId);
    if (!status.active || status.mode !== "turn-limit") {
      coordination.settledSessions.delete(sessionId);
      return;
    }
    resetSessionTurnById(sessionId, ctx);
    coordination.settledSessions.delete(sessionId);
  };

  const markSessionSettled = (ctx?: RuntimeContext): void => {
    const scope = rememberContext(ctx);
    if (!scope || scope.assignmentId !== undefined) return;
    coordination.settledSessions.add(scope.sessionId);
    tryStopSettledSession(scope.sessionId, ctx);
  };

  const startFastLane = (ctx: RuntimeContext | undefined, invocation: FastLaneInvocation) => {
    const sessionId = requireOwnerSession(ctx);
    const existing = fastLanes.get(sessionId);
    if (existing) return controller.status(sessionId);
    const config = FAST_LANE_CONFIGS[invocation.kind];
    if (controller.status(sessionId).active) {
      throw new Error(`${config.displayName} requires an inactive wall-clock session`);
    }
    const status = activateSession(ctx, {
      durationMs: config.durationMs,
      wrapUpMs: FAST_LANE_WRAP_UP_MS,
      expiryPolicy: "abort-running",
    });
    fastLanes.set(sessionId, { ...invocation, request: invocation.request || "the current user request", toolCalls: 0 });
    notify(
      ctx,
      `${config.displayName} active: ${config.durationMs / 1_000}s hard deadline, abort-running, bounded delegation allowed before wrap-up, ${FAST_LANE_MAX_TOOL_CALLS} tool calls maximum`,
      "info",
    );
    return status;
  };

  const stopFastLane = (sessionId: string, ctx?: RuntimeContext): void => {
    if (!fastLanes.delete(sessionId)) return;
    stopSessionById(sessionId, ctx);
  };


  const restoreSession = async (_event: any, ctx: RuntimeContext) => {
    const direct = directSessionId(ctx);
    if (!direct) return;
    clearStatusRefresh();
    await ensureChildCoordination(ctx);
    const previousDirect = currentDirectSessionId;
    if (previousDirect && previousDirect !== direct && !coordination.childBindings.has(previousDirect)) {
      stopFastLane(previousDirect);
      persist(previousDirect);
      clearSessionDeadlines(previousDirect);
      coordination.persistenceOwners.delete(previousDirect);
    }
    currentDirectSessionId = direct;
    const child = coordination.childBindings.get(direct);
    if (child) {
      updateStatus(host, controller, child.parentSessionId, ctx, child.assignmentId);
      scheduleStatusRefresh(child.parentSessionId, ctx, child.assignmentId);
      return;
    }
    coordination.persistenceOwners.set(direct, () => writeOwnedState(direct));
    clearSessionDeadlines(direct);
    const restored = stateFromEntries(ctx.sessionManager?.getEntries?.() ?? ctx.sessionManager?.getBranch?.() ?? [], direct);
    if (restored === null) {
      controller.discard(direct);
      clearSessionDeadlines(direct);
      notify(ctx, "Wall-clock state is malformed or belongs to another session; control is inactive", "error");
      updateStatus(host, controller, direct, ctx);
      return;
    }
    if (restored) controller.restoreFromState(restored, direct);
    else controller.discard(direct);
    const snapshot = controller.snapshot(direct);
    if (snapshot && !snapshot.stopped) {
      scheduleDeadline(direct, undefined, ctx);
      for (const assignment of snapshot.assignments) {
        if (assignment.status === "active") scheduleDeadline(direct, assignment.id, ctx);
      }
    }
    updateStatus(host, controller, direct, ctx);
    scheduleStatusRefresh(direct, ctx);
  };

  host.registerCommand("wallclock", {
    description: "Activate and inspect enforced wall-clock control",
    handler: async (args, ctx) => {
      await ensureChildCoordination(ctx);
      rememberContext(ctx);
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const command = parts.shift() ?? "status";
      if (command === "set") {
        const duration = parts.shift();
        if (!duration || parts.length > 0) throw new Error("Usage: /wallclock set 2m");
        const parsed = parseDeadlineSpec(duration, options.clock?.now() ?? Date.now());
        if (parsed.durationMs === undefined) throw new Error("The set command requires a positive duration, not a local-time deadline");
        const status = setDurationSession(ctx, parsed.durationMs);
        notify(ctx, `Wall-clock duration updated: ${formatStatus(status)}`, "info");
        return;
      }
      if (command === "turn-limit") {
        const duration = parts.shift();
        if (!duration) throw new Error("Usage: /wallclock turn-limit 2m [block-new|abort-running|abort] [prompt...]");
        const parsed = parseDeadlineSpec(duration, options.clock?.now() ?? Date.now());
        if (parsed.durationMs === undefined) throw new Error("The turn-limit command requires a positive duration, not a local-time deadline");
        const expiryPolicy = isExpiryPolicy(parts[0]) ? parseExpiryPolicy(parts.shift()!) : "abort-running";
        const prompt = parts.join(" ");
        if (prompt && !host.sendUserMessage) throw new Error("This host cannot submit the wall-clock prompt");
        const status = activateSession(ctx, { durationMs: parsed.durationMs, mode: "turn-limit", expiryPolicy }, []);
        notify(ctx, `Wall-clock turn-limit active: ${formatStatus(status)}`, "info");
        if (prompt) host.sendUserMessage!(prompt, ctx?.isIdle?.() === false ? { deliverAs: "steer" } : undefined);
        return;
      }
      if (command === "start" || (command !== "status" && command !== "stop")) {
        const deadline = command === "start" ? parts.shift() : command;
        if (!deadline) throw new Error("Usage: /wallclock [start] 30m|5pm [block-new|abort-running|abort] [prompt...]");
        const expiryPolicy = isExpiryPolicy(parts[0]) ? parseExpiryPolicy(parts.shift()!) : "block-new";
        const prompt = parts.join(" ");
        if (prompt && !host.sendUserMessage) throw new Error("This host cannot submit the wall-clock prompt");
        const status = activateSession(ctx, { ...parseDeadlineSpec(deadline, options.clock?.now() ?? Date.now()), expiryPolicy }, []);
        notify(ctx, `Wall-clock active: ${status.phase}, ${formatStatus(status)}`, "info");
        if (prompt) host.sendUserMessage!(prompt, ctx?.isIdle?.() === false ? { deliverAs: "steer" } : undefined);
        return;
      }
      if (command === "stop") {
        stopSession(ctx);
        notify(ctx, "Wall-clock control stopped", "info");
        return;
      }
      const scope = requireStableScope(ctx);
      notify(ctx, `${controller.context(scope.sessionId, scope.assignmentId)}\nExpiry policy: ${controller.status(scope.sessionId, scope.assignmentId).expiryPolicy ?? "none"}`, "info");
    },
  });

  registerNativeTools();

  host.on("session_start", restoreSession);
  host.on("session_switch", restoreSession);
  host.on("session_branch", restoreSession);
  host.on("session_tree", restoreSession);

  host.on("context", async (event, ctx) => {
    await ensureChildCoordination(ctx);
    const scope = rememberContext(ctx, event);
    if (!scope) return undefined;
    const status = controller.status(scope.sessionId, scope.assignmentId);
    if (!status.active || !status.context || status.phase === "armed") return undefined;
    const messages = Array.isArray(event?.messages) ? event.messages : [];
    const fastLane = fastLanes.get(scope.sessionId);
    const contextText = [
      controller.context(scope.sessionId, scope.assignmentId),
      fastLane
        ? `${FAST_LANE_CONFIGS[fastLane.kind].displayName} host guard: execute only ${fastLane.request}; use as many bounded wall-clock assignments as useful before wrap-up; do not add adjacent non-delegated work. ${Math.max(0, FAST_LANE_MAX_TOOL_CALLS - fastLane.toolCalls)} tool calls remain.`
        : undefined,
    ].filter((part): part is string => part !== undefined).join("\n");
    return {
      messages: [
        ...messages,
        { role: "user", content: [{ type: "text", text: contextText }], timestamp: status.context.currentTimeMs },
      ],
    };
  });

  host.on("before_provider_request", async (_event, ctx) => {
    await ensureChildCoordination(ctx);
    const scope = rememberContext(ctx);
    if (scope) {
      if (scope.assignmentId === undefined) {
        const control = controller.status(scope.sessionId);
        if (control.mode === "turn-limit" && control.expiryPolicy === "abort-running") {
          if (!enforcement?.canAbortProvider?.(ctx)) {
            throw new Error("Wall-clock cannot enforce abort-running turn-limit: the provider request is not abortable");
          }
          coordination.providerContexts.set(scope.sessionId, ctx);
        }
      }
      controller.beginInference(scope.sessionId);
    }
    return undefined;
  });

  host.on("before_agent_start", async (event, ctx) => {
    await ensureChildCoordination(ctx);
    const scope = rememberContext(ctx, event);
    if (scope?.assignmentId === undefined) {
      const invocation = parseFastLaneRequest(event);
      if (invocation !== null) startFastLane(ctx, invocation);
    }
    return undefined;
  });

  host.on("message_start", async (event, ctx) => {
    await ensureChildCoordination(ctx);
    const scope = rememberContext(ctx, event);
    const role = event?.message?.role ?? event?.role;
    if (scope && scope.assignmentId === undefined && role === "user") beginSessionTurn(scope.sessionId, ctx);
    const invocation = parseFastLaneRequest(event?.message ?? event);
    if (scope?.assignmentId === undefined && invocation !== null) startFastLane(ctx, invocation);
    return undefined;
  });

  host.on("message_end", async (event, ctx) => {
    await ensureChildCoordination(ctx);
    const scope = rememberContext(ctx);
    const role = event?.message?.role ?? event?.role;
    if (scope && role === "assistant") controller.endInference(scope.sessionId);
    return undefined;
  });

  host.on("turn_end", async (_event, ctx) => {
    const scope = rememberContext(ctx);
    if (scope) controller.endInference(scope.sessionId);
    return undefined;
  });

  // Pi emits agent_settled after retries and continuations; OMP marks a
  // terminal agent_end with willContinue omitted or false.
  host.on("agent_end", async (event, ctx) => {
    if (isTerminalAgentEnd(event)) markSessionSettled(ctx);
    return undefined;
  });

  host.on("agent_settled", async (_event, ctx) => {
    markSessionSettled(ctx);
    return undefined;
  });
  host.on("tool_execution_start", async (event, ctx) => {
    await ensureChildCoordination(ctx);
    const scope = actionScopeFor(ctx, event);
    if (!scope || blockedChildSession(ctx, event)) {
      return { block: true, reason: "Wall-clock requires a stable and valid child lifecycle scope before tool execution" };
    }
    const actionId = canonicalActionId(scope, existingActionId(event));
    if (actionId && controller.runningActions(scope.sessionId).some((action) => action.actionId === actionId)) {
      return { block: true, reason: "The host action identifier is already active" };
    }
    if (actionId) controller.beginToolCall(scope.sessionId, actionId);
    return undefined;
  });

  host.on("tool_call", async (event, ctx) => {
    await ensureChildCoordination(ctx);
    if (blockedChildSession(ctx, event)) {
      return { block: true, reason: "Wall-clock blocked this child: its lifecycle contract was invalid or incomplete" };
    }
    const scope = actionScopeFor(ctx, event);
    if (!scope) {
      return { block: true, reason: "Wall-clock requires a stable host session identifier before tool execution" };
    }
    const toolName = String(event?.toolName ?? event?.name ?? "unknown");
    if (toolName.toLowerCase() === "yield" && scope.assignmentId) {
      const hasReport = controller.snapshot(scope.sessionId)?.reports.some((report) => report.assignmentId === scope.assignmentId) ?? false;
      if (!hasReport) {
        return { block: true, reason: "A wall-clock child must call wallclock_report before OMP yield" };
      }
      return undefined;
    }
    if (!controller.status(scope.sessionId, scope.assignmentId).active) return undefined;
    const input = event?.input;
    const action = (event?.action as ActionClass | undefined) ?? classifyAction(toolName, input);
    const nativeTool = isWallClockControlTool(toolName);
    const fastLane = fastLanes.get(scope.sessionId);
    const fastLaneConfig = fastLane ? FAST_LANE_CONFIGS[fastLane.kind] : undefined;
    if (fastLane && fastLaneConfig && !nativeTool) {
      if (fastLane.toolCalls >= FAST_LANE_MAX_TOOL_CALLS) {
        return { block: true, reason: `${fastLaneConfig.displayName} reached its ${FAST_LANE_MAX_TOOL_CALLS}-tool limit` };
      }
    }
    const suppliedActionId = existingActionId(event);
    const childActionRequiresAbort = scope.assignmentId !== undefined;
    const scopeStatus = controller.status(scope.sessionId, scope.assignmentId);
    if (!nativeTool && (scopeStatus.expiryPolicy === "abort-running" || childActionRequiresAbort) && !suppliedActionId) {
      return {
        block: true,
        reason: childActionRequiresAbort
          ? "Child assignments require a host action identifier before execution"
          : "Abort-running requires a host action identifier before execution",
      };
    }
    const rawActionId = suppliedActionId ?? `wall-clock-action-${++actionSequence}`;
    const actionId = canonicalActionId(scope, rawActionId);
    if (!actionId) throw new Error("Wall-clock could not create an action identifier");
    if (!nativeTool && controller.runningActions(scope.sessionId).some((runningAction) => runningAction.actionId === actionId)) {
      return { block: true, reason: "The host action identifier is already active" };
    }
    let assignmentResolution: AssignmentResolution;
    try {
      assignmentResolution = nativeTool
        ? {}
        : resolveAssignment(controller, scope.sessionId, input, action, scope.assignmentId);
    } catch (error) {
      return { block: true, reason: errorMessage(error) };
    }
    if (assignmentResolution.reason) return { block: true, reason: assignmentResolution.reason };
    const assignment = assignmentResolution.assignment;
    const assignmentId = assignment?.id ?? scope.assignmentId;
    const proposal: ToolProposal = {
      toolName,
      input,
      action,
      assignmentId,
      actionId,
      enforceable: true,
    };
    const decision = controller.decideTool(scope.sessionId, proposal);
    if (!decision.allow) return { block: true, reason: decision.reason };
    const requiresAbort = assignmentId !== undefined || controller.status(scope.sessionId, assignmentId).expiryPolicy === "abort-running";
    if (!nativeTool && requiresAbort) {
      if (assignmentId !== undefined && (!enforcement?.abortRunning || !enforcement?.abortObserved)) {
        return { block: true, reason: "Child assignments require a host abort seam before execution" };
      }
      if (!enforcement?.canAbortAction?.(proposal, ctx)) {
        return {
          block: true,
          reason: `${assignmentId !== undefined ? "Child assignment" : "Abort-running"} cannot admit ${toolName}: the ${enforcement?.name ?? "host"} cannot prove that this action can be aborted`,
        };
      }
      if (controller.status(scope.sessionId, assignmentId).expiryPolicy === "abort-running") {
        const sameAbortDomainIsBusy = controller.runningActions(scope.sessionId).some((runningAction) => {
          const runningContext = coordination.actionContexts.get(runningAction.actionId);
          if (!runningContext) return true;
          const runningDirectSessionId = directSessionId(runningContext);
          const proposedDirectSessionId = directSessionId(ctx);
          if (runningDirectSessionId && proposedDirectSessionId) return runningDirectSessionId === proposedDirectSessionId;
          return runningContext.abort === ctx?.abort;
        });
        if (sameAbortDomainIsBusy) {
          return { block: true, reason: "Abort-running allows only one admitted action at a time in each host session because its abort signal is session-wide" };
        }
      }
    }
    const actionDirectSessionId = directSessionId(ctx) ?? scope.sessionId;
    const actionLink = actionLinkKey(actionDirectSessionId, rawActionId);
    if (!nativeTool && !coordination.actionAssignments.has(actionLink) && coordination.actionAssignments.size >= MAX_CORRELATION_ENTRIES) {
      return { block: true, reason: "Wall-clock action correlation capacity is exhausted; finish or inspect existing actions before starting more work" };
    }
    let assignments: Assignment[] | undefined;
    if (assignmentResolution.assignmentInputs) {
      try {
        assignments = controller.assignBatch(scope.sessionId, assignmentResolution.assignmentInputs);
      } catch (error) {
        return { block: true, reason: errorMessage(error) };
      }
      for (const childAssignment of assignments) scheduleDeadline(scope.sessionId, childAssignment.id, ctx);
    }
    controller.beginToolCall(scope.sessionId, actionId);
    if (fastLane && !nativeTool) fastLane.toolCalls += 1;
    if (!nativeTool) {
      controller.startAction(scope.sessionId, actionId, toolName, action, assignmentId);
      if (ctx) coordination.actionContexts.set(actionId, ctx);
      coordination.actionAssignments.set(actionLink, {
        sessionId: scope.sessionId,
        assignmentId,
        assignmentIds: assignments?.map((childAssignment) => childAssignment.id),
        actionId,
        directSessionId: actionDirectSessionId,
        rawActionId,
        action,
      });
      if (action === "delegate") {
        if (assignments) injectBatchAssignmentContext(event, controller, scope.sessionId, assignments);
        else if (assignment) injectAssignmentContext(event, controller, scope.sessionId, assignment);
      }
    }
    updateStatus(host, controller, scope.sessionId, ctx, assignmentId);
    return undefined;
  });
  host.on("tool_result", async (event, ctx) => {
    await ensureChildCoordination(ctx);
    finishAction(event, ctx);
    return undefined;
  });

  host.on("tool_execution_end", async (event, ctx) => {
    await ensureChildCoordination(ctx);
    finishAction(event, ctx);
    return undefined;
  });

  host.on("user_bash", async (event, ctx) => {
    await ensureChildCoordination(ctx);
    if (blockedChildSession(ctx, event)) {
      return { result: { output: "Wall-clock blocked this child: its lifecycle contract was invalid or incomplete", exitCode: 1, cancelled: true, truncated: false } };
    }
    const scope = actionScopeFor(ctx, event);
    if (!scope) {
      return { result: { output: "Wall-clock blocked this command: a stable host session identifier is required", exitCode: 1, cancelled: true, truncated: false } };
    }
    if (!controller.status(scope.sessionId, scope.assignmentId).active) return undefined;
    if (scope.assignmentId !== undefined) {
      return { result: { output: "Wall-clock blocked this child command: the host cannot prove that user_bash can be aborted at the child deadline", exitCode: 1, cancelled: true, truncated: false } };
    }
    const actionId = `wall-clock-user-bash-${++actionSequence}`;
    const input = { command: event?.command, cwd: event?.cwd };
    controller.beginToolCall(scope.sessionId, actionId);
    const decision = controller.decideTool(scope.sessionId, {
      toolName: "user_bash",
      input,
      action: classifyAction("bash", input),
      actionId,
      enforceable: true,
    });
    if (!decision.allow) {
      controller.endAction(scope.sessionId, actionId);
      return { result: { output: `Wall-clock blocked this command: ${decision.reason}`, exitCode: 1, cancelled: true, truncated: false } };
    }
    if (controller.status(scope.sessionId, scope.assignmentId).expiryPolicy === "abort-running") {
      controller.endAction(scope.sessionId, actionId);
      return { result: { output: "Wall-clock blocked this command: abort-running cannot observe or abort user_bash execution", exitCode: 1, cancelled: true, truncated: false } };
    }
    controller.endAction(scope.sessionId, actionId);
    return undefined;
  });

  host.on("session_shutdown", async (_event, ctx) => {
    const direct = directSessionId(ctx) ?? currentDirectSessionId;
    if (direct && !coordination.childBindings.has(direct)) {
      const childSessionIds = [...coordination.childBindings.entries()]
        .filter(([, binding]) => binding.parentSessionId === direct)
        .map(([childSessionId]) => childSessionId);
      options.releaseChildCoordination?.(childSessionIds);
      for (const childSessionId of childSessionIds) coordination.childBindings.delete(childSessionId);
      persist(direct);
      clearSessionDeadlines(direct);
      coordination.providerContexts.delete(direct);
      coordination.persistenceOwners.delete(direct);
    }
    clearStatusRefresh();
    if (direct) coordination.settledSessions.delete(direct);
    if (direct === currentDirectSessionId) currentDirectSessionId = undefined;
  });

  registerChildLifecycleListeners();

  return controller;

  function registerNativeTools(): void {
    host.registerTool?.({
      name: "wallclock_start",
      label: "Start wall-clock",
      description: "Start enforced wall-clock control with a deadline, mode, and expiry policy.",
      parameters: START_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<{ deadline: string; mode?: WallClockMode; expiryPolicy: ExpiryPolicy; wrapUpMs?: number; plan?: PlanItem[] }>(args);
        const ctx = toolContext(args);
        await ensureChildCoordination(ctx);
        const deadlineInput = parseDeadlineSpec(input.deadline, options.clock?.now() ?? Date.now());
        return textResult(activateSession(ctx, {
          ...deadlineInput,
          mode: parseWallClockMode(input.mode),
          expiryPolicy: parseExpiryPolicy(input.expiryPolicy),
          wrapUpMs: input.wrapUpMs,
        }, input.plan ?? []));
      },
    });

    host.registerTool?.({
      name: "wallclock_set",
      label: "Set wall-clock duration",
      description: "Change the active wall-clock duration for the current session.",
      parameters: SET_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<{ duration: string }>(args);
        const ctx = toolContext(args);
        await ensureChildCoordination(ctx);
        const parsed = parseDeadlineSpec(input.duration, options.clock?.now() ?? Date.now());
        if (parsed.durationMs === undefined) throw new Error("wallclock_set requires a positive duration, not a local-time deadline");
        return textResult(setDurationSession(ctx, parsed.durationMs));
      },
    });

    host.registerTool?.({
      name: "wallclock_status",
      label: "Wall-clock status",
      description: "Read measured wall-clock status and elapsed-time context.",
      parameters: STATUS_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<{ assignmentId?: string }>(args);
        const ctx = toolContext(args);
        await ensureChildCoordination(ctx);
        const scope = requireStableScope(ctx);
        return textResult(controller.status(scope.sessionId, assignmentForScope(scope, input.assignmentId)));
      },
    });

    host.registerTool?.({
      name: "wallclock_stop",
      label: "Stop wall-clock",
      description: "Stop wall-clock control for the current host session.",
      parameters: EMPTY_SCHEMA,
      execute: async (...args: any[]) => {
        const ctx = toolContext(args);
        await ensureChildCoordination(ctx);
        return textResult(stopSession(ctx));
      },
    });

    host.registerTool?.({
      name: "wallclock_context",
      label: "Wall-clock context",
      description: "Read measured current time, elapsed time, phase, and permitted next action.",
      parameters: STATUS_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<{ assignmentId?: string }>(args);
        const ctx = toolContext(args);
        await ensureChildCoordination(ctx);
        const scope = requireStableScope(ctx);
        const assignmentId = assignmentForScope(scope, input.assignmentId);
        return textResult({ status: controller.status(scope.sessionId, assignmentId), context: controller.context(scope.sessionId, assignmentId) });
      },
    });

    host.registerTool?.({
      name: "wallclock_check",
      label: "Check wall-clock action",
      description: "Return the current host decision for a proposed action without replacing the host gate.",
      parameters: CHECK_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<{ toolName: string; action?: ActionClass; assignmentId?: string; input?: unknown }>(args);
        const ctx = toolContext(args);
        await ensureChildCoordination(ctx);
        const scope = requireStableScope(ctx);
        return textResult(controller.decideTool(scope.sessionId, { ...input, assignmentId: assignmentForScope(scope, input.assignmentId), enforceable: false }));
      },
    });

    host.registerTool?.({
      name: "wallclock_assign",
      label: "Create wall-clock assignment",
      description: "Create a bounded assignment under the active wall-clock session.",
      parameters: ASSIGNMENT_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<AssignmentInput>(args);
        const ctx = toolContext(args);
        await ensureChildCoordination(ctx);
        const scope = requireStableScope(ctx);
        if (scope.assignmentId) throw new Error("A child assignment cannot create another assignment");
        const assignment = controller.assign(scope.sessionId, input);
        scheduleDeadline(scope.sessionId, assignment.id, ctx);
        persist(scope.sessionId);
        return textResult({ assignment, context: controller.context(scope.sessionId, assignment.id) });
      },
    });

    host.registerTool?.({
      name: "wallclock_complete",
      label: "Complete wall-clock assignment",
      description: "Mark an assignment complete, partial, blocked, or expired using measured elapsed time.",
      parameters: COMPLETE_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<{ assignmentId: string; status: "complete" | "partial" | "blocked" | "expired" }>(args);
        const ctx = toolContext(args);
        await ensureChildCoordination(ctx);
        const scope = requireStableScope(ctx);
        const assignmentId = scope.assignmentId ?? input.assignmentId;
        if (scope.assignmentId && input.assignmentId !== scope.assignmentId) throw new Error("A child session can only complete its own assignment");
        const assignment = controller.complete(scope.sessionId, assignmentId, input.status);
        clearDeadline(scope.sessionId, assignmentId);
        persist(scope.sessionId);
        return textResult({ assignment, status: controller.status(scope.sessionId, assignmentId) });
      },
    });

    host.registerTool?.({
      name: "wallclock_report",
      label: "Record wall-clock report",
      description: "Record a vertical-slice report with evidence, validation, shortcuts, risks, and measured elapsed time.",
      parameters: REPORT_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<ChildReportInput>(args);
        const ctx = toolContext(args);
        await ensureChildCoordination(ctx);
        const scope = requireStableScope(ctx);
        const assignmentId = scope.assignmentId ?? input.assignmentId;
        if (scope.assignmentId && input.assignmentId !== scope.assignmentId) throw new Error("A child session can only report its own assignment");
        const report = controller.report(scope.sessionId, { ...input, assignmentId });
        clearDeadline(scope.sessionId, assignmentId);
        persist(scope.sessionId);
        return textResult({ report, status: controller.status(scope.sessionId, assignmentId) });
      },
    });

    host.registerTool?.({
      name: "wallclock_revise_plan",
      label: "Revise wall-clock plan",
      description: "Record parent plan changes after a bounded result or time contraction.",
      parameters: PLAN_REVISION_SCHEMA,
      execute: async (...args: any[]) => {
        const input = toolInput<{ plan: PlanItem[]; reason: string; sourceAssignmentId?: string }>(args);
        const ctx = toolContext(args);
        await ensureChildCoordination(ctx);
        const scope = requireStableScope(ctx);
        if (scope.assignmentId) throw new Error("Only the parent session can revise the parent plan");
        const revision = controller.setPlan(scope.sessionId, input.plan, input.reason, input.sourceAssignmentId);
        persist(scope.sessionId);
        return textResult({ revision, status: controller.status(scope.sessionId) });
      },
    });
  }

  function finishAction(event: unknown, ctx?: RuntimeContext): void {
    const scope = actionScopeFor(ctx, event);
    if (!scope) return;
    const rawActionId = existingActionId(event);
    if (!rawActionId) return;
    const eventSessionId = event && typeof event === "object" && "sessionId" in event && typeof event.sessionId === "string"
      ? event.sessionId
      : undefined;
    const linkedEntry = findActionLink(coordination.actionAssignments, rawActionId, directSessionId(ctx) ?? eventSessionId);
    const linked = linkedEntry?.[1];
    const actionId = linked?.actionId ?? canonicalActionId(scope, rawActionId);
    if (!actionId) return;
    const running = controller.runningActions(linked?.sessionId ?? scope.sessionId).find((action) => action.actionId === actionId);
    const actionContext = coordination.actionContexts.get(actionId) ?? ctx;
    const observed = running?.abortRequestedAt !== undefined && Boolean(enforcement?.abortObserved?.(event, actionContext));
    if (observed) controller.markAbortObserved(linked?.sessionId ?? scope.sessionId, actionId);
    const finished = controller.endAction(linked?.sessionId ?? scope.sessionId, actionId, options.clock?.now() ?? Date.now(), observed);
    if (finished) {
      if (linkedEntry && !linked?.assignmentIds) coordination.actionAssignments.delete(linkedEntry[0]);
      coordination.actionContexts.delete(actionId);
    }
    tryStopSettledSession(linked?.sessionId ?? scope.sessionId);
  }

  function registerChildLifecycleListeners(): void {
    const lifecycle = (event: any) => {
      const eventKey = JSON.stringify([
        event?.parentSessionId ?? event?.sessionId ?? currentDirectSessionId ?? null,
        event?.id,
        event?.sessionFile,
        event?.status,
        event?.parentToolCallId,
        event?.index,
      ]);
      if (coordination.processedLifecycleEvents.has(eventKey)) return;
      coordination.processedLifecycleEvents.add(eventKey);
      if (coordination.processedLifecycleEvents.size > 4_096) {
        const oldest = coordination.processedLifecycleEvents.values().next().value;
        if (typeof oldest === "string") coordination.processedLifecycleEvents.delete(oldest);
      }

      const parentToolCallId = typeof event?.parentToolCallId === "string" ? event.parentToolCallId : undefined;
      const childIds = [event?.id, event?.sessionFile].filter((id): id is string => typeof id === "string" && id.length > 0);
      const registeredChildIds = [
        ...childIds,
        ...(typeof event?.sessionFile === "string" ? [sessionArtifactPrefix(event.sessionFile)] : []),
      ];
      const knownBinding = childIds.map((childId) => coordination.childBindings.get(childId)).find((binding) => binding !== undefined);
      const linkedEntry = parentToolCallId
        ? findActionLink(
          coordination.actionAssignments,
          parentToolCallId,
          typeof event?.parentSessionId === "string" ? event.parentSessionId : currentDirectSessionId,
          true,
        )
        : undefined;
      const linked = linkedEntry?.[1];
      if (parentToolCallId && !linked && !knownBinding) {
        for (const childId of registeredChildIds) coordination.blockedChildSessions.add(childId);
        options.publishChildCoordination?.(registeredChildIds, coordination);
        if (event.status === "aborted" || event.status === "failed" || event.status === "completed") {
          options.releaseChildCoordination?.(registeredChildIds);
          for (const childId of registeredChildIds) {
            coordination.blockedChildSessions.delete(childId);
            coordination.childBindings.delete(childId);
          }
        }
        return;
      }
      const parentSessionId = linked?.sessionId ?? knownBinding?.parentSessionId
        ?? (typeof event?.parentSessionId === "string" ? event.parentSessionId : undefined)
        ?? currentDirectSessionId;
      const assignmentIds = linked?.assignmentIds;
      const eventIndex = typeof event?.index === "number" && Number.isInteger(event.index) ? event.index : undefined;

      if (assignmentIds !== undefined && (eventIndex === undefined || eventIndex < 0 || eventIndex >= assignmentIds.length)) {
        for (const childId of registeredChildIds) coordination.blockedChildSessions.add(childId);
        options.publishChildCoordination?.(registeredChildIds, coordination);
        if (parentSessionId && linked) {
          const snapshot = controller.snapshot(parentSessionId);
          for (const assignmentId of assignmentIds) {
            const assignment = snapshot?.assignments.find((item) => item.id === assignmentId);
            if (!assignment || assignment.status !== "active") continue;
            controller.report(parentSessionId, {
              assignmentId,
              status: "blocked",
              completed: [],
              evidence: [],
              partial: [],
              skipped: ["The child lifecycle event did not identify its batch assignment"],
              validation: [],
              shortcuts: [],
              risks: ["The host could not correlate the child to exactly one assignment"],
              unknowns: ["The child session outcome is unknown"],
              recommendedParentAction: "Inspect the child transcript and decide whether to retry the blocked assignments",
            });
            clearDeadline(parentSessionId, assignmentId);
          }
          persist(parentSessionId);
          const running = controller.runningActions(parentSessionId).find((action) => action.actionId === linked.actionId);
          if (running) {
            controller.endAction(parentSessionId, linked.actionId, options.clock?.now() ?? Date.now());
            coordination.actionContexts.delete(linked.actionId);
            coordination.actionAssignments.delete(linkedEntry![0]);
          }
        }
        if (event.status === "aborted" || event.status === "failed" || event.status === "completed") {
          options.releaseChildCoordination?.(registeredChildIds);
          for (const childId of registeredChildIds) {
            coordination.blockedChildSessions.delete(childId);
            coordination.childBindings.delete(childId);
          }
        }
        return;
      }

      const assignmentId = linked?.assignmentId
        ?? (assignmentIds && eventIndex !== undefined ? assignmentIds[eventIndex] : undefined)
        ?? knownBinding?.assignmentId
        ?? (typeof event?.assignmentId === "string" ? event.assignmentId : undefined)
        ?? (parentSessionId && !assignmentIds ? controller.assignmentForDelegation(parentSessionId)?.id : undefined);
      if (!parentSessionId || !assignmentId || childIds.length === 0) return;
      if (event.status === "started") {
        controller.attachChild(parentSessionId, assignmentId, childIds.at(-1)!);
        for (const childId of registeredChildIds) coordination.childBindings.set(childId, { parentSessionId, assignmentId });
        options.publishChildCoordination?.(registeredChildIds, coordination);
        persist(parentSessionId);
      } else if (event.status === "aborted" || event.status === "failed" || event.status === "completed") {
        const snapshot = controller.snapshot(parentSessionId);
        const hasReport = snapshot?.reports.some((report) => report.assignmentId === assignmentId) ?? false;
        if (!hasReport) {
          const expired = event.status === "aborted" && controller.status(parentSessionId, assignmentId).phase === "expired";
          controller.report(parentSessionId, {
            assignmentId,
            status: expired ? "expired" : "blocked",
            completed: [],
            evidence: [],
            partial: [],
            skipped: ["The child session ended without wallclock_report"],
            validation: [],
            shortcuts: [],
            risks: ["No structured child evidence or validation was returned"],
            unknowns: ["The child session outcome is unknown"],
            recommendedParentAction: "Inspect the child transcript and decide whether to retry the assignment",
          });
          clearDeadline(parentSessionId, assignmentId);
          persist(parentSessionId);
        }
        if (linked) {
          const current = controller.snapshot(parentSessionId);
          const allAssignmentsTerminal = linked.assignmentIds
            ? linked.assignmentIds.every((id) => current?.assignments.find((assignment) => assignment.id === id)?.status !== "active")
            : true;
          if (allAssignmentsTerminal) {
            const running = controller.runningActions(parentSessionId).find((action) => action.actionId === linked.actionId);
            const observed = event.status === "aborted" && running?.abortRequestedAt !== undefined;
            controller.endAction(parentSessionId, linked.actionId, options.clock?.now() ?? Date.now(), observed);
            coordination.actionContexts.delete(linked.actionId);
            coordination.actionAssignments.delete(linkedEntry![0]);
          }
        }
        options.releaseChildCoordination?.(registeredChildIds);
        for (const [childId, binding] of coordination.childBindings) {
          if (binding.parentSessionId === parentSessionId && binding.assignmentId === assignmentId) {
            coordination.childBindings.delete(childId);
          }
        }
        for (const childId of registeredChildIds) coordination.blockedChildSessions.delete(childId);
        tryStopSettledSession(parentSessionId);
      }
    };

    if (host.events) {
      host.events.on("task:subagent:lifecycle", lifecycle);
    } else {
      host.on("task:subagent:lifecycle", lifecycle as any);
    }
  }
}

function sessionArtifactPrefix(sessionFile: string): string {
  return sessionFile.endsWith(".jsonl") ? sessionFile.slice(0, -6) : sessionFile;
}

function resolveAssignment(
  controller: WallClockController,
  sessionId: string,
  input: unknown,
  action: ActionClass,
  scopedAssignmentId?: string,
): AssignmentResolution {
  if (action !== "delegate") return {};
  if (scopedAssignmentId) return { reason: "A child assignment cannot delegate more work" };
  const batch = parseBatchDelegation(input);
  if (batch) return { assignmentInputs: batch.map((item) => item.assignment) };
  const assignment = controller.assignmentForDelegation(sessionId);
  if (!assignment) return { reason: "Create an active, unbound wall-clock assignment before delegation, or provide inline assignments for a batch" };
  return { assignment };
}

function injectAssignmentContext(event: any, controller: WallClockController, sessionId: string, assignment: Assignment): void {
  const context = controller.context(sessionId, assignment.id);
  const input = event?.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const inputObject = input as Record<string, unknown>;
  if (typeof inputObject.context === "string") inputObject.context = `${inputObject.context}\n\n${context}`;
  else inputObject.context = context;
  if (typeof inputObject.task === "string") inputObject.task = `${context}\n\n${inputObject.task}`;
  if (Array.isArray(inputObject.tasks)) {
    inputObject.tasks = inputObject.tasks.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const task = item as Record<string, unknown>;
      return typeof task.task === "string" ? { ...task, task: `${context}\n\n${task.task}` } : task;
    });
  }
}

function injectBatchAssignmentContext(event: any, controller: WallClockController, sessionId: string, assignments: Assignment[]): void {
  const input = event?.input;
  if (!input || typeof input !== "object" || Array.isArray(input) || !Array.isArray(input.tasks)) return;
  input.tasks = input.tasks.map((item: unknown, index: number) => {
    if (!isRecord(item)) return item;
    const assignment = assignments[index];
    if (!assignment || typeof item.task !== "string") return item;
    const cleaned = { ...item };
    delete cleaned.wallClock;
    delete cleaned.wallClockAssignment;
    delete cleaned.id;
    delete cleaned.parentPlanItemId;
    delete cleaned.objective;
    delete cleaned.scope;
    delete cleaned.acceptance;
    delete cleaned.budgetMs;
    delete cleaned.wrapUpMs;
    return { ...cleaned, task: `${controller.context(sessionId, assignment.id)}\n\n${item.task}` };
  });
}

function parseBatchDelegation(input: unknown): Array<{ task: string; assignment: AssignmentInput }> | undefined {
  if (!isRecord(input) || !Array.isArray(input.tasks)) return undefined;
  if (input.tasks.length === 0) throw new Error("Batch delegation requires at least one task");
  return input.tasks.map((item, index) => {
    if (!isRecord(item) || typeof item.task !== "string" || !item.task.trim()) {
      throw new Error(`Batch task ${index + 1} requires a non-empty task`);
    }
    const assignmentSource = isRecord(item.wallClock)
      ? item.wallClock
      : isRecord(item.wallClockAssignment)
        ? item.wallClockAssignment
        : item;
    return { task: item.task, assignment: parseInlineAssignment(assignmentSource, index + 1) };
  });
}

function parseInlineAssignment(input: Record<string, unknown>, index: number): AssignmentInput {
  const parentPlanItemId = requiredString(input.parentPlanItemId, `Batch task ${index} parentPlanItemId`);
  const objective = requiredString(input.objective, `Batch task ${index} objective`);
  const scope = requiredStringArray(input.scope, `Batch task ${index} scope`);
  const acceptance = requiredStringArray(input.acceptance, `Batch task ${index} acceptance`);
  const budgetMs = input.budgetMs;
  if (typeof budgetMs !== "number" || !Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error(`Batch task ${index} budgetMs must be positive`);
  }
  const wrapUpMs = input.wrapUpMs;
  if (wrapUpMs !== undefined && (typeof wrapUpMs !== "number" || !Number.isFinite(wrapUpMs) || wrapUpMs <= 0)) {
    throw new Error(`Batch task ${index} wrapUpMs must be positive`);
  }
  const id = input.id;
  if (id !== undefined && (typeof id !== "string" || !id.trim())) {
    throw new Error(`Batch task ${index} id must not be empty`);
  }
  return { id, parentPlanItemId, objective, scope, acceptance, budgetMs, wrapUpMs };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must contain at least one non-empty string`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deadlineKey(sessionId: string, assignmentId?: string): string {
  return `${encodeURIComponent(sessionId)}:${assignmentId === undefined ? "session" : `assignment:${encodeURIComponent(assignmentId)}`}`;
}

function canonicalActionId(scope: Scope, rawActionId: string | undefined): string | undefined {
  return rawActionId ? JSON.stringify([scope.sessionId, scope.assignmentId ?? null, rawActionId]) : undefined;
}

function assignmentForScope(scope: Scope, requestedAssignmentId?: string): string | undefined {
  if (scope.assignmentId && requestedAssignmentId && requestedAssignmentId !== scope.assignmentId) {
    throw new Error("A child session can only inspect its own assignment");
  }
  return scope.assignmentId ?? requestedAssignmentId;
}

function actionLinkKey(directSessionId: string, rawActionId: string): string {
  return JSON.stringify([directSessionId, rawActionId]);
}

function findActionLink(
  links: Map<string, ActionLink>,
  rawActionId: string,
  preferredDirectSessionId?: string,
  delegateOnly = false,
): [string, ActionLink] | undefined {
  if (preferredDirectSessionId) {
    const key = actionLinkKey(preferredDirectSessionId, rawActionId);
    const exact = links.get(key);
    if (exact && (!delegateOnly || exact.action === "delegate")) return [key, exact];
  }
  const matches = [...links.entries()].filter(([, link]) =>
    link.rawActionId === rawActionId && (!delegateOnly || link.action === "delegate"));
  return matches.length === 1 ? matches[0] : undefined;
}

function existingActionId(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  if ("toolCallId" in event && typeof event.toolCallId === "string" && event.toolCallId.trim()) return event.toolCallId;
  if ("callId" in event && typeof event.callId === "string" && event.callId.trim()) return event.callId;
  if ("id" in event && typeof event.id === "string" && event.id.trim()) return event.id;
  return undefined;
}

function isFastLaneKind(value: unknown): value is FastLaneKind {
  return value === "do-it-now" || value === "wrap-it-up";
}

function parseFastLaneRequest(message: unknown): FastLaneInvocation | null {
  if (!message || typeof message !== "object") return null;
  if ("details" in message && message.details && typeof message.details === "object" && !Array.isArray(message.details)) {
    const details = message.details;
    const kind = "name" in details && isFastLaneKind(details.name) ? details.name : null;
    if (kind) {
      const args = "args" in details ? details.args : undefined;
      return { kind, request: typeof args === "string" ? args.trim() : "" };
    }
  }
  const text = messageText(message);
  const marker = /^\[IMPORTANT: User invoked the "(do-it-now|wrap-it-up)" skill; follow its instructions\. Full skill below\.\]/i.exec(text);
  if (marker) {
    const kind = marker[1]?.toLowerCase();
    const args = /\nUser:\s*([\s\S]*)$/i.exec(text);
    if (kind && isFastLaneKind(kind)) return { kind, request: args ? args[1].trim() : "" };
  }
  const match = /^\s*\/(?:skill:)?(do-it-now|wrap-it-up)(?:\s+([\s\S]*?))?\s*$/i.exec(text);
  if (!match) return null;
  const kind = match[1]?.toLowerCase();
  return kind && isFastLaneKind(kind) ? { kind, request: (match[2] ?? "").trim() } : null;
}

function isTerminalAgentEnd(event: unknown): boolean {
  if (!event || typeof event !== "object" || !("willContinue" in event)) return false;
  return event.willContinue !== true;
}

function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  if ("content" in message) {
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part: unknown) => {
          if (typeof part === "string") return part;
          if (!part || typeof part !== "object" || !("text" in part)) return "";
          return typeof part.text === "string" ? part.text : "";
        })
        .join("");
    }
  }
  if ("prompt" in message && typeof message.prompt === "string") return message.prompt;
  return "text" in message && typeof message.text === "string" ? message.text : "";
}

function parseExpiryPolicy(value: string): ExpiryPolicy {
  if (value === "abort") return "abort-running";
  if (value === "block-new" || value === "abort-running") return value;
  throw new Error("Expiry policy must be block-new or abort-running");
}

function parseWallClockMode(value: string | undefined): WallClockMode {
  if (value === undefined || value === "deadline") return "deadline";
  if (value === "turn-limit") return "turn-limit";
  throw new Error("Wall-clock mode must be deadline or turn-limit");
}

function isExpiryPolicy(value: string | undefined): boolean {
  return value === "block-new" || value === "abort-running" || value === "abort";
}

function notify(ctx: RuntimeContext | undefined, message: string, level = "info"): void {
  ctx?.ui?.notify?.(message, level);
}

function updateStatus(host: RuntimeHost, controller: WallClockController, sessionId: string, ctx?: RuntimeContext, assignmentId?: string): void {
  const status = controller.status(sessionId, assignmentId);
  const mode = status.mode === "turn-limit" ? `, ${status.mode}` : "";
  const value = status.active && status.expiryPolicy
    ? `${status.phase} ${Math.ceil(status.remainingMs / 1_000)}s (${status.expiryPolicy}${mode})`
    : undefined;
  if (ctx?.ui?.setStatus) ctx.ui.setStatus("wall-clock", value);
  else host.setStatus?.("wall-clock", value);
}

function formatStatus(status: { phase: string; remainingMs: number; expiryPolicy?: string; mode?: WallClockMode }): string {
  const mode = status.mode === "turn-limit" ? `, ${status.mode}` : "";
  return `${status.phase}, ${Math.ceil(status.remainingMs / 1_000)}s remaining (${status.expiryPolicy ?? "none"}${mode})`;
}

function textResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function toolInput<T>(args: any[]): T {
  const candidates = args.length > 1 ? [args[1], args[0]] : [args[0]];
  const input = candidates.find((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate));
  if (!input) throw new Error("The host did not provide tool input");
  return input as T;
}

function toolContext(args: any[]): RuntimeContext | undefined {
  return args.find((candidate) => candidate?.sessionManager || candidate?.sessionId || candidate?.abort);
}

const EMPTY_SCHEMA = { type: "object", additionalProperties: false, properties: {} };

const PLAN_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "status"],
  properties: {
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["pending", "active", "complete", "partial", "blocked", "deferred"] },
  },
};
const START_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["deadline", "expiryPolicy"],
  properties: {
    deadline: { type: "string", description: "A positive duration or future local time, for example 30m or 5pm." },
    mode: { type: "string", enum: ["deadline", "turn-limit"] },
    expiryPolicy: { type: "string", enum: ["block-new", "abort-running"] },
    wrapUpMs: { type: "number", exclusiveMinimum: 0 },
    plan: { type: "array", items: PLAN_ITEM_SCHEMA },
  },
};

const SET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["duration"],
  properties: {
    duration: { type: "string", description: "A positive duration, for example 2m." },
  },
};

const STATUS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { assignmentId: { type: "string", minLength: 1 } },
};

const CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["toolName"],
  properties: {
    toolName: { type: "string", minLength: 1 },
    input: {},
    action: { type: "string", enum: ["read", "write", "destructive", "delegate", "finalize", "other"] },
    assignmentId: { type: "string", minLength: 1 },
  },
};

const ASSIGNMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["parentPlanItemId", "objective", "scope", "acceptance", "budgetMs"],
  properties: {
    id: { type: "string", minLength: 1 },
    parentPlanItemId: { type: "string", minLength: 1 },
    objective: { type: "string", minLength: 1 },
    scope: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    acceptance: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    budgetMs: { type: "number", exclusiveMinimum: 0 },
    wrapUpMs: { type: "number", exclusiveMinimum: 0 },
  },
};

const COMPLETE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assignmentId", "status"],
  properties: {
    assignmentId: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["complete", "partial", "blocked", "expired"] },
  },
};

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assignmentId", "status", "completed", "evidence", "partial", "skipped", "validation", "shortcuts", "risks", "unknowns", "recommendedParentAction"],
  properties: {
    assignmentId: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["complete", "partial", "blocked", "expired"] },
    completed: { type: "array", items: { type: "string", minLength: 1 } },
    evidence: { type: "array", items: { type: "string", minLength: 1 } },
    partial: { type: "array", items: { type: "string", minLength: 1 } },
    skipped: { type: "array", items: { type: "string", minLength: 1 } },
    validation: { type: "array", items: { type: "string", minLength: 1 } },
    shortcuts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["choice", "tradeoff"],
        properties: { choice: { type: "string", minLength: 1 }, tradeoff: { type: "string", minLength: 1 } },
      },
    },
    risks: { type: "array", items: { type: "string", minLength: 1 } },
    unknowns: { type: "array", items: { type: "string", minLength: 1 } },
    recommendedParentAction: { type: "string", minLength: 1 },
  },
};


const PLAN_REVISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["plan", "reason"],
  properties: {
    plan: { type: "array", items: PLAN_ITEM_SCHEMA },
    reason: { type: "string", minLength: 1 },
    sourceAssignmentId: { type: "string", minLength: 1 },
  },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
