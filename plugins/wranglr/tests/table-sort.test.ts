import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SORT,
  SORT_CYCLE,
  nextSortKey,
  sortAgents,
  sortValue,
} from "../src/herdr/table-sort.ts";
import { orderedAgents, rankOf } from "../src/shared/identity.ts";
import type { AgentSnapshot, WranglrState } from "../src/shared/types.ts";

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

// Give each agent a distinct label so tie-breaks never mask the column value.
const alice = agent({ pane_id: "p1", workspace_id: "ws-1", agent: "alice", agent_status: "idle", worktree_id: "wt-a", worktree_label: "omega" });
const bob = agent({ pane_id: "p2", workspace_id: "ws-2", agent: "bob", agent_status: "working", worktree_id: "wt-b", worktree_label: "alpha" });
const carol = agent({ pane_id: "p3", workspace_id: "ws-3", agent: "carol", agent_status: "blocked", worktree_id: "wt-c", worktree_label: "beta" });

describe("sortValue", () => {
  it("maps each non-rank column to a stable string", () => {
    assert.equal(sortValue(bob, "status"), "working");
    assert.equal(sortValue(bob, "agent"), "bob");
    assert.equal(sortValue(bob, "project"), "ws-2");
    assert.equal(sortValue(bob, "worktree"), "alpha");
  });

  it("falls back project to workspace_id and worktree to workspace_id when labels are absent", () => {
    const bare = agent({ pane_id: "p9", workspace_id: "ws-9", worktree_id: "wt-9" });
    assert.equal(sortValue(bare, "project"), "ws-9");
    assert.equal(sortValue(bare, "worktree"), "wt-9");
  });
});

describe("nextSortKey cycle", () => {
  it("cycles rank -> status -> agent -> project -> worktree -> rank", () => {
    assert.equal(SORT_CYCLE.length, 5);
    assert.equal(nextSortKey("rank"), "status");
    assert.equal(nextSortKey("status"), "agent");
    assert.equal(nextSortKey("agent"), "project");
    assert.equal(nextSortKey("project"), "worktree");
    assert.equal(nextSortKey("worktree"), "rank");
  });
});

describe("sortAgents by column", () => {
  const st = state();

  it("sorts agents ascending by status", () => {
    const sorted = sortAgents(st, [alice, bob, carol], { key: "status", dir: 1 });
    const labels = sorted.map((a) => a.agent);
    // blocked < idle < working alphabetically
    assert.deepEqual(labels, ["carol", "alice", "bob"]);
  });

  it("sorts agents descending by status (reverse)", () => {
    const sorted = sortAgents(st, [alice, bob, carol], { key: "status", dir: -1 });
    const labels = sorted.map((a) => a.agent);
    assert.deepEqual(labels, ["bob", "alice", "carol"]);
  });

  it("sorts agents by agent label ascending and descending", () => {
    assert.deepEqual(
      sortAgents(st, [carol, alice, bob], { key: "agent", dir: 1 }).map((a) => a.agent),
      ["alice", "bob", "carol"],
    );
    assert.deepEqual(
      sortAgents(st, [carol, alice, bob], { key: "agent", dir: -1 }).map((a) => a.agent),
      ["carol", "bob", "alice"],
    );
  });

  it("sorts agents by project ascending and descending", () => {
    assert.deepEqual(
      sortAgents(st, [alice, carol, bob], { key: "project", dir: 1 }).map((a) => a.workspace_id),
      ["ws-1", "ws-2", "ws-3"],
    );
    assert.deepEqual(
      sortAgents(st, [alice, carol, bob], { key: "project", dir: -1 }).map((a) => a.workspace_id),
      ["ws-3", "ws-2", "ws-1"],
    );
  });

  it("sorts agents by worktree label ascending and descending", () => {
    assert.deepEqual(
      sortAgents(st, [alice, carol, bob], { key: "worktree", dir: 1 }).map((a) => a.worktree_label),
      ["alpha", "beta", "omega"],
    );
    assert.deepEqual(
      sortAgents(st, [alice, carol, bob], { key: "worktree", dir: -1 }).map((a) => a.worktree_label),
      ["omega", "beta", "alpha"],
    );
  });
});

describe("sortAgents default rank order", () => {
  const rankedState = state({
    ordered_agents: [
      { identity: { kind: "pane", workspaceId: "ws-2", paneId: "p2" }, label: "bob" },
      { identity: { kind: "pane", workspaceId: "ws-3", paneId: "p3" }, label: "carol" },
      { identity: { kind: "pane", workspaceId: "ws-1", paneId: "p1" }, label: "alice" },
    ],
  });

  it("default (rank, asc) reproduces the existing priority order exactly", () => {
    const viaSort = sortAgents(rankedState, [alice, bob, carol], DEFAULT_SORT);
    const viaRank = orderedAgents(rankedState, [alice, bob, carol]);
    assert.deepEqual(viaSort, viaRank);
    assert.deepEqual(viaSort.map((a) => a.agent), ["bob", "carol", "alice"]);
  });

  it("rank descending reverses the priority order", () => {
    const sorted = sortAgents(rankedState, [alice, bob, carol], { key: "rank", dir: -1 });
    assert.deepEqual(sorted.map((a) => a.agent), ["alice", "carol", "bob"]);
  });

  it("rank uses rankOf positions for comparison", () => {
    assert.equal(rankOf(rankedState, bob), 1);
    assert.equal(rankOf(rankedState, carol), 2);
    assert.equal(rankOf(rankedState, alice), 3);
  });
});
