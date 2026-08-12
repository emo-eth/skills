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
}

export function stateFromEntries(entries: unknown[], sessionId?: string): PersistedState | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
    if (entry?.type !== "custom" || entry.customType !== "wall-clock-state") continue;
    if (!isPersistedState(entry.data)) continue;
    if (sessionId !== undefined && entry.data.sessionId !== sessionId) continue;
    return entry.data;
  }
  return undefined;
}

export function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return state.version === 2
    && typeof state.sessionId === "string"
    && state.sessionId.length > 0
    && typeof state.issuedAt === "number"
    && Number.isFinite(state.issuedAt)
    && typeof state.hardDeadline === "number"
    && Number.isFinite(state.hardDeadline)
    && typeof state.wrapUpAt === "number"
    && Number.isFinite(state.wrapUpAt)
    && (state.expiryPolicy === "block-new" || state.expiryPolicy === "abort-running")
    && Array.isArray(state.plan)
    && Array.isArray(state.planRevisions)
    && Array.isArray(state.assignments)
    && Array.isArray(state.reports)
    && typeof state.revision === "number"
    && Number.isFinite(state.revision)
    && typeof state.stopped === "boolean";
}
