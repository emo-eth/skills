import assert from "node:assert/strict";
import test from "node:test";

import type { AssignedIssue, PluginDeps, WorkspaceInfo } from "../src/capture.ts";
import type { DeskChair } from "../src/desk.ts";
import { parseAssignedIssues, proposeDesk, rank } from "../src/rank.ts";

test("proposeDesk sits high priority, hides low, asks unranked", () => {
  const chairs: DeskChair[] = [
    { workspace_id: "w1", label: "now work", ticket: "EMO-1", path: "/tmp/a", orphans: [] },
    { workspace_id: "w2", label: "later", ticket: "EMO-2", path: "/tmp/b", orphans: [] },
    { workspace_id: "w3", label: "unsorted", ticket: "EMO-3", path: "/tmp/c", orphans: [] },
    { workspace_id: "w4", label: "ghost", orphans: ["no-ticket"] },
  ];
  const issues: AssignedIssue[] = [
    { identifier: "EMO-1", title: "Now", priority: 2 },
    { identifier: "EMO-2", title: "Later", priority: 4 },
    { identifier: "EMO-3", title: "Unsorted" },
    { identifier: "EMO-9", title: "Parked now", priority: 1 },
    { identifier: "EMO-10", title: "Nested now", priority: 1, parent: "EMO-1" },
  ];
  const proposal = proposeDesk(chairs, issues);
  assert.equal(proposal.applied, false);
  assert.equal(proposal.ranker, "tools/prioritize-linear-tickets.ts");
  assert.deepEqual(proposal.sit.map((row) => row.ticket), ["EMO-1"]);
  assert.deepEqual(proposal.hide.map((row) => row.ticket), ["EMO-2"]);
  assert.deepEqual(proposal.ask.map((row) => row.ticket ?? row.label), ["EMO-3", "ghost"]);
  assert.deepEqual(proposal.could_sit.map((row) => row.ticket), ["EMO-9"]);
});

test("rank never closes or removes chairs", async () => {
  const workspaces: WorkspaceInfo[] = [
    { workspace_id: "w1", label: "now", worktree: { checkout_path: "/tmp/now" }, tokens: { ticket: "EMO-1" } },
  ];
  const closed: string[] = [];
  const removed: string[] = [];
  const deps: PluginDeps = {
    async readFile() { return undefined; },
    async writeFile() {},
    async createIssue() { throw new Error("createIssue"); },
    async getWorkspace(id) { return workspaces.find((row) => row.workspace_id === id); },
    async listWorkspaces() { return workspaces; },
    async reportTicket() {},
    async listAgents() { return []; },
    async closeWorkspace(id) { closed.push(id); },
    async removeWorktree(id) { removed.push(id); },
    async gitPorcelain() { return ""; },
    async pathExists() { return true; },
    async viewIssue() { throw new Error("viewIssue"); },
    async listAssignedIssues() {
      return [{ identifier: "EMO-1", title: "Now", priority: 4 }];
    },
  };
  const proposal = await rank(deps);
  assert.deepEqual(proposal.hide.map((row) => row.workspace_id), ["w1"]);
  assert.deepEqual(closed, []);
  assert.deepEqual(removed, []);
});

test("parseAssignedIssues skips completed and keeps Linear priority", () => {
  const issues = parseAssignedIssues({
    data: {
      viewer: {
        assignedIssues: {
          nodes: [
            { identifier: "EMO-1", title: "Now", priority: 2, state: { name: "In Progress", type: "started" } },
            { identifier: "EMO-2", title: "Done", priority: 1, state: { name: "Done", type: "completed" } },
            { identifier: "EMO-3", title: "None", priority: 0, state: { name: "Backlog", type: "backlog" } },
            {
              identifier: "EMO-4",
              title: "Child",
              priority: 1,
              state: { name: "Todo", type: "unstarted" },
              parent: { identifier: "EMO-1" },
            },
          ],
        },
      },
    },
  });
  assert.deepEqual(
    issues.map((issue) => ({ id: issue.identifier, priority: issue.priority, parent: issue.parent })),
    [
      { id: "EMO-1", priority: 2, parent: undefined },
      { id: "EMO-3", priority: undefined, parent: undefined },
      { id: "EMO-4", priority: 1, parent: "EMO-1" },
    ],
  );
});
