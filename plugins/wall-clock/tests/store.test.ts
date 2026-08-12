import assert from "node:assert/strict";
import test from "node:test";
import { WallClockController } from "../src/controller.ts";
import { isPersistedState, MemoryStore, stateFromEntries } from "../src/store.ts";

function validState() {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  controller.activate("main", { durationMs: 60_000, expiryPolicy: "block-new" });
  return controller.snapshot("main")!;
}

test("restore rejects the newest malformed host state instead of using stale state", () => {
  const valid = validState();
  const entries = [
    { type: "custom", customType: "wall-clock-state", data: valid },
    { type: "custom", customType: "wall-clock-state", data: { ...valid, reports: [{ assignmentId: "broken" }] } },
  ];
  assert.equal(stateFromEntries(entries, "main"), null);
});

test("persisted-state validation checks nested report and assignment contracts", () => {
  const valid = validState();
  assert.equal(isPersistedState(valid), true);
  assert.equal(isPersistedState({ ...valid, assignments: [{ id: "broken" }] }), false);
  assert.equal(isPersistedState({ ...valid, reports: [{ assignmentId: "broken" }] }), false);
  assert.equal(isPersistedState({ ...valid, plan: [{ id: "one", title: "One", status: "invented" }] }), false);
});

test("persisted-state validation checks parent-child timing and report links", () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  controller.activate("main", { durationMs: 60_000, expiryPolicy: "block-new" });
  const assignment = controller.assign("main", {
    parentPlanItemId: "one",
    objective: "One slice",
    scope: ["src"],
    acceptance: ["Evidence"],
    budgetMs: 5_000,
  });
  controller.report("main", {
    assignmentId: assignment.id,
    status: "partial",
    completed: [],
    evidence: [],
    partial: ["Work remains"],
    skipped: [],
    validation: [],
    shortcuts: [],
    risks: [],
    unknowns: [],
    recommendedParentAction: "Continue",
  });
  const valid = controller.snapshot("main")!;
  const extendedAssignment = { ...valid.assignments[0], hardDeadline: valid.hardDeadline + 1 };
  assert.equal(isPersistedState({ ...valid, assignments: [extendedAssignment] }), false);
  assert.equal(isPersistedState({ ...valid, reports: [{ ...valid.reports[0], expiryPolicy: "abort-running" }] }), false);
  assert.equal(isPersistedState({ ...valid, assignments: [{ ...valid.assignments[0], status: "complete" }] }), false);
  assert.equal(isPersistedState({
    ...valid,
    assignments: [valid.assignments[0], { ...valid.assignments[0], id: "other", childSessionId: "same-child" }, { ...valid.assignments[0], id: "third", childSessionId: "same-child" }],
    reports: [],
  }), false);
  assert.equal(isPersistedState({
    ...valid,
    planRevisions: [{
      revision: valid.revision,
      recordedAt: valid.issuedAt,
      changedPlanItemIds: [],
      reason: "Bad source",
      actualElapsedMs: 0,
      sourceAssignmentId: "missing",
    }],
  }), false);
});

test("discard removes in-memory and stored state", () => {
  const store = new MemoryStore();
  const controller = new WallClockController({ now: () => 1_000 }, store);
  controller.activate("main", { durationMs: 60_000, expiryPolicy: "block-new" });
  controller.discard("main");
  assert.equal(controller.status("main").active, false);
  assert.equal(store.load("main"), undefined);
});

test("controller access rejects malformed state returned by a store", () => {
  let deleted = false;
  const malformedStore = {
    load: () => ({ ...validState(), version: 2 }),
    save: () => undefined,
    delete: () => { deleted = true; },
  };
  const controller = new WallClockController({ now: () => 2_000 }, malformedStore as never);
  assert.equal(controller.status("main").active, false);
  assert.equal(deleted, true);
});
