import {
  identityFor,
  identityKey,
  isSnoozed,
  urgentAgents,
} from "../shared/identity.ts";
import { isUrgentStatus, type AgentSnapshot, type FocusOrderState } from "../shared/types.ts";

export type FocusDecision = {
  target?: AgentSnapshot;
  reason?: "new_urgent_agent" | "urgent_agent_changed" | "current_target";
};

export function chooseTarget(
  state: FocusOrderState,
  agents: AgentSnapshot[],
  currentTarget?: AgentSnapshot,
): FocusDecision {
  if (!state.enabled) return {};
  const urgent = urgentAgents(state, agents);
  if (urgent.length === 0) return {};
  const winner = urgent[0];
  if (
    currentTarget
    && identityKey(identityFor(currentTarget)) === identityKey(identityFor(winner))
  ) {
    return { target: currentTarget, reason: "current_target" };
  }
  return {
    target: winner,
    reason: currentTarget ? "urgent_agent_changed" : "new_urgent_agent",
  };
}

export function shouldReclaimFocus(
  state: FocusOrderState,
  target: AgentSnapshot,
  agents: AgentSnapshot[],
): boolean {
  if (!state.enabled || state.mode !== "focus") return false;
  if (isSnoozed(state, target) || !isUrgentStatus(target.agent_status)) return false;
  const winner = urgentAgents(state, agents)[0];
  return winner !== undefined
    && identityKey(identityFor(winner)) === identityKey(identityFor(target));
}
