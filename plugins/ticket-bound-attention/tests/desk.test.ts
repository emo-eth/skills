import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentRow, PluginDeps, WorkspaceInfo } from "../src/capture.ts";
import { desk } from "../src/desk.ts";
import { funeral, funeralReasons } from "../src/funeral.ts";
import { shelve } from "../src/shelve.ts";

function fakeDeps(options: {
  workspaces: WorkspaceInfo[];
  files?: Map<string, string>;
  porcelain?: Record<string, string>;
  agents?: AgentRow[];
  missing?: Set<string>;
  issues?: Record<string, { identifier: string; title: string; state: string; url: string }>;
  assigned?: import("../src/capture.ts").AssignedIssue[];
}): { deps: PluginDeps; closed: string[]; removed: string[] } {
  const files = options.files ?? new Map();
  const closed: string[] = [];
  const removed: string[] = [];
  return {
    closed,
    removed,
    deps: {
      async readFile(path) { return files.get(path); },
      async writeFile(path, contents) { files.set(path, contents); },
      async createIssue() { throw new Error("createIssue"); },
      async getWorkspace(id) { return options.workspaces.find((row) => row.workspace_id === id); },
      async listWorkspaces() { return options.workspaces; },
      async reportTicket() {},
      async listAgents() { return options.agents ?? []; },
      async closeWorkspace(id) { closed.push(id); },
      async removeWorktree(id) { removed.push(id); },
      async gitPorcelain(path) { return options.porcelain?.[path] ?? ""; },
      async pathExists(path) { return options.missing?.has(path) ? false : true; },
      async viewIssue(identifier) {
        const issue = options.issues?.[identifier];
        if (!issue) throw new Error(`missing issue ${identifier}`);
        return issue;
      },
      async listAssignedIssues() { return options.assigned ?? []; },
    },
  };
}

test("desk flags chairs without tickets, empty checkout, and missing map path", async () => {
  const tree = await mkdtemp(join(tmpdir(), "tba-desk-"));
  try {
    const goal = [
      "# Goal: Bound",
      "Linear: [EMO-1](https://linear.app/emo-eth/issue/EMO-1/x)",
      "## Map",
      "- Worktree: `/no/such/path`",
    ].join("\n");
    await writeFile(join(tree, "GOAL.md"), goal, "utf8");
    const fake = fakeDeps({
      workspaces: [
        { workspace_id: "w1", label: "bound", worktree: { checkout_path: tree }, tokens: { ticket: "EMO-1" } },
        { workspace_id: "w2", label: "orphan", worktree: { checkout_path: "/tmp/no-goal-chair" } },
        { workspace_id: "w3", label: "ghost", worktree: null },
      ],
      files: new Map([[join(tree, "GOAL.md"), goal]]),
      missing: new Set(["/no/such/path"]),
    });
    const report = await desk(fake.deps);
    assert.deepEqual(report.chairs.find((row) => row.workspace_id === "w1")?.orphans, ["map-path-missing"]);
    assert.deepEqual(report.chairs.find((row) => row.workspace_id === "w2")?.orphans, ["no-ticket"]);
    assert.deepEqual(report.chairs.find((row) => row.workspace_id === "w3")?.orphans, ["missing-checkout", "no-ticket"]);
    assert.equal(report.orphans.length, 3);
  } finally {
    await rm(tree, { recursive: true, force: true });
  }
});

test("shelve writes a sitting note when dirty then closes", async () => {
  const tree = "/tmp/fake-tree";
  const files = new Map<string, string>([[join(tree, "GOAL.md"), "Linear: [EMO-9](https://linear.app/emo-eth/issue/EMO-9/x)\n"]]);
  const fake = fakeDeps({
    workspaces: [{ workspace_id: "w9", label: "idea", worktree: { checkout_path: tree }, tokens: { ticket: "EMO-9" } }],
    files,
    porcelain: { [tree]: " M README.md\n" },
    agents: [{ workspace_id: "w9", pane_id: "w9:p1", agent_status: "working", agent: "pi" }],
  });
  const result = await shelve({ workspaceId: "w9" }, fake.deps);
  assert.equal(result.action, "shelved");
  assert.equal(result.sitting, true);
  assert.equal(result.dirty, true);
  assert.deepEqual(result.working, ["pi"]);
  assert.deepEqual(fake.closed, ["w9"]);
  assert.deepEqual(fake.removed, []);
  assert.match(files.get(join(tree, "SITTING.md")) ?? "", /Ticket: EMO-9/);
});

test("shelve of a clean idle chair only closes", async () => {
  const fake = fakeDeps({
    workspaces: [{ workspace_id: "w4", label: "quiet", worktree: { checkout_path: "/tmp/quiet" } }],
  });
  const result = await shelve({ workspaceId: "w4" }, fake.deps);
  assert.equal(result.sitting, false);
  assert.deepEqual(fake.closed, ["w4"]);
  assert.deepEqual(fake.removed, []);
});

test("funeral refuses open Linear and dirty trees", () => {
  assert.deepEqual(
    funeralReasons({ linearState: "In Progress", porcelain: " M x", goal: "# Goal\n" }),
    ["Linear is In Progress, not Done", "worktree is dirty"],
  );
});

test("funeral refuses unapproved done/acceptance/validation lists", () => {
  const reasons = funeralReasons({
    linearState: "Done",
    porcelain: "",
    goal: ["## Done", "tests pass", "## Acceptance", "operator-approved: yes", "## Validation", "not yet"].join("\n"),
  });
  assert.ok(reasons.some((reason) => /Done is not operator-approved/.test(reason)));
  assert.ok(reasons.some((reason) => /Validation is not operator-approved/.test(reason)));
});

test("funeral buries only when Done, clean, and ungated", async () => {
  const tree = "/tmp/done-tree";
  const fake = fakeDeps({
    workspaces: [{ workspace_id: "w5", label: "done", worktree: { checkout_path: tree }, tokens: { ticket: "EMO-5" } }],
    issues: { "EMO-5": { identifier: "EMO-5", title: "x", state: "Done", url: "https://linear.app/emo-eth/issue/EMO-5/x" } },
  });
  const result = await funeral({ workspaceId: "w5" }, fake.deps);
  assert.equal(result.action, "buried");
  assert.deepEqual(fake.removed, ["w5"]);
});

test("funeral does not remove when refused", async () => {
  const fake = fakeDeps({
    workspaces: [{ workspace_id: "w6", label: "open", worktree: { checkout_path: "/tmp/open" }, tokens: { ticket: "EMO-6" } }],
    issues: { "EMO-6": { identifier: "EMO-6", title: "x", state: "Backlog", url: "https://linear.app/emo-eth/issue/EMO-6/x" } },
  });
  const result = await funeral({ workspaceId: "w6" }, fake.deps);
  assert.equal(result.action, "refused");
  assert.deepEqual(fake.removed, []);
});
