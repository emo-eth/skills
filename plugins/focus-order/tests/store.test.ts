import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultState, normalizeState } from "../src/shared/store.ts";
import type { AgentIdentity, FocusOrderState } from "../src/shared/types.ts";

function session(overrides: Partial<Extract<AgentIdentity, { kind: "session" }>> = {}): AgentIdentity {
  return {
    kind: "session",
    source: "omp",
    agent: "main",
    sessionKind: "id",
    value: "abc",
    ...overrides,
  };
}

function pane(workspaceId: string, paneId: string): AgentIdentity {
  return { kind: "pane", workspaceId, paneId };
}

const WORKTREE = { kind: "worktree" as const, value: "wt-1" };

describe("normalizeState defaults on invalid input", () => {
  it("returns defaultState when the value is not a record", () => {
    for (const bad of [undefined, null, "junk", 42, [], true]) {
      assert.deepEqual(normalizeState(bad), defaultState());
    }
  });

  it("returns defaultState when the version is missing or wrong", () => {
    assert.deepEqual(normalizeState({ enabled: false }), defaultState());
    assert.deepEqual(normalizeState({ version: 0 }), defaultState());
    assert.deepEqual(normalizeState({ version: 2, enabled: false, mode: "modal" }), defaultState());
  });

  it("normalizes a valid minimal record to defaultState", () => {
    assert.deepEqual(
      normalizeState({
        version: 1,
        enabled: true,
        mode: "focus",
        ordered_agents: [],
        ordered_worktrees: [],
        snoozed_agents: [],
      }),
      defaultState(),
    );
  });
});

describe("mode and enabled normalization", () => {
  it("defaults enabled to true when absent, and preserves an explicit false", () => {
    assert.equal(normalizeState({ version: 1 }).enabled, true);
    assert.equal(normalizeState({ version: 1, enabled: false }).enabled, false);
    assert.equal(normalizeState({ version: 1, enabled: true }).enabled, true);
  });

  it("treats any value other than literal false as enabled", () => {
    // The exported contract is `value.enabled !== false`: even truthy-adjacent
    // non-booleans such as null or 0 do not disable. This pins that behavior.
    assert.equal(normalizeState({ version: 1, enabled: null }).enabled, true);
    assert.equal(normalizeState({ version: 1, enabled: 0 }).enabled, true);
    assert.equal(normalizeState({ version: 1, enabled: "false" }).enabled, true);
  });

  it("maps mode to modal only for the exact string 'modal'", () => {
    assert.equal(normalizeState({ version: 1, mode: "modal" }).mode, "modal");
    assert.equal(normalizeState({ version: 1, mode: "focus" }).mode, "focus");
    assert.equal(normalizeState({ version: 1 }).mode, "focus");
    assert.equal(normalizeState({ version: 1, mode: "bogus" }).mode, "focus");
  });
});

describe("missing arrays default to empty", () => {
  const base = { version: 1, enabled: true, mode: "focus" } as const;

  it("fills every ordered and snoozed list with empty arrays when absent", () => {
    const st = normalizeState(base);
    assert.deepEqual(st.ordered_agents, []);
    assert.deepEqual(st.ordered_worktrees, []);
    assert.deepEqual(st.snoozed_agents, []);
  });

  it("treats non-array fields as empty lists", () => {
    const st = normalizeState({ ...base, ordered_agents: "nope", ordered_worktrees: 3, snoozed_agents: {} });
    assert.deepEqual(st.ordered_agents, []);
    assert.deepEqual(st.ordered_worktrees, []);
    assert.deepEqual(st.snoozed_agents, []);
  });
});

describe("stored agent identity filtering", () => {
  const good = session({ value: "good" });

  it("drops entries with malformed identities", () => {
    const st = normalizeState({
      version: 1,
      ordered_agents: [
        { identity: good },
        { identity: { kind: "session", source: "omp", agent: "main", sessionKind: "wrong", value: "x" } },
        { identity: { kind: "session", source: "omp", agent: "main", sessionKind: "id", value: 7 } },
        { identity: { kind: "pane", workspaceId: 1, paneId: "p" } },
        { identity: { kind: "nope", whatever: true } },
        { identity: null },
        null,
        "stringy",
      ],
    });
    assert.deepEqual(st.ordered_agents, [{ identity: good }]);
  });

  it("drops duplicate identities within a list, keeping the first occurrence", () => {
    const st = normalizeState({
      version: 1,
      ordered_agents: [
        { identity: session({ value: "dup" }), label: "first" },
        { identity: session({ value: "dup" }), label: "second" },
      ],
    });
    assert.deepEqual(st.ordered_agents, [{ identity: session({ value: "dup" }), label: "first" }]);
  });

  it("dedupes pane identities by workspace and pane id", () => {
    const st = normalizeState({
      version: 1,
      ordered_agents: [
        { identity: pane("ws-1", "pane-a") },
        { identity: pane("ws-1", "pane-b") },
        { identity: pane("ws-1", "pane-a") },
      ],
    });
    assert.deepEqual(st.ordered_agents, [
      { identity: pane("ws-1", "pane-a") },
      { identity: pane("ws-1", "pane-b") },
    ]);
  });

  it("keeps session and pane identities with the same value as distinct", () => {
    // identityKey prefixes the kind, so a session and pane are never conflated.
    const st = normalizeState({
      version: 1,
      ordered_agents: [
        { identity: session({ value: "x" }) },
        { identity: pane("ws-1", "x") },
        { identity: { ...session({ value: "x" }), sessionKind: "path" } },
      ],
    });
    assert.deepEqual(st.ordered_agents, [
      { identity: session({ value: "x" }) },
      { identity: pane("ws-1", "x") },
      { identity: session({ value: "x", sessionKind: "path" }) },
    ]);
  });
});

describe("stored worktree identity filtering", () => {
  it("drops malformed identities and dedupes by value", () => {
    const st = normalizeState({
      version: 1,
      ordered_worktrees: [
        { identity: WORKTREE },
        { identity: { kind: "worktree" } },
        { identity: { kind: "worktree", value: "" } },
        { identity: { kind: "worktree", value: 5 } },
        { identity: { kind: "other", value: "wt-9" } },
        { identity: WORKTREE },
      ],
    });
    assert.deepEqual(st.ordered_worktrees, [{ identity: WORKTREE }]);
  });

  it("keeps worktrees with distinct values", () => {
    const st = normalizeState({
      version: 1,
      ordered_worktrees: [
        { identity: { kind: "worktree", value: "wt-1" } },
        { identity: { kind: "worktree", value: "wt-2" } },
      ],
    });
    assert.deepEqual(st.ordered_worktrees, [
      { identity: { kind: "worktree", value: "wt-1" } },
      { identity: { kind: "worktree", value: "wt-2" } },
    ]);
  });
});

describe("label normalization", () => {
  it("trims whitespace from string labels", () => {
    const st = normalizeState({
      version: 1,
      ordered_agents: [{ identity: session({ value: "a" }), label: "  spaced  " }],
    });
    assert.deepEqual(st.ordered_agents[0], { identity: session({ value: "a" }), label: "spaced" });
  });

  it("omits labels that are empty, whitespace-only, or not strings", () => {
    const st = normalizeState({
      version: 1,
      ordered_agents: [
        { identity: session({ value: "a" }), label: "   " },
        { identity: session({ value: "b" }), label: "" },
        { identity: session({ value: "c" }), label: 7 },
        { identity: pane("ws-1", "pane-d"), label: "kept" },
        { identity: pane("ws-1", "pane-e") },
      ],
    });
    assert.deepEqual(st.ordered_agents, [
      { identity: session({ value: "a" }) },
      { identity: session({ value: "b" }) },
      { identity: session({ value: "c" }) },
      { identity: pane("ws-1", "pane-d"), label: "kept" },
      { identity: pane("ws-1", "pane-e") },
    ]);
  });

  it("applies the same label rules to worktrees", () => {
    const st = normalizeState({
      version: 1,
      ordered_worktrees: [
        { identity: { kind: "worktree", value: "wt-1" }, label: "  tree  " },
        { identity: { kind: "worktree", value: "wt-2" }, label: "" },
      ],
    });
    assert.deepEqual(st.ordered_worktrees, [
      { identity: { kind: "worktree", value: "wt-1" }, label: "tree" },
      { identity: { kind: "worktree", value: "wt-2" } },
    ]);
  });
});

describe("ranked and snoozed overlap preservation", () => {
  it("keeps a snoozed agent in snoozed_agents even when it is also ranked", () => {
    const shared = session({ value: "overlap" });
    const st = normalizeState({
      version: 1,
      ordered_agents: [{ identity: shared, label: "ranked" }],
      ordered_worktrees: [{ identity: WORKTREE }],
      snoozed_agents: [{ identity: shared, label: "snoozed" }],
    });
    assert.deepEqual(st.ordered_agents, [{ identity: shared, label: "ranked" }]);
    assert.deepEqual(st.ordered_worktrees, [{ identity: WORKTREE }]);
    assert.deepEqual(st.snoozed_agents, [{ identity: shared, label: "snoozed" }]);
  });

  it("dedupes within each list independently without merging across lists", () => {
    const shared = session({ value: "dup" });
    const st = normalizeState({
      version: 1,
      ordered_agents: [{ identity: shared }, { identity: shared }],
      snoozed_agents: [{ identity: shared }, { identity: shared }],
    });
    assert.deepEqual(st.ordered_agents, [{ identity: shared }]);
    assert.deepEqual(st.snoozed_agents, [{ identity: shared }]);
  });
});

describe("normalized state is serializable and idempotent", () => {
  function roundtrip(st: FocusOrderState): FocusOrderState {
    return normalizeState(JSON.parse(JSON.stringify(st)));
  }

  it("survives JSON serialization and re-normalization unchanged", () => {
    const normalized = normalizeState({
      version: 1,
      enabled: false,
      mode: "modal",
      ordered_agents: [
        { identity: session({ value: "a" }), label: "  A  " },
        { identity: session({ value: "a" }) },
        { identity: pane("ws-1", "pane-b") },
        null,
      ],
      ordered_worktrees: [{ identity: { kind: "worktree", value: "wt-1" } }, "bad"],
      snoozed_agents: [{ identity: session({ value: "a" }) }, { identity: pane("ws-1", "pane-b") }],
    });

    // A normalized state has no functions, undefined, or class instances: it
    // serializes to stable JSON and normalizes again to the same value.
    assert.deepEqual(roundtrip(normalized), normalized);
    assert.deepEqual(roundtrip(roundtrip(normalized)), normalized);
  });

  it("is stable across an arbitrary number of passes", () => {
    const st = normalizeState(defaultState());
    assert.deepEqual(st, defaultState());
    for (let i = 0; i < 5; i += 1) {
      const again = roundtrip(st) as FocusOrderState;
      assert.deepEqual(again, st);
    }
  });
});