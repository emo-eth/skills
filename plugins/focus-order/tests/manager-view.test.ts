import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { identityFor, identityKey } from "../src/shared/identity.ts";
import { renderManager, type ManagerWorktreeRow } from "../src/herdr/manager-view.ts";
import type { AgentSnapshot, FocusOrderState } from "../src/shared/types.ts";

function state(overrides: Partial<FocusOrderState> = {}): FocusOrderState {
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

function agent(index: number): AgentSnapshot {
  return {
    pane_id: `w${index}:p1`,
    agent: `agent-${index}`,
    agent_status: index % 2 === 0 ? "idle" : "working",
    workspace_id: `workspace-${index}`,
    workspace_label: `project-${index}`,
    tab_id: `w${index}:t1`,
    title: `tab-${index}`,
    focused: index === 0,
    worktree_id: `/checkout/worktree-${index}`,
    worktree_path: `/checkout/worktree-${index}`,
  };
}

function worktreeRow(index: number, currentAgent?: AgentSnapshot): ManagerWorktreeRow {
  return {
    identity: { kind: "worktree", value: `/checkout/worktree-${index}` },
    label: `worktree-${index}`,
    agent: currentAgent,
  };
}

function plain(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

describe("manager view", () => {
  it("renders one titled section at a time with useful agent context", () => {
    const current = agent(0);
    const output = plain(renderManager(
      state(),
      [current],
      [worktreeRow(0, current)],
      { section: "agents", key: identityKey(identityFor(current)) },
      "Ready",
      false,
      { agents: 0, worktrees: 0 },
      24,
    ));
    const lines = output.trimEnd().split("\n");

    assert.ok(lines.length <= 24);
    assert.equal(lines[0], "Guard: ON   Mode: Focus");
    assert.ok(lines.some((line) => line.trim() === "Agents"));
    assert.ok(!lines.some((line) => line.trim() === "Focus Order"));
    assert.match(output, /agent-0/);
    assert.match(output, /project-0/);
    assert.match(output, /worktree-0/);
    assert.match(output, /tab-0/);
    assert.match(output, /pane p1/);
    assert.match(output, /Status: idle = waiting/);
    assert.match(output, /m mode/);
    assert.match(output, /e guard/);
  });

  it("shows the checkout basename as the worktree name", () => {
    const row: ManagerWorktreeRow = {
      identity: { kind: "worktree", value: "/Users/example/focus-mode" },
      label: "/Users/example/focus-mode",
      agent: agent(0),
    };
    const output = plain(renderManager(
      state(),
      [],
      [row],
      { section: "worktrees", key: "worktree\u001f/Users/example/focus-mode" },
      "Ready",
      false,
      { agents: 0, worktrees: 0 },
      24,
    ));
    const rowLine = output.split("\n").find((line) => line.includes("focus-mode"));

    assert.ok(rowLine);
    assert.match(rowLine, /focus-mode\s+\|/);
    assert.match(rowLine, /focus-mode\s+\|\s+project-0\s+\|/);
    assert.doesNotMatch(output, /\/Users\/example\/focus-mode/);
  });

  it("keeps a selected item visible when the list is longer than the popup", () => {
    const agents = Array.from({ length: 20 }, (_, index) => agent(index));
    const selected = agents.at(-1);
    assert.ok(selected);
    const output = renderManager(
      state(),
      agents,
      [],
      { section: "agents", key: identityKey(identityFor(selected)) },
      "Ready",
      false,
      { agents: 0, worktrees: 0 },
      24,
    );

    assert.ok(output.split("\n").length - 1 <= 24);
    assert.match(output, /agent-19/);
    assert.match(output, /more above/);
  });

  it("explains guard, modes, priority, and every manager action", () => {
    const output = plain(renderManager(
      state(),
      [],
      [],
      { section: "agents" },
      "Ready",
      true,
      { agents: 0, worktrees: 0 },
      24,
    ));

    assert.match(output, /Guard is ON/);
    assert.match(output, /Focus moves Herdr focus/);
    assert.match(output, /Modal opens an Attention required popup/);
    assert.match(output, /An explicit agent rank wins/);
    assert.match(output, /u \/ d/);
    assert.match(output, /f               focus/);
    assert.match(output, /e               enable or disable/);
  });
});
