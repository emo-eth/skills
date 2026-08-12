import assert from "node:assert/strict";
import test from "node:test";
import { WallClockController } from "../src/controller.ts";
import { MemoryStore } from "../src/store.ts";

type TestState = {
  controller: WallClockController;
  store: MemoryStore;
  advance: (ms: number) => void;
};

function setup(start = 1_000): TestState {
  let now = start;
  const clock = { now: () => now };
  const store = new MemoryStore();
  const controller = new WallClockController(clock, store);
  return { controller, store, advance: (ms: number) => { now += ms; } };
}

function activate(controller: WallClockController, durationMs = 10_000, expiryPolicy: "block-new" | "abort-running" = "block-new") {
  return controller.activate("main", { durationMs, wrapUpMs: 2_000, expiryPolicy });
}

function assignmentInput() {
  return {
    parentPlanItemId: "item-1",
    objective: "Inspect the relevant module",
    scope: ["src"],
    acceptance: ["Return the root cause"],
    budgetMs: 5_000,
    wrapUpMs: 1_000,
  };
}

test("inactive sessions remain unchanged", () => {
  const { controller } = setup();
  assert.equal(controller.decideTool("inactive", { toolName: "bash", action: "destructive" }).allow, true);
  assert.equal(controller.context("inactive"), "Wall-clock control is inactive for this session.");
});

test("activation requires an explicit expiry policy", () => {
  const { controller } = setup();
  assert.throws(() => controller.activate("main", { durationMs: 10_000 } as never), /Expiry policy/);
});

test("hard expiry blocks new work but permits final reporting", () => {
  const { controller, advance } = setup();
  activate(controller);
  const assignment = controller.assign("main", assignmentInput());
  advance(10_000);
  const decision = controller.decideTool("main", { toolName: "read", action: "read" });
  assert.equal(decision.allow, false);
  assert.equal(decision.phase, "expired");
  assert.equal(controller.decideTool("main", { toolName: "wallclock_report", action: "finalize" }).allow, true);
  assert.equal(controller.status("main", assignment.id).phase, "expired");
});

test("wrap-up blocks delegation and destructive work but allows read work", () => {
  const { controller, advance } = setup();
  activate(controller);
  advance(8_000);
  assert.equal(controller.decideTool("main", { toolName: "task", action: "delegate" }).allow, false);
  assert.equal(controller.decideTool("main", { toolName: "bash", action: "destructive" }).allow, false);
  assert.equal(controller.decideTool("main", { toolName: "read", action: "read" }).allow, true);
});

test("child budgets are capped by the parent and completion stops assignment work", () => {
  const { controller, advance } = setup();
  controller.activate("main", { durationMs: 20_000, wrapUpMs: 2_000, expiryPolicy: "block-new" });
  const assignment = controller.assign("main", assignmentInput());
  assert.equal(assignment.hardDeadline, 6_000);
  advance(1_000);
  controller.complete("main", assignment.id, "complete");
  const status = controller.status("main", assignment.id);
  assert.equal(status.phase, "complete");
  assert.equal(status.assignmentElapsedMs, 1_000);
  assert.equal(controller.decideTool("main", { toolName: "read", action: "read", assignmentId: assignment.id }).allow, false);
});

test("per-turn context reports host-measured inference, tool, and assignment elapsed time", () => {
  const { controller, advance } = setup();
  activate(controller, 60_000);
  const assignment = controller.assign("main", assignmentInput());
  controller.beginInference("main");
  advance(500);
  controller.endInference("main");
  controller.beginToolCall("main", "tool-1");
  controller.startAction("main", "tool-1", "read", "read", assignment.id);
  advance(700);
  controller.endAction("main", "tool-1");
  const context = controller.turnContext("main", assignment.id);
  assert.ok(context);
  assert.equal(context.currentTimeMs, 2_200);
  assert.equal(context.totalElapsedMs, 1_200);
  assert.equal(context.latestInferenceElapsedMs, 500);
  assert.equal(context.latestToolCallElapsedMs, 700);
  assert.equal(context.assignmentElapsedMs, 1_200);
  assert.equal(context.expiryPolicy, "block-new");
});

test("abort-running records requested and observed action aborts", () => {
  const { controller } = setup();
  activate(controller, 10_000, "abort-running");
  controller.beginToolCall("main", "tool-1");
  controller.startAction("main", "tool-1", "bash", "other");
  const allowed = controller.decideTool("main", { toolName: "bash", action: "other", actionId: "tool-1", enforceable: true });
  assert.equal(allowed.allow, true);
  const requested = controller.requestAbort("main", "tool-1");
  assert.equal(requested?.abortRequestedAt, 1_000);
  const observed = controller.markAbortObserved("main", "tool-1");
  assert.equal(observed?.abortObservedAt, 1_000);
  assert.equal(controller.endAction("main", "tool-1", 1_000, true)?.abortObservedAt, 1_000);
});

test("abort-running rejects an enforceable action without a host action identifier", () => {
  const { controller } = setup();
  activate(controller, 10_000, "abort-running");
  const decision = controller.decideTool("main", { toolName: "bash", action: "other", enforceable: true });
  assert.equal(decision.allow, false);
  assert.match(decision.reason ?? "", /action identifier/);
});

test("state restores policy and recomputes remaining time", () => {
  const { controller, store } = setup();
  controller.activate("main", { durationMs: 60_000, wrapUpMs: 2_000, expiryPolicy: "abort-running" });
  const restored = new WallClockController({ now: () => 2_000 }, store);
  restored.restore("main");
  const status = restored.status("main");
  assert.equal(status.active, true);
  assert.equal(status.remainingMs, 59_000);
  assert.equal(status.expiryPolicy, "abort-running");
});

test("reports preserve shortcuts, skipped validation, and measured elapsed time", () => {
  const { controller, advance } = setup();
  activate(controller, 60_000);
  const assignment = controller.assign("main", assignmentInput());
  advance(1_500);
  const report = controller.report("main", {
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
  assert.equal(report.actualElapsedMs, 1_500);
  assert.equal(report.shortcuts[0]?.choice, "Used a focused fixture");
  assert.equal(controller.snapshot("main")?.reports[0]?.actualElapsedMs, 1_500);
});

test("plan revisions record changed items and actual elapsed time", () => {
  const { controller, advance } = setup();
  controller.activate("main", { durationMs: 60_000, expiryPolicy: "block-new" });
  advance(2_000);
  const revision = controller.setPlan("main", [{ id: "item-1", title: "Ship the slice", status: "active" }], "Reduced scope to the working vertical slice");
  assert.deepEqual(revision.changedPlanItemIds, ["item-1"]);
  assert.equal(revision.actualElapsedMs, 2_000);
  assert.equal(controller.snapshot("main")?.planRevisions.length, 1);
});
