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
} from "./types.ts";

const DEFAULT_WRAP_UP_MS = 5 * 60_000;

type RuntimeTiming = {
  inferenceStartedAt?: number;
  latestInferenceElapsedMs: number;
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
    const now = this.clock.now();
    const hardDeadline = input.deadlineMs ?? (input.durationMs === undefined ? undefined : now + input.durationMs);
    if (hardDeadline === undefined || !Number.isFinite(hardDeadline) || hardDeadline <= now) {
      throw new Error("A future deadline or positive duration is required");
    }

    const requestedWrapUpMs = input.wrapUpMs ?? DEFAULT_WRAP_UP_MS;
    if (!Number.isFinite(requestedWrapUpMs) || requestedWrapUpMs <= 0) {
      throw new Error("Wrap-up duration must be positive");
    }
    const wrapUpMs = Math.min(requestedWrapUpMs, Math.max(1_000, hardDeadline - now - 1));
    const state: SessionState = {
      version: 2,
      sessionId,
      issuedAt: now,
      hardDeadline,
      wrapUpAt: hardDeadline - wrapUpMs,
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

  stop(sessionId: string): void {
    const state = this.requireState(sessionId);
    state.stopped = true;
    state.revision += 1;
    this.timings.delete(sessionId);
    this.save(state);
  }

  restore(sessionId: string): Status {
    const persisted = this.store.load(sessionId);
    if (persisted && persisted.sessionId === sessionId && isPersistedState(persisted)) {
      this.states.set(sessionId, structuredClone(persisted));
      this.timings.set(sessionId, freshRuntimeTiming());
    }
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

  setPlan(sessionId: string, plan: PlanItem[], reason: string): PlanRevision {
    const state = this.requireState(sessionId);
    if (!reason.trim()) throw new Error("A plan revision reason is required");
    const now = this.clock.now();
    const changedPlanItemIds = changedPlanItems(state.plan, plan);
    state.plan = structuredClone(plan);
    state.revision += 1;
    const revision: PlanRevision = {
      revision: state.revision,
      recordedAt: now,
      changedPlanItemIds,
      reason,
      actualElapsedMs: Math.max(0, now - state.issuedAt),
    };
    state.planRevisions.push(revision);
    this.save(state);
    return structuredClone(revision);
  }

  assign(sessionId: string, input: AssignmentInput): Assignment {
    const state = this.requireState(sessionId);
    const parentStatus = this.status(sessionId);
    if (!parentStatus.active || parentStatus.phase !== "active") {
      throw new Error("Cannot create an assignment outside the active wall-clock phase");
    }
    if (!Number.isFinite(input.budgetMs) || input.budgetMs <= 0) throw new Error("Assignment budget must be positive");
    if (!input.objective.trim()) throw new Error("Assignment objective is required");
    if (input.scope.length === 0) throw new Error("Assignment scope must not be empty");
    if (input.acceptance.length === 0) throw new Error("Assignment acceptance target must not be empty");

    const now = this.clock.now();
    const hardDeadline = Math.min(state.hardDeadline, now + input.budgetMs);
    const requestedWrapUpMs = input.wrapUpMs ?? DEFAULT_WRAP_UP_MS;
    if (!Number.isFinite(requestedWrapUpMs) || requestedWrapUpMs <= 0) {
      throw new Error("Assignment wrap-up duration must be positive");
    }
    const wrapUpMs = Math.min(requestedWrapUpMs, Math.max(1_000, hardDeadline - now - 1));
    const assignment: Assignment = {
      ...structuredClone(input),
      id: input.id ?? `assignment-${state.assignments.length + 1}`,
      parentSessionId: sessionId,
      issuedAt: now,
      hardDeadline,
      wrapUpAt: hardDeadline - wrapUpMs,
      status: "active",
    };
    state.assignments.push(assignment);
    state.revision += 1;
    this.save(state);
    return structuredClone(assignment);
  }

  attachChild(sessionId: string, assignmentId: string, childSessionId: string): Assignment {
    const state = this.requireState(sessionId);
    const assignment = this.requireAssignment(state, assignmentId);
    if (!childSessionId.trim()) throw new Error("Child session identifier is required");
    assignment.childSessionId = childSessionId;
    state.revision += 1;
    this.save(state);
    return structuredClone(assignment);
  }

  complete(sessionId: string, assignmentId: string, status: "complete" | "partial" | "blocked" | "expired"): Assignment {
    const state = this.requireState(sessionId);
    const assignment = this.requireAssignment(state, assignmentId);
    assignment.status = status;
    assignment.completedAt ??= this.clock.now();
    state.revision += 1;
    this.save(state);
    return structuredClone(assignment);
  }

  report(sessionId: string, input: ChildReportInput): ChildReport {
    const state = this.requireState(sessionId);
    const assignment = this.requireAssignment(state, input.assignmentId);
    const now = this.clock.now();
    assignment.status = input.status;
    assignment.completedAt ??= now;
    const report: ChildReport = {
      ...structuredClone(input),
      actualElapsedMs: Math.max(0, (assignment.completedAt ?? now) - assignment.issuedAt),
      recordedAt: now,
    };
    const existingIndex = state.reports.findIndex((item) => item.assignmentId === report.assignmentId);
    if (existingIndex === -1) state.reports.push(report);
    else state.reports[existingIndex] = report;
    state.revision += 1;
    this.save(state);
    return structuredClone(report);
  }

  status(sessionId: string, assignmentId?: string): Status {
    const state = this.states.get(sessionId) ?? this.store.load(sessionId);
    if (!state) return { sessionId, active: false, phase: "inactive", remainingMs: 0 };
    this.states.set(sessionId, state);
    const assignment = assignmentId ? state.assignments.find((item) => item.id === assignmentId) : undefined;
    if (assignmentId && !assignment) throw new Error(`Unknown assignment: ${assignmentId}`);
    const now = this.clock.now();
    const hardDeadline = assignment?.hardDeadline ?? state.hardDeadline;
    const wrapUpAt = assignment?.wrapUpAt ?? state.wrapUpAt;
    const complete = state.stopped || assignment?.status === "complete";
    const phase = state.stopped ? "complete" : phaseAt(now, hardDeadline, wrapUpAt, complete);
    const active = !state.stopped;
    const context = active ? this.elapsedContext(state, assignment, phase, now) : undefined;
    return {
      sessionId,
      active,
      phase,
      remainingMs: Math.max(0, hardDeadline - now),
      deadlineMs: hardDeadline,
      wrapUpAt,
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
    if (status.phase === "expired" && !controlAction && action !== "finalize") {
      return this.block(status, "The wall-clock deadline has expired; no new work may start");
    }
    if (status.phase === "complete" && !controlAction && action !== "finalize") {
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
    const state = this.states.get(sessionId) ?? this.store.load(sessionId);
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
    const lines = [
      "Wall-clock context (measured by the host):",
      `Current time: ${new Date(context.currentTimeMs).toISOString()} (${context.currentTimeMs}ms).`,
      `Total elapsed: ${formatDurationMs(context.totalElapsedMs)} (${context.totalElapsedMs}ms).`,
      `Latest inference elapsed: ${formatDurationMs(context.latestInferenceElapsedMs)} (${context.latestInferenceElapsedMs}ms).`,
      `Latest tool-call elapsed: ${formatDurationMs(context.latestToolCallElapsedMs)} (${context.latestToolCallElapsedMs}ms).`,
      `Remaining time: ${formatDurationMs(context.remainingMs)} (${context.remainingMs}ms).`,
      `Phase: ${context.phase}. Expiry policy: ${context.expiryPolicy}.`,
      `Assignment elapsed: ${formatDurationMs(context.assignmentElapsedMs)} (${context.assignmentElapsedMs}ms).`,
      "The budget is a ceiling, not a target. Finish as soon as the acceptance target is met.",
      "If you reduce scope or validation, keep the result working and report the shortcut, tradeoff, and skipped work.",
    ];
    if (status.assignment) {
      lines.push(`Assignment ${status.assignment.id}: ${status.assignment.objective}`);
      lines.push(`Acceptance: ${status.assignment.acceptance.join("; ")}`);
    }
    if (status.phase === "wrap-up") lines.push("Do not start delegation or destructive work. Prepare the result and report.");
    if (status.phase === "expired") {
      lines.push("Do not start new tool work. Report the current state.");
      if (context.expiryPolicy === "block-new") lines.push("Already-admitted work may finish; do not claim it was cancelled.");
      else lines.push("The host is aborting already-admitted wall-clock-owned work and must observe the result.");
    }
    return lines.join("\n");
  }

  snapshot(sessionId: string): PersistedState | undefined {
    const state = this.states.get(sessionId) ?? this.store.load(sessionId);
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
      remainingMs: Math.max(0, (assignment?.hardDeadline ?? state.hardDeadline) - now),
      phase,
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
    const state = this.states.get(sessionId) ?? this.store.load(sessionId);
    if (!state) throw new Error(`No active wall-clock state for session ${sessionId}`);
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

export function isWallClockControlTool(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "wallclock_start"
    || name === "wallclock_status"
    || name === "wallclock_stop"
    || name === "wallclock_context"
    || name === "wallclock_check"
    || name === "wallclock_complete"
    || name === "wallclock_report"
    || name === "wallclock_revise_plan";
}

function freshRuntimeTiming(): RuntimeTiming {
  return { latestInferenceElapsedMs: 0, toolStartedAt: new Map(), activeActions: new Map() };
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
