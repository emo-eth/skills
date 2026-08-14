import { agentLabel, orderedAgents } from "../shared/identity.ts";
import type { AgentSnapshot, WranglrState } from "../shared/types.ts";

export type SortKey = "rank" | "status" | "agent" | "project" | "worktree";
export type SortState = {
  key: SortKey;
  dir: 1 | -1;
};

export const DEFAULT_SORT: SortState = { key: "rank", dir: 1 };

// Order the `t` key cycles through; rank is the default/priority order.
export const SORT_CYCLE: readonly SortKey[] = [
  "rank",
  "status",
  "agent",
  "project",
  "worktree",
];

export function nextSortKey(key: SortKey): SortKey {
  const index = SORT_CYCLE.indexOf(key);
  return SORT_CYCLE[(index + 1) % SORT_CYCLE.length];
}

export function sortValue(agent: AgentSnapshot, key: Exclude<SortKey, "rank">): string {
  switch (key) {
    case "status":
      return agent.agent_status;
    case "agent":
      return agentLabel(agent);
    case "project":
      return agent.workspace_label ?? agent.workspace_id ?? "";
    case "worktree":
      return (
        agent.worktree_label
        ?? agent.worktree_path
        ?? agent.worktree_id
        ?? agent.workspace_id
        ?? ""
      );
  }
}

function compareForSort(
  left: AgentSnapshot,
  right: AgentSnapshot,
  key: Exclude<SortKey, "rank">,
): number {
  return sortValue(left, key).localeCompare(sortValue(right, key));
}

// Returns the agent rows in the order the table should display them.
// The default sort (rank, ascending) reproduces the existing priority order exactly.
// The selected row's identity is preserved by callers: they key on identity, not index.
export function sortAgents(
  state: WranglrState,
  agents: AgentSnapshot[],
  sort: SortState,
): AgentSnapshot[] {
  const key = sort.key;
  const dir = sort.dir;
  if (key === "rank") {
    const ordered = orderedAgents(state, agents);
    return dir === 1 ? ordered : [...ordered].reverse();
  }
  return [...agents].sort((left, right) => {
    const cmp = compareForSort(left, right, key);
    return (cmp * dir) || agentLabel(left).localeCompare(agentLabel(right));
  });
}
