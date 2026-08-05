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

export function stateFromEntries(entries: unknown[]): PersistedState | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
    if (entry?.type !== "custom" || entry.customType !== "wall-clock-state") continue;
    if (!isPersistedState(entry.data)) continue;
    return entry.data;
  }
  return undefined;
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<PersistedState>;
  return state.version === 1 && typeof state.sessionId === "string" && Array.isArray(state.assignments) && Array.isArray(state.reports);
}
