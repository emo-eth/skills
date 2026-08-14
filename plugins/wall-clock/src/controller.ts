import { formatDurationMs, phaseAt } from "./time.ts";
import { isPersistedState, MemoryStore } from "./store.ts";
import type {
  ActionClass,
  ActivationInput,
  Assignment,
  AssignmentInput,
  ChildReport,
  ChildReportInput,
  Clock,
  ElapsedTimeContext,
  ExpiryPolicy,
  PersistedState,
  PlanItem,
  PlanRevision,
  RunningAction,
  SessionState,
  StateStore,
  Status,
  ToolDecision,
  ToolProposal,
  WallClockMode,
} from "./types.ts";

const DEFAULT_WRAP_UP_MS = 5 * 60_000;

type RuntimeTiming = {
  inferenceStartedAt?: number;
  latestInferenceElapsedMs: number;
  latestToolCallElapsedMs: number;
  toolStartedAt: Map<string, number>;
  activeActions: Map<string, RunningAction>;
};

export class WallClockController {
  private readonly states = new Map<string, SessionState>();
  private readonly timings = new Map<string, RuntimeTiming>();
  private readonly clock: Clock;
  private readonly store: StateStore;

  constructor(clock: Clock = { now: () => Date.now() }, store: StateStore = new MemoryStore()) {
    this.clock = clock;
    this.store = store;
  }

  activate(sessionId: string, input: ActivationInput, plan: PlanItem[] = []): Status {
    requireSessionId(sessionId);
    requireExpiryPolicy(input.expiryPolicy);
    const mode = input.mode ?? "deadline";
    requireMode(mode);
    const turnState = input.turnState ?? "active";
    if (turnState !== "armed" && turnState !== "active") {
      throw new Error("turnState must be armed or active");
    }
    if (turnState === "armed" && mode !== "turn-limit") {
      throw new Error("Armed turn state requires turn-limit mode");
    }
    if (mode === "turn-limit" && input.durationMs === undefined) {
      throw new Error("The turn-limit mode requires a positive duration");
    }
    if (input.durationMs !== undefined) requireDuration(input.durationMs);
    if (mode === "turn-limit" && input.deadlineMs !== undefined) {
      throw new Error("The turn-limit mode requires a duration, not a local-time deadline");
    }
    requireValidPlan(plan);
    const now = this.clock.now();
    const hardDeadline = input.deadlineMs ?? (input.durationMs === undefined ? undefined : now + input.durationMs);
    if (hardDeadline === undefined || !Number.isFinite(hardDeadline) || hardDeadline <= now) {
      throw new Error("A future deadline or positive duration is required");
    }

    const availableMs = hardDeadline - now;
    const requestedWrapUpMs = input.wrapUpMs ?? Math.min(DEFAULT_WRAP_UP_MS, availableMs / 5);
    if (!Number.isFinite(requestedWrapUpMs) || requestedWrapUpMs <= 0) {
      throw new Error("Wrap-up duration must be positive");
    }
    const wrapUpMs = Math.min(requestedWrapUpMs, availableMs);
    const state: SessionState = {
      version: 4,
      sessionId,
      issuedAt: now,
      hardDeadline,
      wrapUpAt: hardDeadline - wrapUpMs,
      mode,
      turnState,
      durationMs: input.durationMs,
      expiryPolicy: input.expiryPolicy,
      plan: structuredClone(plan),
      planRevisions: [],
      assignments: [],
      reports: [],
      revision: 1,
      stopped: false,
    };
    this.states.set(sessionId, state);
    this.timings.set(sessionId, freshRuntimeTiming());
    this.save(state);
    return this.status(sessionId);
  }

  setDuration(sessionId: string, durationMs: number, at = this.clock.now()): Status {
    const state = this.requireState(sessionId);
    if (state.stopped) throw new Error("Wall-clock is not active for this session");
    requireDuration(durationMs);
    if (!Number.isFinite(at)) throw new Error("A finite update time is required");
    if (state.turnState === "armed") {
      // While armed, only the configured duration changes; deadlines are recomputed when a turn starts.
      state.durationMs = durationMs;
      state.revision += 1;
      this.save(state);
      return this.status(sessionId);
    }
    const hardDeadline = at + durationMs;
    const assignment = state.assignments.find((item) => item.hardDeadline > hardDeadline);
    if (assignment) {
      throw new Error(`Duration cannot end before assignment ${assignment.id}`);
    }
    const wrapUpMs = resizeWrapUp(state, durationMs);
    state.durationMs = durationMs;
    state.hardDeadline = hardDeadline;
    state.wrapUpAt = hardDeadline - wrapUpMs;
    state.revision += 1;
    this.save(state);
    return this.status(sessionId);
  }

  resetTurn(sessionId: string, at = this.clock.now()): Status {
    const state = this.requireState(sessionId);
    if (state.stopped) throw new Error("Wall-clock is not active for this session");
    if (state.mode !== "turn-limit") return this.status(sessionId);
    if (state.durationMs === undefined) throw new Error("The turn-limit mode has no configured duration");
    if (!Number.isFinite(at)) throw new Error("A finite turn reset time is required");
    const hardDeadline = at + state.durationMs;
    const wrapUpMs = resizeWrapUp(state, state.durationMs);
    state.turnState = "active";
    state.hardDeadline = hardDeadline;
    state.wrapUpAt = hardDeadline - wrapUpMs;
    state.revision += 1;
    this.save(state);
    return this.status(sessionId);
  }

  armTurn(sessionId: string, at = this.clock.now()): Status {
    const state = this.requireState(sessionId);
    if (state.stopped) throw new Error("Wall-clock is not active for this session");
    if (state.mode !== "turn-limit") throw new Error("armTurn is only valid in turn-limit mode");
    if (!Number.isFinite(at)) throw new Error("A finite arm time is required");
    state.turnState = "armed";
    state.revision += 1;
    this.save(state);
    return this.status(sessionId);
  }

  stop(sessionId: string): void {
    const state = this.requireState(sessionId);
    state.stopped = true;
    state.revision += 1;
    this.timings.delete(sessionId);
    this.save(state);
  }

  discard(sessionId: string): void {
    this.states.delete(sessionId);
    this.timings.delete(sessionId);
    this.store.delete(sessionId);
  }

  restore(sessionId: string): Status {
    this.states.delete(sessionId);
    this.timings.delete(sessionId);
    if (this.loadState(sessionId)) this.timings.set(sessionId, freshRuntimeTiming());
    return this.status(sessionId);
  }

  restoreFromState(state: PersistedState, expectedSessionId?: string): Status {
    if (!isPersistedState(state)) throw new Error("Invalid wall-clock state");
    if (expectedSessionId !== undefined && state.sessionId !== expectedSessionId) {
      throw new Error("Wall-clock state belongs to another session");
    }
    this.states.set(state.sessionId, structuredClone(state));
    this.timings.set(state.sessionId, freshRuntimeTiming());
    return this.status(state.sessionId);
  }

  setPlan(sessionId: string, plan: PlanItem[], reason: string, sourceAssignmentId?: string): PlanRevision {
    const state = this.requireState(sessionId);
    if (!reason.trim()) throw new Error("A plan revision reason is required");
    requireValidPlan(plan);
    const now = this.clock.now();
    const sourceReport = sourceAssignmentId === undefined
      ? undefined
      : state.reports.find((report) => report.assignmentId === sourceAssignmentId);
    if (sourceAssignmentId !== undefined && !sourceReport) {
      throw new Error(`No report exists for assignment ${sourceAssignmentId}`);
    }
    const changedPlanItemIds = changedPlanItems(state.plan, plan);
    state.plan = structuredClone(plan);
    state.revision += 1;
    const revision: PlanRevision = {
      revision: state.revision,
      recordedAt: now,
      changedPlanItemIds,
      reason,
      actualElapsedMs: Math.max(0, now - state.issuedAt),
      sourceAssignmentId,
      actualAssignmentElapsedMs: sourceReport?.actualElapsedMs,
      recommendedParentAction: sourceReport?.recommendedParentAction,
    };
    state.planRevisions.push(revision);
    this.save(state);
    return structuredClone(revision);
  }

  assign(sessionId: string, input: AssignmentInput): Assignment {
    return this.assignBatch(sessionId, [input])[0]!;
  }

  assignBatch(sessionId: string, inputs: AssignmentInput[]): Assignment[] {
    const state = this.requireState(sessionId);
    const parentStatus = this.status(sessionId);
    if (!parentStatus.active || parentStatus.phase !== "active") {
      throw new Error("Cannot create an assignment outside the active wall-clock phase");
    }
    if (inputs.length === 0) throw new Error("At least one assignment is required");

    const now = this.clock.now();
    const reservedIds = new Set(state.assignments.map((assignment) => assignment.id));
    const assignments = inputs.map((input) => {
      if (!Number.isFinite(input.budgetMs) || input.budgetMs <= 0) throw new Error("Assignment budget must be positive");
      if (!input.objective.trim()) throw new Error("Assignment objective is required");
      if (!input.parentPlanItemId.trim()) throw new Error("A parent plan item identifier is required");
      if (state.plan.length > 0 && !state.plan.some((item) => item.id === input.parentPlanItemId)) {
        throw new Error(`Parent plan item ${input.parentPlanItemId} does not exist in the current plan`);
      }
      requireNonEmptyStringArray(input.scope, "Assignment scope");
      requireNonEmptyStringArray(input.acceptance, "Assignment acceptance target");
      if (input.id !== undefined && !input.id.trim()) throw new Error("Assignment identifier must not be empty");
      const assignmentId = input.id ?? nextAssignmentId(state, reservedIds);
      if (reservedIds.has(assignmentId)) {
        throw new Error(`Assignment ${assignmentId} already exists`);
      }
      reservedIds.add(assignmentId);

      const hardDeadline = Math.min(state.hardDeadline, now + input.budgetMs);
      const availableMs = hardDeadline - now;
      const requestedWrapUpMs = input.wrapUpMs ?? Math.min(DEFAULT_WRAP_UP_MS, availableMs / 5);
      if (!Number.isFinite(requestedWrapUpMs) || requestedWrapUpMs <= 0) {
        throw new Error("Assignment wrap-up duration must be positive");
      }
      const wrapUpMs = Math.min(requestedWrapUpMs, availableMs);
      return {
        ...structuredClone(input),
        id: assignmentId,
        parentSessionId: sessionId,
        issuedAt: now,
        hardDeadline,
        wrapUpAt: hardDeadline - wrapUpMs,
        status: "active" as const,
      };
    });

    state.assignments.push(...assignments);
    state.revision += assignments.length;
    this.save(state);
    return structuredClone(assignments);
  }

  attachChild(sessionId: string, assignmentId: string, childSessionId: string): Assignment {
    const state = this.requireState(sessionId);
    const assignment = this.requireAssignment(state, assignmentId);
    if (!childSessionId.trim()) throw new Error("Child session identifier is required");
    const existingAssignment = state.assignments.find((item) => item.id !== assignmentId && item.childSessionId === childSessionId);
    if (existingAssignment) {
      throw new Error(`Child ${childSessionId} is already bound to assignment ${existingAssignment.id}`);
    }
    if (assignment.childSessionId === childSessionId) return structuredClone(assignment);
    if (assignment.childSessionId !== undefined) {
      throw new Error(`Assignment ${assignmentId} is already bound to child ${assignment.childSessionId}`);
    }
    assignment.childSessionId = childSessionId;
    state.revision += 1;
    this.save(state);
    return structuredClone(assignment);
  }

  complete(sessionId: string, assignmentId: string, status: "complete" | "partial" | "blocked" | "expired"): Assignment {
    const state = this.requireState(sessionId);
    const assignment = this.requireAssignment(state, assignmentId);
    requireTerminalAssignmentStatus(status);
    const existingReport = state.reports.find((report) => report.assignmentId === assignmentId);
    if (existingReport && existingReport.status !== status) {
      throw new Error(`Assignment ${assignmentId} already has a ${existingReport.status} report; replace the report to change its status`);
    }
    assignment.status = status;
    assignment.completedAt ??= this.clock.now();
    state.revision += 1;
    this.save(state);
    return structuredClone(assignment);
  }

  report(sessionId: string, input: ChildReportInput): ChildReport {
    const state = this.requireState(sessionId);
    const assignment = this.requireAssignment(state, input.assignmentId);
    requireValidReport(input);
    const now = this.clock.now();
    assignment.status = input.status;
    assignment.completedAt ??= now;
    const report: ChildReport = {
      ...structuredClone(input),
      actualElapsedMs: Math.max(0, (assignment.completedAt ?? now) - assignment.issuedAt),
      recordedAt: now,
      expiryPolicy: state.expiryPolicy,
    };
    const existingIndex = state.reports.findIndex((item) => item.assignmentId === report.assignmentId);
    if (existingIndex === -1) state.reports.push(report);
    else state.reports[existingIndex] = report;
    state.revision += 1;
    this.save(state);
    return structuredClone(report);
  }

  status(sessionId: string, assignmentId?: string): Status {
    const state = this.loadState(sessionId);
    if (!state) return { sessionId, active: false, phase: "inactive", remainingMs: 0 };
    const assignment = assignmentId ? state.assignments.find((item) => item.id === assignmentId) : undefined;
    if (assignmentId && !assignment) throw new Error(`Unknown assignment: ${assignmentId}`);
    const now = this.clock.now();
    const hardDeadline = assignment?.hardDeadline ?? state.hardDeadline;
    const wrapUpAt = assignment?.wrapUpAt ?? state.wrapUpAt;
    const complete = state.stopped || (assignment !== undefined && assignment.status !== "active");
    const phase: Status["phase"] = state.stopped ? "complete" : (state.turnState === "armed" ? "armed" : phaseAt(now, hardDeadline, wrapUpAt, complete));
    const active = !state.stopped;
    const armed = phase === "armed";
    const context = active ? this.elapsedContext(state, assignment, phase, now) : undefined;
    return {
      sessionId,
      active,
      phase,
      remainingMs: armed ? 0 : Math.max(0, hardDeadline - now),
      ...(armed ? {} : { deadlineMs: hardDeadline, wrapUpAt }),
      mode: state.mode,
      turnState: state.turnState,
      durationMs: state.durationMs,
      expiryPolicy: state.expiryPolicy,
      revision: state.revision,
      assignmentElapsedMs: assignment ? this.assignmentElapsedMs(assignment, now) : undefined,
      context,
      assignment: assignment ? structuredClone(assignment) : undefined,
    };
  }

  decideTool(sessionId: string, proposal: ToolProposal): ToolDecision {
    const status = this.status(sessionId, proposal.assignmentId);
    const action = proposal.action ?? classifyAction(proposal.toolName, proposal.input);
    const controlAction = isWallClockControlTool(proposal.toolName);
    if (!status.active) return { allow: true, phase: status.phase, remainingMs: status.remainingMs };
    if (status.phase === "armed") return { allow: true, phase: status.phase, remainingMs: status.remainingMs };
    if (status.phase === "expired" && !controlAction) {
      return this.block(status, "The wall-clock deadline has expired; no new work may start");
    }
    if (status.phase === "complete" && !controlAction) {
      return this.block(status, "The assignment is complete; no new assignment work may start");
    }
    if (status.phase === "wrap-up" && (action === "delegate" || action === "destructive")) {
      return this.block(status, `Wrap-up has started; ${action} actions are blocked`);
    }
    if (proposal.enforceable && status.expiryPolicy === "abort-running" && !controlAction && action !== "finalize" && !proposal.actionId) {
      return this.block(status, "Abort-running requires a host action identifier before execution");
    }
    return { allow: true, phase: status.phase, remainingMs: status.remainingMs };
  }

  beginInference(sessionId: string, at = this.clock.now()): void {
    this.runtimeTiming(sessionId).inferenceStartedAt = at;
  }

  endInference(sessionId: string, at = this.clock.now()): void {
    const timing = this.runtimeTiming(sessionId);
    if (timing.inferenceStartedAt === undefined) return;
    timing.latestInferenceElapsedMs = Math.max(0, at - timing.inferenceStartedAt);
    timing.inferenceStartedAt = undefined;
  }

  beginToolCall(sessionId: string, actionId: string, at = this.clock.now()): void {
    this.runtimeTiming(sessionId).toolStartedAt.set(actionId, at);
  }

  startAction(sessionId: string, actionId: string, toolName: string, action: ActionClass, assignmentId?: string, at = this.clock.now()): void {
    const timing = this.runtimeTiming(sessionId);
    timing.activeActions.set(actionId, {
      actionId,
      toolName,
      action,
      assignmentId,
      startedAt: timing.toolStartedAt.get(actionId) ?? at,
    });
  }

  endAction(sessionId: string, actionId: string, at = this.clock.now(), abortObserved = false): RunningAction | undefined {
    const timing = this.runtimeTiming(sessionId);
    const action = timing.activeActions.get(actionId);
    const startedAt = timing.toolStartedAt.get(actionId) ?? action?.startedAt;
    if (startedAt !== undefined) timing.latestToolCallElapsedMs = Math.max(0, at - startedAt);
    timing.toolStartedAt.delete(actionId);
    if (!action) return undefined;
    timing.activeActions.delete(actionId);
    if (abortObserved) action.abortObservedAt = at;
    return structuredClone(action);
  }

  runningActions(sessionId: string): RunningAction[] {
    return [...this.runtimeTiming(sessionId).activeActions.values()].map((action) => structuredClone(action));
  }

  requestAbort(sessionId: string, actionId: string, at = this.clock.now()): RunningAction | undefined {
    const action = this.runtimeTiming(sessionId).activeActions.get(actionId);
    if (!action) return undefined;
    action.abortRequestedAt ??= at;
    return structuredClone(action);
  }

  markAbortObserved(sessionId: string, actionId: string, at = this.clock.now()): RunningAction | undefined {
    const action = this.runtimeTiming(sessionId).activeActions.get(actionId);
    if (!action) return undefined;
    action.abortObservedAt = at;
    return structuredClone(action);
  }

  assignmentForDelegation(sessionId: string): Assignment | undefined {
    const state = this.loadState(sessionId);
    if (!state) return undefined;
    const unbound = state.assignments.filter((assignment) => assignment.status === "active" && !assignment.childSessionId);
    return unbound.length === 1 ? structuredClone(unbound[0]) : undefined;
  }

  turnContext(sessionId: string, assignmentId?: string): ElapsedTimeContext | undefined {
    const status = this.status(sessionId, assignmentId);
    return status.context;
  }

  context(sessionId: string, assignmentId?: string): string {
    const status = this.status(sessionId, assignmentId);
    if (!status.active || !status.context) return "Wall-clock control is inactive for this session.";
    const context = status.context;
    const armed = status.phase === "armed";
    const decision = armed
      ? "Decision: no timed work is running; do not treat this turn as budgeted."
      : status.phase === "expired"
        ? "Decision: do not propose more work. Report the current result and stop."
        : status.phase === "wrap-up"
          ? "Decision: finish the current narrow task. Do not expand scope, delegate, or start destructive work."
          : "Decision: work only on the current acceptance target. Do not expand scope or delegate unless it clearly shortens that target.";
    const lines = [
      "<wallclock>",
      "This block is injected by the host, not written by the user.",
      armed
        ? "Timer armed: no timer runs until the next normal user turn."
        : `${formatDurationMs(context.remainingMs)} remaining · phase ${context.phase} · mode ${context.mode} · policy ${context.expiryPolicy}`,
      context.mode === "turn-limit"
        ? armed
          ? `Configured turn duration: ${formatDurationMs(status.durationMs ?? 0)}.`
          : "The next timer starts at the next normal user turn. Steer messages keep the current deadline. "
            + `Configured turn duration: ${formatDurationMs(status.durationMs ?? 0)}.`
        : undefined,
      decision,
      context.expiryPolicy === "block-new" && !armed
        ? "At expiry, the host blocks new work; an active model request may continue."
        : undefined,
      "Budget is a ceiling: finish as soon as the acceptance target is met.",
      "If you reduce scope or validation, keep the result working and report the shortcut, tradeoff, and skipped work.",
    ].filter((line): line is string => line !== undefined);
    if (status.assignment) {
      lines.push(`Assignment ${status.assignment.id}: ${status.assignment.objective}`);
      lines.push(`Acceptance: ${status.assignment.acceptance.join("; ")}`);
    }
    lines.push("</wallclock>");
    return lines.join("\n");
  }

  snapshot(sessionId: string): PersistedState | undefined {
    const state = this.loadState(sessionId);
    return state ? structuredClone(state) : undefined;
  }

  private elapsedContext(state: SessionState, assignment: Assignment | undefined, phase: Status["phase"], now: number): ElapsedTimeContext {
    const timing = this.runtimeTiming(state.sessionId);
    return {
      sessionId: state.sessionId,
      assignmentId: assignment?.id,
      currentTimeMs: now,
      totalElapsedMs: Math.max(0, now - state.issuedAt),
      latestInferenceElapsedMs: timing.latestInferenceElapsedMs,
      latestToolCallElapsedMs: timing.latestToolCallElapsedMs,
      remainingMs: phase === "armed" ? 0 : Math.max(0, (assignment?.hardDeadline ?? state.hardDeadline) - now),
      phase,
      mode: state.mode,
      assignmentElapsedMs: assignment ? this.assignmentElapsedMs(assignment, now) : 0,
      expiryPolicy: state.expiryPolicy,
    };
  }

  private assignmentElapsedMs(assignment: Assignment, now: number): number {
    return Math.max(0, (assignment.completedAt ?? now) - assignment.issuedAt);
  }

  private block(status: Status, reason: string): ToolDecision {
    return { allow: false, phase: status.phase, remainingMs: status.remainingMs, reason };
  }

  private requireState(sessionId: string): SessionState {
    const state = this.loadState(sessionId);
    if (!state) throw new Error(`No active wall-clock state for session ${sessionId}`);
    return state;
  }

  private loadState(sessionId: string): SessionState | undefined {
    const inMemory = this.states.get(sessionId);
    if (inMemory) return inMemory;
    const persisted = this.store.load(sessionId);
    if (!persisted) return undefined;
    if (persisted.sessionId !== sessionId || !isPersistedState(persisted)) {
      this.store.delete(sessionId);
      return undefined;
    }
    const state = structuredClone(persisted);
    this.states.set(sessionId, state);
    return state;
  }

  private requireAssignment(state: SessionState, assignmentId: string): Assignment {
    const assignment = state.assignments.find((item) => item.id === assignmentId);
    if (!assignment) throw new Error(`Unknown assignment: ${assignmentId}`);
    return assignment;
  }

  private runtimeTiming(sessionId: string): RuntimeTiming {
    let timing = this.timings.get(sessionId);
    if (!timing) {
      timing = freshRuntimeTiming();
      this.timings.set(sessionId, timing);
    }
    return timing;
  }

  private save(state: SessionState): void {
    this.store.save(state);
  }
}

export function classifyAction(toolName: string, input?: unknown): ActionClass {
  const name = toolName.toLowerCase();
  if (name.includes("task") || name.includes("spawn") || name.includes("delegate") || name.includes("assign")) return "delegate";
  if (name.includes("final") || name.includes("report") || name.includes("complete") || name.includes("status") || name.includes("context") || name.includes("check")) return "finalize";
  if (name === "read" || name === "search" || name.includes("list") || name.includes("inspect")) return "read";
  if (name === "write" || name === "edit" || name.includes("patch") || name.includes("create") || name.includes("update")) return "write";
  if ((name === "bash" || name.includes("shell") || name.includes("command")) && /\b(rm|reset|clean|destroy|drop|truncate|push\s+--force|checkout\s+--)\b/i.test(JSON.stringify(input ?? ""))) return "destructive";
  if (name === "bash" || name.includes("shell") || name.includes("command")) return "other";
  return "other";
}


function freshRuntimeTiming(): RuntimeTiming {
  return { latestInferenceElapsedMs: 0, latestToolCallElapsedMs: 0, toolStartedAt: new Map(), activeActions: new Map() };
}
export function isWallClockControlTool(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "wallclock_start"
    || name === "wallclock_set"
    || name === "wallclock_status"
    || name === "wallclock_stop"
    || name === "wallclock_context"
    || name === "wallclock_check"
    || name === "wallclock_complete"
    || name === "wallclock_report"
    || name === "wallclock_revise_plan";
}
function changedPlanItems(previous: PlanItem[], next: PlanItem[]): string[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));
  const ids = new Set([...previousById.keys(), ...nextById.keys()]);
  return [...ids].filter((id) => JSON.stringify(previousById.get(id)) !== JSON.stringify(nextById.get(id))).sort();
}

function requireSessionId(sessionId: string): void {
  if (!sessionId.trim()) throw new Error("A stable session identifier is required");
}

function requireExpiryPolicy(policy: string): asserts policy is ExpiryPolicy {
  if (policy !== "block-new" && policy !== "abort-running") {
    throw new Error("Expiry policy must be block-new or abort-running");
  }
}

function requireValidPlan(plan: PlanItem[]): void {
  const ids = new Set<string>();
  for (const item of plan) {
    if (!item.id.trim()) throw new Error("A plan item identifier must not be empty");
    if (!item.title.trim()) throw new Error(`Plan item ${item.id} title must not be empty`);
    if (item.status !== "pending" && item.status !== "active" && item.status !== "complete" && item.status !== "partial" && item.status !== "blocked" && item.status !== "deferred") {
      throw new Error(`Plan item ${item.id} status is invalid`);
    }
    if (ids.has(item.id)) throw new Error("Plan item identifiers must be unique");
    ids.add(item.id);
  }
}
function requireMode(mode: string): asserts mode is WallClockMode {
  if (mode !== "deadline" && mode !== "turn-limit") {
    throw new Error("Wall-clock mode must be deadline or turn-limit");
  }
}

function requireDuration(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("Duration must be positive");
  }
}

/**
 * Scale the current wrap-up band to a new duration so a shorter
 * configured turn never starts already inside wrap-up. The band is
 * preserved as a fraction of the old duration; states without a
 * known duration keep the absolute band, clamped to the new duration.
 */
function resizeWrapUp(state: SessionState, newDurationMs: number): number {
  const oldBand = (state.hardDeadline ?? 0) - (state.wrapUpAt ?? 0);
  const oldDuration = state.durationMs;
  let wrapUpMs: number;
  if (oldDuration !== undefined && oldDuration > 0 && Number.isFinite(oldBand) && oldBand >= 0) {
    wrapUpMs = Math.round((oldBand / oldDuration) * newDurationMs);
  } else {
    wrapUpMs = oldBand;
  }
  return Math.min(Math.max(1, wrapUpMs), newDurationMs);
}

function requireValidReport(input: ChildReportInput): void {
  requireTerminalAssignmentStatus(input.status);
  for (const [label, values] of [
    ["completed", input.completed],
    ["evidence", input.evidence],
    ["partial", input.partial],
    ["skipped", input.skipped],
    ["validation", input.validation],
    ["risks", input.risks],
    ["unknowns", input.unknowns],
  ] as const) requireStringArray(values, `Report ${label}`);
  for (const shortcut of input.shortcuts) {
    if (!shortcut.choice.trim()) throw new Error("Report shortcut choice must not be empty");
    if (!shortcut.tradeoff.trim()) throw new Error("Report shortcut tradeoff must not be empty");
  }
  if (!input.recommendedParentAction.trim()) throw new Error("A recommended parent action is required");
}

function requireTerminalAssignmentStatus(status: string): asserts status is "complete" | "partial" | "blocked" | "expired" {
  if (status !== "complete" && status !== "partial" && status !== "blocked" && status !== "expired") {
    throw new Error("Assignment status is invalid");
  }
}

function requireNonEmptyStringArray(values: string[], label: string): void {
  if (values.length === 0) throw new Error(`${label} must not be empty`);
  requireStringArray(values, label);
}

function requireStringArray(values: string[], label: string): void {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error(`${label} entries must not be empty`);
  }
}

function nextAssignmentId(state: SessionState, reservedIds = new Set(state.assignments.map((assignment) => assignment.id))): string {
  let sequence = 1;
  while (reservedIds.has(`assignment-${sequence}`)) sequence += 1;
  return `assignment-${sequence}`;
}
