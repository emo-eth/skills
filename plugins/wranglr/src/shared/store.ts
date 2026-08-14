import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { isRecord } from "./guards.ts";
import {
  identityKey,
  worktreeKey,
} from "./identity.ts";
import type {
  AgentIdentity,
  WranglrState,
  StoredAgent,
  StoredWorktree,
  WorktreeIdentity,
} from "./types.ts";

const STATE_VERSION = 1 as const;

export function defaultState(): WranglrState {
  return {
    version: STATE_VERSION,
    enabled: true,
    mode: "focus",
    ordered_agents: [],
    ordered_worktrees: [],
    snoozed_agents: [],
  };
}

export function stateDirectory(): string {
  return process.env.HERDR_PLUGIN_STATE_DIR
    ?? join(homedir(), ".config", "herdr", "wranglr");
}

export function statePath(): string {
  return join(stateDirectory(), "wranglr.json");
}

export function loadState(): WranglrState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath(), "utf8"));
    return normalizeState(parsed);
  } catch {
    return defaultState();
  }
}

export function saveState(state: WranglrState): void {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

export function normalizeState(value: unknown): WranglrState {
  if (!isRecord(value) || value.version !== STATE_VERSION) return defaultState();
  const ordered_agents = normalizeStoredAgents(value.ordered_agents);
  const ordered_worktrees = normalizeStoredWorktrees(value.ordered_worktrees);
  const snoozed_agents = normalizeStoredAgents(value.snoozed_agents);
  return {
    version: STATE_VERSION,
    enabled: value.enabled !== false,
    mode: value.mode === "modal" ? "modal" : "focus",
    ordered_agents,
    ordered_worktrees,
    snoozed_agents,
  };
}

function normalizeStoredAgents(value: unknown): StoredAgent[] {
  if (!Array.isArray(value)) return [];
  const result: StoredAgent[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const identity = normalizeIdentity(candidate.identity);
    if (!identity) continue;
    const key = identityKey(identity);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = typeof candidate.label === "string" && candidate.label.trim()
      ? candidate.label.trim()
      : undefined;
    result.push(label ? { identity, label } : { identity });
  }
  return result;
}

function normalizeStoredWorktrees(value: unknown): StoredWorktree[] {
  if (!Array.isArray(value)) return [];
  const result: StoredWorktree[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const identity = normalizeWorktreeIdentity(candidate.identity);
    if (!identity) continue;
    const key = worktreeKey(identity);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = typeof candidate.label === "string" && candidate.label.trim()
      ? candidate.label.trim()
      : undefined;
    result.push(label ? { identity, label } : { identity });
  }
  return result;
}

function normalizeIdentity(value: unknown): AgentIdentity | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  if (
    value.kind === "session"
    && typeof value.source === "string"
    && typeof value.agent === "string"
    && (value.sessionKind === "id" || value.sessionKind === "path")
    && typeof value.value === "string"
  ) {
    return {
      kind: "session",
      source: value.source,
      agent: value.agent,
      sessionKind: value.sessionKind,
      value: value.value,
    };
  }
  if (
    value.kind === "pane"
    && typeof value.workspaceId === "string"
    && typeof value.paneId === "string"
  ) {
    return {
      kind: "pane",
      workspaceId: value.workspaceId,
      paneId: value.paneId,
    };
  }
  return undefined;
}

function normalizeWorktreeIdentity(value: unknown): WorktreeIdentity | undefined {
  if (
    isRecord(value)
    && value.kind === "worktree"
    && typeof value.value === "string"
    && value.value.length > 0
  ) {
    return { kind: "worktree", value: value.value };
  }
  return undefined;
}
