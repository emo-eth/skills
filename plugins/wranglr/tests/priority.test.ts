import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseTarget, shouldReclaimFocus } from "../src/herdr/guard-policy.ts";
import {
  addOrMoveToEnd,
  addOrMoveWorktreeToEnd,
  clearResolvedSnoozes,
  identityFor,
  identityKey,
  isRanked,
  isSnoozed,
  moveRank,
  moveWorktreeRank,
  orderedAgents,
  rankOf,
  sameIdentity,
  snoozeAgent,
  unsetRank,
  unsetWorktreeRank,
  urgentAgents,
  worktreeFor,
  worktreeKey,
  worktreeRankOf,
} from "../src/shared/identity.ts";
import { isUrgentStatus, type AgentSnapshot, type WranglrState } from "../src/shared/types.ts";

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    pane_id: "pane-1",
    agent_status: "idle",
    workspace_id: "ws-1",
    tab_id: "tab-1",
    focused: false,
    ...overrides,
  };
}

function state(overrides: Partial<WranglrState> = {}): WranglrState {
  return {
    version: 1,
    enabled: true,
    mode: "focus",
    ordered_agents: [],
    ordered_worktrees: [],
    snoozed_agents: [],
    ...overrides,
  };
}

// Urgent set: idle, blocked, done. Not urgent: working, unknown.
const IDLE = agent({ agent_status: "idle" });
const BLOCKED = agent({ agent_status: "blocked" });
const DONE = agent({ agent_status: "done" });
const WORKING = agent({ agent_status: "working" });
const UNKNOWN = agent({ agent_status: "unknown" });

describe("urgent status classification", () => {
  it("treats idle, blocked, and done as urgent", () => {
    assert.equal(isUrgentStatus("idle"), true);
    assert.equal(isUrgentStatus("blocked"), true);
    assert.equal(isUrgentStatus("done"), true);
  });

  it("treats working and unknown as not urgent", () => {
    assert.equal(isUrgentStatus("working"), false);
    assert.equal(isUrgentStatus("unknown"), false);
  });
});

describe("identity stability", () => {
  it("keeps the same session identity across pane replacements", () => {
    const session = { source: "omp", agent: "main", kind: "id" as const, value: "abc" };
    const before = agent({ pane_id: "pane-A", agent_session: session });
    const after = agent({ pane_id: "pane-B", agent_session: session });
    assert.equal(sameIdentity(identityFor(before), identityFor(after)), true);
    assert.equal(identityKey(identityFor(before)), identityKey(identityFor(after)));
  });

  it("distinguishes session identities with different values", () => {
    const left = agent({
      pane_id: "pane-A",
      agent_session: { source: "omp", agent: "main", kind: "id", value: "one" },
    });
    const right = agent({
      pane_id: "pane-A",
      agent_session: { source: "omp", agent: "main", kind: "id", value: "two" },
    });
    assert.equal(sameIdentity(identityFor(left), identityFor(right)), false);
  });

  it("falls back to pane identity for agents without a session", () => {
    const snap = agent({ pane_id: "pane-9" });
    const id = identityFor(snap);
    assert.equal(id.kind, "pane");
    if (id.kind !== "pane") return;
    assert.equal(id.workspaceId, "ws-1");
    assert.equal(id.paneId, "pane-9");
  });

  it("uses pane identity as the distinguishing fallback for distinct panes", () => {
    const a = agent({ pane_id: "pane-X", workspace_id: "ws-1" });
    const b = agent({ pane_id: "pane-Y", workspace_id: "ws-1" });
    assert.equal(sameIdentity(identityFor(a), identityFor(b)), false);
  });

  it("treats a session agent and a pane-only agent as distinct", () => {
    const withSession = agent({
      pane_id: "pane-A",
      agent_session: { source: "omp", agent: "main", kind: "id", value: "abc" },
    });
    const withoutSession = agent({ pane_id: "pane-A" });
    assert.equal(sameIdentity(identityFor(withSession), identityFor(withoutSession)), false);
  });
});

describe("flat agent rank over worktree rank", () => {
  it("orders by agent rank even when a lower-ranked agent has a better worktree rank", () => {
    // win: agent rank 1, worktree wt-2 (rank 2)
    // runner-up: agent rank 2, worktree wt-1 (rank 1)
    const winner = agent({
      pane_id: "pane-win",
      agent: "win",
      worktree_id: "wt-2",
      agent_status: "idle",
    });
    const runnerUp = agent({
      pane_id: "pane-ru",
      agent: "runner-up",
      worktree_id: "wt-1",
      agent_status: "idle",
    });
    const st = state({
      ordered_agents: [
        { identity: identityFor(winner), label: "win" },
        { identity: identityFor(runnerUp), label: "runner-up" },
      ],
      ordered_worktrees: [
        { identity: { kind: "worktree", value: "wt-1" } },
        { identity: { kind: "worktree", value: "wt-2" } },
      ],
    });

    assert.equal(rankOf(st, winner), 1);
    assert.equal(rankOf(st, runnerUp), 2);
    assert.equal(worktreeRankOf(st, winner), 2);
    assert.equal(worktreeRankOf(st, runnerUp), 1);

    const ordered = orderedAgents(st, [runnerUp, winner]);
    assert.deepEqual(
      ordered.map((a) => a.pane_id),
      ["pane-win", "pane-ru"],
    );

    const decision = chooseTarget(st, [runnerUp, winner]);
    assert.equal(decision.target?.pane_id, "pane-win");
  });
});

describe("worktree fallback ordering", () => {
  it("orders unranked agents by worktree rank", () => {
    const first = agent({ pane_id: "pane-f", agent: "f", worktree_id: "wt-1", agent_status: "blocked" });
    const second = agent({ pane_id: "pane-s", agent: "s", worktree_id: "wt-2", agent_status: "blocked" });
    const st = state({
      ordered_worktrees: [
        { identity: { kind: "worktree", value: "wt-1" } },
        { identity: { kind: "worktree", value: "wt-2" } },
      ],
    });

    assert.equal(rankOf(st, first), undefined);
    assert.equal(worktreeRankOf(st, first), 1);
    assert.equal(worktreeRankOf(st, second), 2);

    const ordered = orderedAgents(st, [second, first]);
    assert.deepEqual(
      ordered.map((a) => a.pane_id),
      ["pane-f", "pane-s"],
    );
  });

  it("ranks an explicitly ranked agent ahead of all worktree-only agents", () => {
    const explicit = agent({ pane_id: "pane-e", agent: "e", worktree_id: "wt-2", agent_status: "idle" });
    const wtOnly = agent({ pane_id: "pane-w", agent: "w", worktree_id: "wt-1", agent_status: "idle" });
    const st = state({
      ordered_agents: [{ identity: identityFor(explicit), label: "e" }],
      ordered_worktrees: [
        { identity: { kind: "worktree", value: "wt-1" } },
        { identity: { kind: "worktree", value: "wt-2" } },
      ],
    });

    const ordered = orderedAgents(st, [wtOnly, explicit]);
    assert.deepEqual(
      ordered.map((a) => a.pane_id),
      ["pane-e", "pane-w"],
    );
  });
});

describe("urgent target selection", () => {
  const topBlocked = agent({ pane_id: "pane-tb", agent: "tb", agent_status: "blocked" });
  const doneAgent = agent({ pane_id: "pane-d", agent: "d", agent_status: "done" });

  function rankedState(): WranglrState {
    return state({
      ordered_agents: [
        { identity: identityFor(topBlocked), label: "tb" },
        { identity: identityFor(doneAgent), label: "d" },
      ],
    });
  }

  it("selects the highest-ranked blocked agent when no current target exists", () => {
    const decision = chooseTarget(rankedState(), [doneAgent, topBlocked]);
    assert.equal(decision.target?.pane_id, "pane-tb");
    assert.equal(decision.reason, "new_urgent_agent");
  });

  it("selects a done agent as urgent target", () => {
    const st = state({
      ordered_agents: [{ identity: identityFor(doneAgent), label: "d" }],
    });
    const decision = chooseTarget(st, [doneAgent]);
    assert.equal(decision.target?.pane_id, "pane-d");
    assert.equal(decision.reason, "new_urgent_agent");
  });

  it("keeps the current target when it is still the winner", () => {
    const decision = chooseTarget(rankedState(), [doneAgent, topBlocked], topBlocked);
    assert.equal(decision.target, topBlocked);
    assert.equal(decision.reason, "current_target");
  });

  it("switches when the highest-ranked urgent agent changes", () => {
    const newTop = agent({ pane_id: "pane-nt", agent: "nt", agent_status: "idle" });
    const st = state({
      ordered_agents: [
        { identity: identityFor(newTop), label: "nt" },
        { identity: identityFor(topBlocked), label: "tb" },
      ],
    });
    const decision = chooseTarget(st, [topBlocked, newTop], topBlocked);
    assert.equal(decision.target?.pane_id, "pane-nt");
    assert.equal(decision.reason, "urgent_agent_changed");
  });

  it("returns nothing when disabled even if urgent agents exist", () => {
    const st = { ...rankedState(), enabled: false };
    assert.deepEqual(chooseTarget(st, [topBlocked]), {});
  });
});

describe("exclusion of unranked targets", () => {
  it("excludes urgent agents that appear in neither agent nor worktree ranks", () => {
    const st = state();
    assert.equal(isRanked(st, IDLE), false);
    assert.deepEqual(urgentAgents(st, [IDLE, BLOCKED]), []);
    assert.deepEqual(chooseTarget(st, [IDLE]), {});
  });

  it("includes an urgent agent that is ranked only via its worktree", () => {
    const st = state({
      ordered_worktrees: [{ identity: { kind: "worktree", value: "wt-1" } }],
    });
    const a = agent({ pane_id: "pane-a", worktree_id: "wt-1", agent_status: "idle" });
    assert.equal(isRanked(st, a), true);
    const urgent = urgentAgents(st, [a]);
    assert.deepEqual(
      urgent.map((u) => u.pane_id),
      ["pane-a"],
    );
  });
});

describe("snooze suppression and clearing", () => {
  const target = agent({ pane_id: "pane-t", agent: "t", agent_status: "idle" });
  const ranked = state({
    ordered_agents: [{ identity: identityFor(target), label: "t" }],
  });

  it("suppresses an urgent snoozed agent from selection", () => {
    const snoozed = snoozeAgent(ranked, target);
    assert.equal(isSnoozed(snoozed, target), true);
    assert.deepEqual(urgentAgents(snoozed, [target]), []);
    assert.deepEqual(chooseTarget(snoozed, [target]), {});
  });

  it("never reclaims focus for a snoozed target even when it would win", () => {
    const snoozed = snoozeAgent(ranked, target);
    assert.equal(shouldReclaimFocus(snoozed, target, [target]), false);
  });

  it("reclaims focus for the winning urgent unsnoozed target", () => {
    assert.equal(shouldReclaimFocus(ranked, target, [target]), true);
  });

  it("does not reclaim focus while not in focus mode", () => {
    const modal = { ...ranked, mode: "modal" as const };
    assert.equal(shouldReclaimFocus(modal, target, [target]), false);
  });

  it("keeps a snoozed agent suppressed while it remains urgent", () => {
    const st = snoozeAgent(ranked, target);
    const afterClear = clearResolvedSnoozes(st, [target]);
    assert.equal(isSnoozed(afterClear, target), true);
  });

  it("clears the snooze once the agent returns to working", () => {
    const st = snoozeAgent(ranked, target);
    const nowWorking = { ...target, agent_status: "working" as const };
    const afterClear = clearResolvedSnoozes(st, [nowWorking]);
    assert.equal(isSnoozed(afterClear, target), false);
  });

  it("snoozing is idempotent", () => {
    const once = snoozeAgent(ranked, target);
    const twice = snoozeAgent(once, target);
    assert.equal(twice, once);
  });
});

describe("rank mutation boundaries", () => {
  function twoAgents() {
    const first = agent({ pane_id: "pane-1", agent: "one" });
    const second = agent({ pane_id: "pane-2", agent: "two" });
    const st = state({
      ordered_agents: [
        { identity: identityFor(first), label: "one" },
        { identity: identityFor(second), label: "two" },
      ],
    });
    return { first, second, st };
  }

  it("refuses to move the first-ranked agent up", () => {
    const { first, st } = twoAgents();
    const moved = moveRank(st, first, -1);
    assert.equal(moved, st);
    assert.equal(rankOf(moved, first), 1);
  });

  it("refuses to move the last-ranked agent down", () => {
    const { second, st } = twoAgents();
    const moved = moveRank(st, second, 1);
    assert.equal(moved, st);
    assert.equal(rankOf(moved, second), 2);
  });

  it("swaps neighboring ranks in either direction", () => {
    const { first, second, st } = twoAgents();
    const moved = moveRank(st, first, 1);
    assert.notEqual(moved, st);
    assert.equal(rankOf(moved, first), 2);
    assert.equal(rankOf(moved, second), 1);

    const undone = moveRank(moved, first, -1);
    assert.equal(rankOf(undone, first), 1);
    assert.equal(rankOf(undone, second), 2);
  });

  it("adds an unlisted agent to the end when moving up with delta -1", () => {
    const fresh = agent({ pane_id: "pane-f", agent: "fresh" });
    const st = state();
    const moved = moveRank(st, fresh, -1);
    assert.deepEqual(moved, addOrMoveToEnd(st, fresh));
    assert.equal(rankOf(moved, fresh), 1);
  });

  it("does nothing when moving an unlisted agent down with delta +1", () => {
    const fresh = agent({ pane_id: "pane-f", agent: "fresh" });
    const st = state();
    assert.equal(moveRank(st, fresh, 1), st);
  });

  it("ranking mutations are the top-level behavior of addOrMoveToEnd and moveRank", () => {
    const a1 = agent({ pane_id: "pane-1", agent: "one" });
    const a2 = agent({ pane_id: "pane-2", agent: "two" });
    const st = state();
    const added = addOrMoveToEnd(st, a1);
    assert.equal(rankOf(added, a1), 1);
    const second = addOrMoveToEnd(added, a2);
    assert.equal(rankOf(second, a1), 1);
    assert.equal(rankOf(second, a2), 2);
  });

  it("unsetRank removes the agent from ordering and snoozes", () => {
    const { first, st } = twoAgents();
    const snoozed = snoozeAgent(st, first);
    const cleared = unsetRank(snoozed, first);
    assert.equal(rankOf(cleared, first), undefined);
    assert.equal(isSnoozed(cleared, first), false);
  });

  it("respects the same boundaries for worktree ranks", () => {
    const a1 = agent({ pane_id: "pane-1", worktree_id: "wt-1" });
    const a2 = agent({ pane_id: "pane-2", worktree_id: "wt-2" });
    const st = state({
      ordered_worktrees: [
        { identity: { kind: "worktree", value: "wt-1" } },
        { identity: { kind: "worktree", value: "wt-2" } },
      ],
    });

    assert.equal(moveWorktreeRank(st, a1, -1), st);
    assert.equal(moveWorktreeRank(st, a2, 1), st);

    const swapped = moveWorktreeRank(st, a1, 1);
    assert.equal(worktreeRankOf(swapped, a1), 2);
    assert.equal(worktreeRankOf(swapped, a2), 1);

    assert.equal(moveWorktreeRank(st, agent({ worktree_id: "wt-new" }), 1), st);

    const added = addOrMoveWorktreeToEnd(st, agent({ worktree_id: "wt-new" }));
    assert.equal(worktreeRankOf(added, agent({ worktree_id: "wt-new" })), 3);

    const unset = unsetWorktreeRank(st, a1);
    assert.equal(worktreeRankOf(unset, a1), undefined);
    assert.equal(worktreeKey(worktreeFor(a2)), "worktree\u001fwt-2");
  });
});