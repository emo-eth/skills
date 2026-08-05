import assert from "node:assert/strict";
import test from "node:test";
import { WallClockController } from "../src/controller.ts";
import { MemoryStore } from "../src/store.ts";

function setup(start = 1_000) {
  let now = start;
  const clock = { now: () => now };
  const store = new MemoryStore();
  const controller = new WallClockController(clock, store);
  return { controller, store, advance: (ms: number) => { now += ms; } };
}

test("inactive sessions are unchanged", () => {
  const { controller } = setup();
  assert.equal(controller.decideTool("inactive", { toolName: "bash", action: "destructive" }).allow, true);
});

test("hard expiry blocks new work", () => {
  const { controller, advance } = setup();
  controller.activate("main", { durationMs: 10_000, wrapUpMs: 2_000 });
  advance(10_000);
  const decision = controller.decideTool("main", { toolName: "read", action: "read" });
  assert.equal(decision.allow, false);
  assert.equal(decision.phase, "expired");
});

test("wrap-up blocks delegation and destructive work", () => {
  const { controller, advance } = setup();
  controller.activate("main", { durationMs: 10_000, wrapUpMs: 2_000 });
  advance(8_000);
  assert.equal(controller.decideTool("main", { toolName: "task", action: "delegate" }).allow, false);
  assert.equal(controller.decideTool("main", { toolName: "read", action: "read" }).allow, true);
});

test("child budgets are capped by the parent and can finish early", () => {
  const { controller, advance } = setup();
  controller.activate("main", { durationMs: 20_000, wrapUpMs: 2_000 });
  const assignment = controller.assign("main", {
    parentPlanItemId: "item-1",
    objective: "Inspect the relevant module",
    scope: ["src"],
    acceptance: ["Return the root cause"],
    budgetMs: 5_000,
    wrapUpMs: 1_000,
  });
  assert.equal(assignment.hardDeadline, 6_000);
  controller.complete("main", assignment.id, "complete");
  assert.equal(controller.status("main", assignment.id).phase, "complete");
  assert.equal(controller.decideTool("main", { toolName: "read", action: "read", assignmentId: assignment.id }).allow, false);
  advance(1_000);
});

test("state restores from the store", () => {
  const { controller, store } = setup();
  controller.activate("main", { durationMs: 60_000 });
  const restored = new WallClockController({ now: () => 2_000 }, store);
  restored.restore("main");
  assert.equal(restored.status("main").active, true);
  assert.equal(restored.status("main").remainingMs, 59_000);
});

test("reports preserve shortcuts and skipped validation", () => {
  const { controller } = setup();
  controller.activate("main", { durationMs: 60_000 });
  const assignment = controller.assign("main", {
    parentPlanItemId: "item-1",
    objective: "Build a working slice",
    scope: ["src"],
    acceptance: ["The slice runs"],
    budgetMs: 10_000,
  });
  controller.report("main", {
    assignmentId: assignment.id,
    status: "partial",
    completed: ["The slice runs"],
    evidence: ["Focused test passed"],
    partial: ["Full integration coverage"],
    skipped: ["Full integration coverage"],
    validation: ["Focused test"],
    shortcuts: [{ choice: "Used a focused fixture", tradeoff: "Did not cover the full matrix" }],
    risks: ["The untested path may regress"],
    unknowns: [],
    recommendedParentAction: "Add integration coverage later",
  });
  const snapshot = controller.snapshot("main");
  assert.equal(snapshot?.reports[0]?.shortcuts[0]?.choice, "Used a focused fixture");
  assert.equal(snapshot?.assignments[0]?.status, "partial");
});
