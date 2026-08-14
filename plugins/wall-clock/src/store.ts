import type { PersistedState, StateStore } from "./types.ts";

export class MemoryStore implements StateStore {
  private readonly states = new Map<string, PersistedState>();

  load(sessionId: string): PersistedState | undefined {
    const state = this.states.get(sessionId);
    return state ? structuredClone(state) : undefined;
  }

  save(state: PersistedState): void {
    this.states.set(state.sessionId, structuredClone(state));
  }

  delete(sessionId: string): void {
    this.states.delete(sessionId);
  }
}

export function stateFromEntries(entries: unknown[], sessionId?: string): PersistedState | null | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
    if (entry?.type !== "custom" || entry.customType !== "wall-clock-state") continue;
    if (!isPersistedState(entry.data)) return null;
    if (sessionId !== undefined && entry.data.sessionId !== sessionId) return null;
    return entry.data;
  }
  return undefined;
}

export function isPersistedState(value: unknown): value is PersistedState {
  if (!isObject(value)) return false;
  const state = value;
  if (state.version !== 4
    || !nonEmptyString(state.sessionId)
    || !finiteNumber(state.issuedAt)
    || !finiteNumber(state.hardDeadline)
    || state.hardDeadline <= state.issuedAt
    || !finiteNumber(state.wrapUpAt)
    || state.wrapUpAt < state.issuedAt
    || state.wrapUpAt > state.hardDeadline
    || !wallClockMode(state.mode)
    || !turnStateValid(state.turnState)
    || !optionalPositiveNumber(state.durationMs)
    || (state.mode === "turn-limit" && state.durationMs === undefined)
    || !expiryPolicy(state.expiryPolicy)
    || !finiteNumber(state.revision)
    || !Number.isInteger(state.revision)
    || state.revision < 1
    || typeof state.stopped !== "boolean"
    || !Array.isArray(state.plan)
    || !Array.isArray(state.planRevisions)
    || !Array.isArray(state.assignments)
    || !Array.isArray(state.reports)) return false;
  const plan = state.plan as unknown[];
  const revisions = state.planRevisions as unknown[];
  const assignments = state.assignments as unknown[];
  const reports = state.reports as unknown[];
  if (!plan.every(planItem)
    || !uniqueStrings(plan.map((item) => (item as Record<string, unknown>).id))
    || !revisions.every(planRevision)
    || !assignments.every((item) => assignment(item, state.sessionId as string, state.issuedAt as number, state.hardDeadline as number))
    || !uniqueStrings(assignments.map((item) => (item as Record<string, unknown>).id))
    || !uniqueStrings(assignments.map((item) => (item as Record<string, unknown>).childSessionId).filter((id) => id !== undefined))
    || !reports.every((item) => childReport(item, state.expiryPolicy as string))
    || !uniqueStrings(reports.map((item) => (item as Record<string, unknown>).assignmentId))
    || !reports.every((report) => assignments.some((assignmentValue) => (assignmentValue as Record<string, unknown>).id === (report as Record<string, unknown>).assignmentId))) return false;
  if (!reports.every((reportValue) => {
    const report = reportValue as Record<string, unknown>;
    const matchingAssignment = assignments.find((assignmentValue) => (assignmentValue as Record<string, unknown>).id === report.assignmentId) as Record<string, unknown> | undefined;
    return matchingAssignment !== undefined
      && matchingAssignment.status === report.status
      && finiteNumber(matchingAssignment.completedAt)
      && report.actualElapsedMs === matchingAssignment.completedAt - (matchingAssignment.issuedAt as number)
      && (report.recordedAt as number) >= matchingAssignment.completedAt;
  })) return false;
  if (!revisions.every((revisionValue) => {
    const revision = revisionValue as Record<string, unknown>;
    if ((revision.revision as number) > (state.revision as number)
      || (revision.recordedAt as number) < (state.issuedAt as number)
      || revision.actualElapsedMs !== (revision.recordedAt as number) - (state.issuedAt as number)) return false;
    if (revision.sourceAssignmentId === undefined) {
      return revision.actualAssignmentElapsedMs === undefined && revision.recommendedParentAction === undefined;
    }
    const sourceReport = reports.find((report) => (report as Record<string, unknown>).assignmentId === revision.sourceAssignmentId) as Record<string, unknown> | undefined;
    return sourceReport !== undefined
      && revision.actualAssignmentElapsedMs === sourceReport.actualElapsedMs;
  })) return false;
  return true;
}

function planItem(value: unknown): boolean {
  if (!isObject(value)) return false;
  return nonEmptyString(value.id)
    && nonEmptyString(value.title)
    && (value.status === "pending" || value.status === "active" || value.status === "complete" || value.status === "partial" || value.status === "blocked" || value.status === "deferred");
}

function planRevision(value: unknown): boolean {
  if (!isObject(value)) return false;
  return finiteNumber(value.revision)
    && Number.isInteger(value.revision)
    && finiteNumber(value.recordedAt)
    && stringArray(value.changedPlanItemIds)
    && nonEmptyString(value.reason)
    && nonNegativeNumber(value.actualElapsedMs)
    && optionalString(value.sourceAssignmentId)
    && optionalNonNegativeNumber(value.actualAssignmentElapsedMs)
    && optionalString(value.recommendedParentAction);
}

function assignment(value: unknown, sessionId: string, sessionIssuedAt: number, sessionHardDeadline: number): boolean {
  if (!isObject(value)) return false;
  return nonEmptyString(value.id)
    && nonEmptyString(value.parentPlanItemId)
    && nonEmptyString(value.objective)
    && stringArray(value.scope, false)
    && stringArray(value.acceptance, false)
    && positiveNumber(value.budgetMs)
    && optionalPositiveNumber(value.wrapUpMs)
    && value.parentSessionId === sessionId
    && optionalString(value.childSessionId)
    && finiteNumber(value.issuedAt)
    && value.issuedAt >= sessionIssuedAt
    && finiteNumber(value.hardDeadline)
    && value.hardDeadline > value.issuedAt
    && value.hardDeadline <= sessionHardDeadline
    && finiteNumber(value.wrapUpAt)
    && value.wrapUpAt >= value.issuedAt
    && value.wrapUpAt <= value.hardDeadline
    && (value.status === "active" || value.status === "complete" || value.status === "partial" || value.status === "blocked" || value.status === "expired")
    && (value.completedAt === undefined || (finiteNumber(value.completedAt) && value.completedAt >= value.issuedAt))
    && (value.status === "active" ? value.completedAt === undefined : finiteNumber(value.completedAt));
}

function childReport(value: unknown, sessionExpiryPolicy: string): boolean {
  if (!isObject(value)) return false;
  return nonEmptyString(value.assignmentId)
    && (value.status === "complete" || value.status === "partial" || value.status === "blocked" || value.status === "expired")
    && stringArray(value.completed)
    && stringArray(value.evidence)
    && stringArray(value.partial)
    && stringArray(value.skipped)
    && stringArray(value.validation)
    && Array.isArray(value.shortcuts)
    && value.shortcuts.every((item) => isObject(item) && nonEmptyString(item.choice) && nonEmptyString(item.tradeoff))
    && stringArray(value.risks)
    && stringArray(value.unknowns)
    && nonEmptyString(value.recommendedParentAction)
    && nonNegativeNumber(value.actualElapsedMs)
    && finiteNumber(value.recordedAt)
    && expiryPolicy(value.expiryPolicy)
    && value.expiryPolicy === sessionExpiryPolicy;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): boolean {
  return value === undefined || nonEmptyString(value);
}

function stringArray(value: unknown, emptyAllowed = true): value is string[] {
  return Array.isArray(value) && (emptyAllowed || value.length > 0) && value.every(nonEmptyString);
}

function uniqueStrings(values: unknown[]): boolean {
  return values.every(nonEmptyString) && new Set(values).size === values.length;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveNumber(value: unknown): boolean {
  return finiteNumber(value) && value > 0;
}

function nonNegativeNumber(value: unknown): boolean {
  return finiteNumber(value) && value >= 0;
}

function optionalPositiveNumber(value: unknown): boolean {
  return value === undefined || positiveNumber(value);
}

function optionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined || nonNegativeNumber(value);
}

function expiryPolicy(value: unknown): boolean {
  return value === "block-new" || value === "abort-running";
}

function wallClockMode(value: unknown): boolean {
  return value === "deadline" || value === "turn-limit";
}

function turnStateValid(value: unknown): boolean {
  return value === undefined || value === "armed" || value === "active";
}
