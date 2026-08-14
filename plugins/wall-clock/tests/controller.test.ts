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

test("an active contract must be stopped before it is replaced", () => {
  const { controller } = setup();
  activate(controller);
  assert.throws(() => activate(controller), /already active/);
  controller.stop("main");
  assert.equal(activate(controller).active, true);
});
test("turn-limit requires a duration and resets its deadline after a turn", () => {
  const { controller, advance } = setup();
  controller.activate("main", { durationMs: 120_000, wrapUpMs: 20_000, mode: "turn-limit", expiryPolicy: "block-new" });
  advance(119_000);
  assert.equal(controller.status("main").phase, "wrap-up");
  const reset = controller.resetTurn("main");
  assert.equal(reset.mode, "turn-limit");
  assert.equal(reset.durationMs, 120_000);
  assert.equal(reset.remainingMs, 120_000);
  assert.equal(reset.wrapUpAt, 220_000);
  assert.equal(reset.context?.totalElapsedMs, 119_000);
  assert.throws(
    () => controller.activate("other", { deadlineMs: 10_000, mode: "turn-limit", expiryPolicy: "block-new" }),
    /positive duration/,
  );
});

test("shortening the duration rescales wrap-up so the next turn starts active", () => {
  const { controller, advance } = setup();
  controller.activate("main", { durationMs: 60_000, wrapUpMs: 12_000, mode: "turn-limit", expiryPolicy: "block-new" });
  advance(5_000);
  const updated = controller.setDuration("main", 5_000);
  assert.equal(updated.phase, "active", "a shorter duration must not start the turn inside wrap-up");
  assert.equal(updated.durationMs, 5_000);
  const reset = controller.resetTurn("main");
  assert.equal(reset.phase, "active");
  assert.equal(reset.remainingMs, 5_000);
  assert.equal(reset.wrapUpAt, 10_000, "wrap-up rescales with the duration instead of clamping to the old band");
});

test("set duration re-arms either wall-clock mode without discarding state", () => {
  const { controller, advance } = setup();
  controller.activate("main", { durationMs: 60_000, expiryPolicy: "block-new" });
  advance(5_000);
  const updated = controller.setDuration("main", 3_000);
  assert.equal(updated.mode, "deadline");
  assert.equal(updated.durationMs, 3_000);
  assert.equal(updated.remainingMs, 3_000);

  controller.stop("main");
  controller.activate("main", { durationMs: 60_000, mode: "turn-limit", expiryPolicy: "block-new" });
  advance(5_000);
  const turnUpdated = controller.setDuration("main", 3_000);
  assert.equal(turnUpdated.mode, "turn-limit");
  assert.equal(turnUpdated.durationMs, 3_000);
  assert.equal(turnUpdated.remainingMs, 3_000);
});

test("turn-limit activation with armed turn state reports an armed phase and blocks assignment", () => {
  const { controller } = setup();
  controller.activate("main", { durationMs: 60_000, mode: "turn-limit", turnState: "armed", expiryPolicy: "block-new" });
  const status = controller.status("main");
  assert.equal(status.phase, "armed");
  assert.equal(status.turnState, "armed");
  assert.equal(status.remainingMs, 0);
  assert.equal(status.deadlineMs, undefined);
  assert.equal(status.wrapUpAt, undefined);
  assert.equal(controller.decideTool("main", { toolName: "read", action: "read" }).allow, true);
  assert.equal(controller.decideTool("main", { toolName: "task", action: "delegate" }).allow, true);
  assert.equal(controller.decideTool("main", { toolName: "bash", action: "destructive" }).allow, true);
  assert.throws(() => controller.assign("main", assignmentInput()), /Cannot create an assignment outside the active wall-clock phase/);
  assert.match(controller.context("main"), /the next normal user turn/);
});

test("armed turn state has no remaining-time claims in its context text", () => {
  const { controller } = setup();
  controller.activate("main", { durationMs: 60_000, mode: "turn-limit", turnState: "armed", expiryPolicy: "block-new" });
  const text = controller.context("main");
  assert.match(text, /Timer armed:/);
  assert.doesNotMatch(text, /Remaining time:/);
});

test("armTurn and resetTurn round-trip a fresh active window", () => {
  const { controller, advance } = setup();
  controller.activate("main", { durationMs: 60_000, wrapUpMs: 10_000, mode: "turn-limit", expiryPolicy: "block-new" });
  advance(5_000);
  const armed = controller.armTurn("main");
  assert.equal(armed.phase, "armed");
  assert.equal(armed.turnState, "armed");
  assert.equal(armed.remainingMs, 0);
  const reset = controller.resetTurn("main");
  assert.equal(reset.phase, "active");
  assert.equal(reset.turnState, "active");
  assert.equal(reset.remainingMs, 60_000);
  assert.equal(reset.durationMs, 60_000);
});

test("armTurn requires turn-limit mode", () => {
  const { controller } = setup();
  activate(controller, 60_000);
  assert.throws(() => controller.armTurn("main"), /turn-limit/);
});

test("setDuration while armed keeps the phase armed", () => {
  const { controller } = setup();
  controller.activate("main", { durationMs: 60_000, mode: "turn-limit", turnState: "armed", expiryPolicy: "block-new" });
  const updated = controller.setDuration("main", 30_000);
  assert.equal(updated.phase, "armed");
  assert.equal(updated.turnState, "armed");
  assert.equal(updated.durationMs, 30_000);
  assert.equal(updated.remainingMs, 0);
  const reset = controller.resetTurn("main");
  assert.equal(reset.remainingMs, 30_000);
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

test("assignment and child identifiers cannot be rebound", () => {
  const { controller } = setup();
  activate(controller, 60_000);
  const assignment = controller.assign("main", { ...assignmentInput(), id: "slice" });
  assert.throws(() => controller.assign("main", { ...assignmentInput(), id: "slice" }), /already exists/);
  controller.attachChild("main", assignment.id, "child-one");
  assert.equal(controller.attachChild("main", assignment.id, "child-one").childSessionId, "child-one");
  assert.throws(() => controller.attachChild("main", assignment.id, "child-two"), /already bound/);
  const second = controller.assign("main", { ...assignmentInput(), id: "second" });
  assert.throws(() => controller.attachChild("main", second.id, "child-one"), /already bound to assignment slice/);
});

test("generated assignment identifiers do not collide with user identifiers", () => {
  const { controller } = setup();
  activate(controller, 60_000);
  controller.assign("main", { ...assignmentInput(), id: "assignment-2" });
  assert.equal(controller.assign("main", assignmentInput()).id, "assignment-1");
  assert.equal(controller.assign("main", assignmentInput()).id, "assignment-3");
});

test("plans require unique nonempty item identifiers and titles", () => {
  const { controller } = setup();
  assert.throws(
    () => controller.activate("main", { durationMs: 60_000, expiryPolicy: "block-new" }, [
      { id: "same", title: "First", status: "pending" },
      { id: "same", title: "Second", status: "pending" },
    ]),
    /Plan item identifiers must be unique/,
  );
  controller.activate("main", { durationMs: 60_000, expiryPolicy: "block-new" });
  assert.throws(
    () => controller.setPlan("main", [{ id: " ", title: "Work", status: "active" }], "Add work"),
    /identifier must not be empty/,
  );
  assert.throws(
    () => controller.setPlan("main", [{ id: "work", title: " ", status: "active" }], "Add work"),
    /title must not be empty/,
  );
  assert.throws(
    () => controller.setPlan("main", [{ id: "work", title: "Work", status: "invented" } as never], "Add work"),
    /status is invalid/,
  );
  controller.setPlan("main", [{ id: "work", title: "Work", status: "active" }], "Add work");
  assert.throws(
    () => controller.assign("main", assignmentInput()),
    /does not exist in the current plan/,
  );
});

test("assignment and report contents are validated before persistence", () => {
  const { controller } = setup();
  activate(controller, 60_000);
  assert.throws(
    () => controller.assign("main", { ...assignmentInput(), scope: [" "] }),
    /scope entries must not be empty/,
  );
  const assignment = controller.assign("main", assignmentInput());
  assert.throws(
    () => controller.report("main", {
      assignmentId: assignment.id,
      status: "partial",
      completed: [],
      evidence: [],
      partial: [],
      skipped: [],
      validation: [],
      shortcuts: [{ choice: " ", tradeoff: "No full test" }],
      risks: [],
      unknowns: [],
      recommendedParentAction: "Continue",
    }),
    /shortcut choice must not be empty/,
  );
  assert.equal(controller.status("main", assignment.id).assignment?.status, "active");
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

test("fresh elapsed-time context starts every measured field at zero", () => {
  const { controller } = setup();
  controller.activate("main", { durationMs: 100, expiryPolicy: "block-new" });
  const context = controller.turnContext("main");
  assert.ok(context);
  assert.equal(context.latestInferenceElapsedMs, 0);
  assert.equal(context.latestToolCallElapsedMs, 0);
  assert.equal(context.phase, "active");
  assert.equal(controller.status("main").wrapUpAt, 1_080);
});

test("every terminal assignment status blocks more assignment work", () => {
  for (const terminalStatus of ["complete", "partial", "blocked", "expired"] as const) {
    const { controller } = setup();
    controller.activate("main", { durationMs: 20_000, wrapUpMs: 2_000, expiryPolicy: "block-new" });
    const assignment = controller.assign("main", assignmentInput());
    controller.complete("main", assignment.id, terminalStatus);
    const status = controller.status("main", assignment.id);
    assert.equal(status.phase, "complete", terminalStatus);
    assert.equal(
      controller.decideTool("main", { toolName: "read", action: "read", assignmentId: assignment.id }).allow,
      false,
      terminalStatus,
    );
  }
});

test("hard expiry only permits explicit wall-clock control tools", () => {
  const { controller, advance } = setup();
  activate(controller);
  advance(10_000);
  assert.equal(controller.decideTool("main", { toolName: "finalize_deploy", action: "finalize" }).allow, false);
  assert.equal(controller.decideTool("main", { toolName: "wallclock_report", action: "finalize" }).allow, true);
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
  assert.equal(status.mode, "deadline");
  assert.equal(status.durationMs, 60_000);
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
  assert.equal(report.expiryPolicy, "block-new");
  assert.equal(report.shortcuts[0]?.choice, "Used a focused fixture");
  assert.equal(controller.snapshot("main")?.reports[0]?.actualElapsedMs, 1_500);
  assert.throws(() => controller.complete("main", assignment.id, "complete"), /already has a partial report/);
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

test("plan revisions can mark partial work and link the report that caused the change", () => {
  const { controller, advance } = setup();
  controller.activate("main", {
    durationMs: 60_000,
    expiryPolicy: "block-new",
  }, [{ id: "item-1", title: "Ship the slice", status: "active" }]);
  const assignment = controller.assign("main", assignmentInput());
  advance(1_500);
  controller.report("main", {
    assignmentId: assignment.id,
    status: "partial",
    completed: ["The narrow path works"],
    evidence: ["The host test passed"],
    partial: ["The full matrix is not covered"],
    skipped: [],
    validation: ["Focused host test"],
    shortcuts: [],
    risks: [],
    unknowns: [],
    recommendedParentAction: "Defer the untested matrix",
  });

  const revision = controller.setPlan(
    "main",
    [{ id: "item-1", title: "Ship the slice", status: "partial" }],
    "Used the child report",
    assignment.id,
  );
  assert.equal(revision.sourceAssignmentId, assignment.id);
  assert.equal(revision.recommendedParentAction, "Defer the untested matrix");
  assert.equal(revision.actualAssignmentElapsedMs, 1_500);
});
