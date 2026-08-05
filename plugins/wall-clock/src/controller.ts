import { formatDurationMs, phaseAt } from "./time.ts";
import { MemoryStore } from "./store.ts";
import type {
  ActionClass,
  Assignment,
  AssignmentInput,
  ChildReport,
  Clock,
  DeadlineInput,
  PersistedState,
  PlanItem,
  SessionState,
  StateStore,
  Status,
  ToolDecision,
  ToolProposal,
} from "./types.ts";

const DEFAULT_WRAP_UP_MS = 5 * 60_000;

export class WallClockController {
  private readonly states = new Map<string, SessionState>();
  private readonly clock: Clock;
  private readonly store: StateStore;

  constructor(clock: Clock = { now: () => Date.now() }, store: StateStore = new MemoryStore()) {
    this.clock = clock;
    this.store = store;
  }

  activate(sessionId: string, input: DeadlineInput, plan: PlanItem[] = []): Status {
    const now = this.clock.now();
    const hardDeadline = input.deadlineMs ?? (input.durationMs === undefined ? undefined : now + input.durationMs);
    if (hardDeadline === undefined || !Number.isFinite(hardDeadline) || hardDeadline <= now) {
      throw new Error("A future deadline or positive duration is required");
    }

    const wrapUpMs = Math.min(input.wrapUpMs ?? DEFAULT_WRAP_UP_MS, Math.max(1_000, hardDeadline - now - 1));
    const state: SessionState = {
      version: 1,
      sessionId,
      issuedAt: now,
      hardDeadline,
      wrapUpAt: hardDeadline - wrapUpMs,
      plan: structuredClone(plan),
      assignments: [],
      reports: [],
      revision: 1,
      stopped: false,
    };
    this.states.set(sessionId, state);
    this.save(state);
    return this.status(sessionId);
  }

  stop(sessionId: string): void {
    const state = this.requireState(sessionId);
    state.stopped = true;
    state.revision += 1;
    this.save(state);
  }

  restore(sessionId: string): Status {
    const persisted = this.store.load(sessionId);
    if (persisted) this.states.set(sessionId, structuredClone(persisted));
    return this.status(sessionId);
  }

  restoreFromState(state: PersistedState): Status {
    this.states.set(state.sessionId, structuredClone(state));
    return this.status(state.sessionId);
  }

  setPlan(sessionId: string, plan: PlanItem[]): void {
    const state = this.requireState(sessionId);
    state.plan = structuredClone(plan);
    state.revision += 1;
    this.save(state);
  }

  assign(sessionId: string, input: AssignmentInput): Assignment {
    const state = this.requireState(sessionId);
    const parentStatus = this.status(sessionId);
    if (!parentStatus.active || parentStatus.phase === "expired" || parentStatus.phase === "complete") {
      throw new Error("Cannot create an assignment outside an active wall-clock window");
    }
    if (!Number.isFinite(input.budgetMs) || input.budgetMs <= 0) throw new Error("Assignment budget must be positive");

    const now = this.clock.now();
    const hardDeadline = Math.min(state.hardDeadline, now + input.budgetMs);
    const wrapUpMs = Math.min(input.wrapUpMs ?? DEFAULT_WRAP_UP_MS, Math.max(1_000, hardDeadline - now - 1));
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
    assignment.childSessionId = childSessionId;
    state.revision += 1;
    this.save(state);
    return structuredClone(assignment);
  }

  complete(sessionId: string, assignmentId: string, status: "complete" | "partial" | "blocked" | "expired"): Assignment {
    const state = this.requireState(sessionId);
    const assignment = this.requireAssignment(state, assignmentId);
    assignment.status = status;
    state.revision += 1;
    this.save(state);
    return structuredClone(assignment);
  }

  report(sessionId: string, report: ChildReport): void {
    const state = this.requireState(sessionId);
    const assignment = this.requireAssignment(state, report.assignmentId);
    assignment.status = report.status;
    const existingIndex = state.reports.findIndex((item) => item.assignmentId === report.assignmentId);
    if (existingIndex === -1) state.reports.push(structuredClone(report));
    else state.reports[existingIndex] = structuredClone(report);
    state.revision += 1;
    this.save(state);
  }

  status(sessionId: string, assignmentId?: string): Status {
    const state = this.states.get(sessionId) ?? this.store.load(sessionId);
    if (!state) return { sessionId, active: false, phase: "inactive", remainingMs: 0 };
    this.states.set(sessionId, state);
    const assignment = assignmentId ? state.assignments.find((item) => item.id === assignmentId) : undefined;
    const hardDeadline = assignment?.hardDeadline ?? state.hardDeadline;
    const wrapUpAt = assignment?.wrapUpAt ?? state.wrapUpAt;
    const complete = state.stopped || assignment?.status === "complete";
    const phase = state.stopped ? "complete" : phaseAt(this.clock.now(), hardDeadline, wrapUpAt, complete);
    return {
      sessionId,
      active: !state.stopped,
      phase,
      remainingMs: Math.max(0, hardDeadline - this.clock.now()),
      deadlineMs: hardDeadline,
      wrapUpAt,
      revision: state.revision,
      assignment: assignment ? structuredClone(assignment) : undefined,
    };
  }

  decideTool(sessionId: string, proposal: ToolProposal): ToolDecision {
    const status = this.status(sessionId, proposal.assignmentId);
    if (!status.active) return { allow: true, phase: status.phase, remainingMs: status.remainingMs };
    if (status.phase === "expired") return this.block(status, "The wall-clock deadline has expired");
    if (status.phase === "complete") return this.block(status, "The assignment is complete");

    const action = proposal.action ?? classifyAction(proposal.toolName, proposal.input);
    if (status.phase === "wrap-up" && (action === "delegate" || action === "destructive")) {
      return this.block(status, `Wrap-up has started; ${action} actions are blocked`);
    }
    if (proposal.estimatedMs !== undefined && proposal.estimatedMs > status.remainingMs && action !== "finalize") {
      return this.block(status, `Estimated work (${formatDurationMs(proposal.estimatedMs)}) does not fit in the remaining ${formatDurationMs(status.remainingMs)}`);
    }
    return { allow: true, phase: status.phase, remainingMs: status.remainingMs };
  }

  context(sessionId: string, assignmentId?: string): string {
    const status = this.status(sessionId, assignmentId);
    if (!status.active) return "Wall-clock control is inactive for this session.";
    const lines = [
      `Wall-clock phase: ${status.phase}.`,
      `Remaining maximum time: ${formatDurationMs(status.remainingMs)}.`,
      "The budget is a ceiling, not a target. Finish as soon as the acceptance target is met.",
      "If you reduce scope or validation, keep the result working and report the shortcut, tradeoff, and skipped work.",
    ];
    if (status.assignment) {
      lines.push(`Assignment ${status.assignment.id}: ${status.assignment.objective}`);
      lines.push(`Acceptance: ${status.assignment.acceptance.join("; ")}`);
    }
    if (status.phase === "wrap-up") lines.push("Do not start delegation or destructive work. Prepare the result and report.");
    if (status.phase === "expired") lines.push("Do not start new tool work. Report the current state.");
    return lines.join("\n");
  }

  snapshot(sessionId: string): PersistedState | undefined {
    const state = this.states.get(sessionId) ?? this.store.load(sessionId);
    return state ? structuredClone(state) : undefined;
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

  private save(state: SessionState): void {
    this.store.save(state);
  }
}

export function classifyAction(toolName: string, input?: unknown): ActionClass {
  const name = toolName.toLowerCase();
  if (name.includes("task") || name.includes("spawn") || name.includes("delegate") || name.includes("assign")) return "delegate";
  if (name.includes("final") || name.includes("report")) return "finalize";
  if (name === "read" || name === "search" || name.includes("list") || name.includes("inspect")) return "read";
  if (name === "write" || name === "edit" || name.includes("patch") || name.includes("create")) return "write";
  if (name === "bash" && /\b(rm|reset|clean|destroy|drop|truncate|push --force)\b/i.test(JSON.stringify(input ?? ""))) return "destructive";
  if (name === "bash") return "other";
  return "other";
}
