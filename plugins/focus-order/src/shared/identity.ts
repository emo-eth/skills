import {
  isUrgentStatus,
  type AgentIdentity,
  type AgentSnapshot,
  type FocusOrderState,
  type StoredAgent,
  type StoredWorktree,
  type WorktreeIdentity,
} from "./types.ts";

export function identityFor(agent: AgentSnapshot): AgentIdentity {
  if (agent.agent_session) {
    return {
      kind: "session",
      source: agent.agent_session.source,
      agent: agent.agent_session.agent,
      sessionKind: agent.agent_session.kind,
      value: agent.agent_session.value,
    };
  }
  return {
    kind: "pane",
    workspaceId: agent.workspace_id,
    paneId: agent.pane_id,
  };
}

export function identityKey(identity: AgentIdentity): string {
  if (identity.kind === "session") {
    return [
      "session",
      identity.source,
      identity.agent,
      identity.sessionKind,
      identity.value,
    ].join("\u001f");
  }
  return ["pane", identity.workspaceId, identity.paneId].join("\u001f");
}

export function sameIdentity(left: AgentIdentity, right: AgentIdentity): boolean {
  return identityKey(left) === identityKey(right);
}

export function worktreeFor(agent: AgentSnapshot): WorktreeIdentity {
  return {
    kind: "worktree",
    value: agent.worktree_id ?? `workspace:${agent.workspace_id}`,
  };
}

export function worktreeKey(identity: WorktreeIdentity): string {
  return `${identity.kind}\u001f${identity.value}`;
}

export function agentLabel(agent: AgentSnapshot): string {
  return agent.display_agent ?? agent.agent ?? agent.name ?? agent.pane_id;
}

export function worktreeLabel(agent: AgentSnapshot): string {
  return (
    agent.worktree_label
    ?? agent.worktree_path
    ?? agent.workspace_label
    ?? agent.worktree_id
    ?? agent.workspace_id
  );
}

export function storedLabel(stored: StoredAgent): string {
  return stored.label ?? (
    stored.identity.kind === "session"
      ? `${stored.identity.agent} ${stored.identity.value}`
      : stored.identity.paneId
  );
}

export function storedWorktreeLabel(stored: StoredWorktree): string {
  return stored.label ?? stored.identity.value;
}

export function rankOf(state: FocusOrderState, agent: AgentSnapshot): number | undefined {
  const key = identityKey(identityFor(agent));
  const index = state.ordered_agents.findIndex((stored) => identityKey(stored.identity) === key);
  return index === -1 ? undefined : index + 1;
}

export function worktreeRankOf(
  state: FocusOrderState,
  agent: AgentSnapshot,
): number | undefined {
  const key = worktreeKey(worktreeFor(agent));
  const index = state.ordered_worktrees.findIndex(
    (stored) => worktreeKey(stored.identity) === key,
  );
  return index === -1 ? undefined : index + 1;
}

export function isRanked(state: FocusOrderState, agent: AgentSnapshot): boolean {
  return rankOf(state, agent) !== undefined || worktreeRankOf(state, agent) !== undefined;
}

export function isSnoozed(state: FocusOrderState, agent: AgentSnapshot): boolean {
  const key = identityKey(identityFor(agent));
  return state.snoozed_agents.some((stored) => identityKey(stored.identity) === key);
}

export function orderedAgents(state: FocusOrderState, agents: AgentSnapshot[]): AgentSnapshot[] {
  return [...agents].sort((left, right) => compareAgents(state, left, right));
}

export function urgentAgents(state: FocusOrderState, agents: AgentSnapshot[]): AgentSnapshot[] {
  return orderedAgents(
    state,
    agents.filter((agent) => isUrgentStatus(agent.agent_status) && !isSnoozed(state, agent)),
  ).filter((agent) => isRanked(state, agent));
}

export function addOrMoveToEnd(state: FocusOrderState, agent: AgentSnapshot): FocusOrderState {
  const identity = identityFor(agent);
  const key = identityKey(identity);
  const ordered_agents = state.ordered_agents.filter(
    (stored) => identityKey(stored.identity) !== key,
  );
  ordered_agents.push({ identity, label: agentLabel(agent) });
  return { ...state, ordered_agents };
}

export function moveRank(
  state: FocusOrderState,
  agent: AgentSnapshot,
  delta: -1 | 1,
): FocusOrderState {
  const identity = identityFor(agent);
  const key = identityKey(identity);
  const index = state.ordered_agents.findIndex(
    (stored) => identityKey(stored.identity) === key,
  );
  if (index === -1) return delta === -1 ? addOrMoveToEnd(state, agent) : state;
  const next = index + delta;
  if (next < 0 || next >= state.ordered_agents.length) return state;
  const ordered_agents = [...state.ordered_agents];
  [ordered_agents[index], ordered_agents[next]] = [ordered_agents[next], ordered_agents[index]];
  return { ...state, ordered_agents };
}

export function unsetRank(state: FocusOrderState, agent: AgentSnapshot): FocusOrderState {
  const key = identityKey(identityFor(agent));
  return {
    ...state,
    ordered_agents: state.ordered_agents.filter(
      (stored) => identityKey(stored.identity) !== key,
    ),
    snoozed_agents: state.snoozed_agents.filter(
      (stored) => identityKey(stored.identity) !== key,
    ),
  };
}

export function addOrMoveWorktreeToEnd(
  state: FocusOrderState,
  agent: AgentSnapshot,
): FocusOrderState {
  const identity = worktreeFor(agent);
  const key = worktreeKey(identity);
  const ordered_worktrees = state.ordered_worktrees.filter(
    (stored) => worktreeKey(stored.identity) !== key,
  );
  ordered_worktrees.push({ identity, label: worktreeLabel(agent) });
  return { ...state, ordered_worktrees };
}

export function moveWorktreeRank(
  state: FocusOrderState,
  agent: AgentSnapshot,
  delta: -1 | 1,
): FocusOrderState {
  const identity = worktreeFor(agent);
  const key = worktreeKey(identity);
  const index = state.ordered_worktrees.findIndex(
    (stored) => worktreeKey(stored.identity) === key,
  );
  if (index === -1) {
    return delta === -1 ? addOrMoveWorktreeToEnd(state, agent) : state;
  }
  const next = index + delta;
  if (next < 0 || next >= state.ordered_worktrees.length) return state;
  const ordered_worktrees = [...state.ordered_worktrees];
  [ordered_worktrees[index], ordered_worktrees[next]] = [
    ordered_worktrees[next],
    ordered_worktrees[index],
  ];
  return { ...state, ordered_worktrees };
}

export function unsetWorktreeRank(
  state: FocusOrderState,
  agent: AgentSnapshot,
): FocusOrderState {
  const key = worktreeKey(worktreeFor(agent));
  return {
    ...state,
    ordered_worktrees: state.ordered_worktrees.filter(
      (stored) => worktreeKey(stored.identity) !== key,
    ),
  };
}

export function snoozeAgent(state: FocusOrderState, agent: AgentSnapshot): FocusOrderState {
  const identity = identityFor(agent);
  const key = identityKey(identity);
  if (state.snoozed_agents.some((stored) => identityKey(stored.identity) === key)) {
    return state;
  }
  return {
    ...state,
    snoozed_agents: [...state.snoozed_agents, { identity, label: agentLabel(agent) }],
  };
}

export function clearResolvedSnoozes(
  state: FocusOrderState,
  agents: AgentSnapshot[],
): FocusOrderState {
  const liveByKey = new Map(agents.map((agent) => [identityKey(identityFor(agent)), agent]));
  const snoozed_agents = state.snoozed_agents.filter((stored) => {
    const agent = liveByKey.get(identityKey(stored.identity));
    return agent === undefined || agent.agent_status !== "working";
  });
  return snoozed_agents.length === state.snoozed_agents.length
    ? state
    : { ...state, snoozed_agents };
}

function compareAgents(
  state: FocusOrderState,
  left: AgentSnapshot,
  right: AgentSnapshot,
): number {
  const leftAgentRank = rankOf(state, left);
  const rightAgentRank = rankOf(state, right);
  if (leftAgentRank !== undefined && rightAgentRank !== undefined) {
    return leftAgentRank - rightAgentRank || agentLabel(left).localeCompare(agentLabel(right));
  }
  if (leftAgentRank !== undefined) return -1;
  if (rightAgentRank !== undefined) return 1;

  const leftWorktreeRank = worktreeRankOf(state, left);
  const rightWorktreeRank = worktreeRankOf(state, right);
  if (leftWorktreeRank !== undefined && rightWorktreeRank !== undefined) {
    return leftWorktreeRank - rightWorktreeRank || agentLabel(left).localeCompare(agentLabel(right));
  }
  if (leftWorktreeRank !== undefined) return -1;
  if (rightWorktreeRank !== undefined) return 1;
  return agentLabel(left).localeCompare(agentLabel(right));
}
