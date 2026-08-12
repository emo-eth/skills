import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WallClockController } from "../src/controller.ts";
import { JsonFileStore, WallClockMcpServer } from "../src/mcp.ts";
import { MemoryStore } from "../src/store.ts";

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

function initialize(server: WallClockMcpServer): void {
  const response = server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(readObject(response?.result).protocolVersion, "2025-06-18");
  assert.equal(server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), undefined);
}

function callTool(server: WallClockMcpServer, id: number, name: string, args: Record<string, unknown>): unknown {
  const response = server.handle({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  assert.ok(response && response.result);
  const result = readObject(response.result);
  const content = result.content;
  assert.ok(Array.isArray(content) && content.length > 0);
  const first = readObject(content[0]);
  assert.notEqual(result.isError, true, typeof first.text === "string" ? first.text : undefined);
  assert.equal(typeof first.text, "string");
  return JSON.parse(first.text);
}

test("MCP lifecycle exposes portable tools and rejects guidance-only activation", () => {
  const controller = new WallClockController({ now: () => 1_000 }, new MemoryStore());
  const server = new WallClockMcpServer(controller);
  initialize(server);

  const list = server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const listResult = readObject(list?.result);
  assert.ok(Array.isArray(listResult.tools));
  const names = listResult.tools.map((tool) => readObject(tool).name);
  assert.deepEqual(names, [
    "wallclock_start",
    "wallclock_status",
    "wallclock_stop",
    "wallclock_context",
    "wallclock_check",
    "wallclock_assign",
    "wallclock_complete",
    "wallclock_report",
    "wallclock_revise_plan",
  ]);

  const rejected = server.handle({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "wallclock_start", arguments: { sessionId: "run-1", deadline: "3s", expiryPolicy: "block-new" } },
  });
  const rejectedResult = readObject(rejected?.result);
  assert.equal(rejectedResult.isError, true);
  assert.match(String(readObject((rejectedResult.content as unknown[])[0]).text), /native Pi or OMP adapter/);
});

test("MCP reads native state, reports expiry decisions, and isolates session keys", () => {
  let now = 1_000;
  const controller = new WallClockController({ now: () => now }, new MemoryStore());
  const server = new WallClockMcpServer(controller);
  initialize(server);
  controller.activate("run-1", { durationMs: 3_000, wrapUpMs: 1_000, expiryPolicy: "block-new" });

  const startedStatus = readObject(callTool(server, 4, "wallclock_status", { sessionId: "run-1" }));
  assert.equal(startedStatus.phase, "active");
  assert.equal(startedStatus.remainingMs, 3_000);
  now += 3_000;

  const denied = readObject(callTool(server, 5, "wallclock_check", { sessionId: "run-1", toolName: "read", action: "read" }));
  assert.equal(denied.allow, false);
  assert.match(String(denied.reason), /expired/);

  const otherSession = readObject(callTool(server, 6, "wallclock_status", { sessionId: "run-2" }));
  assert.equal(otherSession.phase, "inactive");
});

test("JSON MCP state survives a new server instance", () => {
  const directory = mkdtempSync(join(tmpdir(), "wall-clock-mcp-"));
  try {
    const firstController = new WallClockController({ now: () => 1_000 }, new JsonFileStore(directory));
    firstController.activate("persisted", { durationMs: 60_000, expiryPolicy: "abort-running" });
    const firstServer = new WallClockMcpServer(firstController);
    initialize(firstServer);
    const firstStatus = readObject(callTool(firstServer, 7, "wallclock_status", { sessionId: "persisted" }));
    assert.equal(firstStatus.expiryPolicy, "abort-running");

    const secondController = new WallClockController({ now: () => 2_000 }, new JsonFileStore(directory));
    const secondServer = new WallClockMcpServer(secondController);
    initialize(secondServer);
    const restored = readObject(callTool(secondServer, 8, "wallclock_status", { sessionId: "persisted" }));
    assert.equal(restored.active, true);
    assert.equal(restored.remainingMs, 59_000);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("MCP plan revision supports partial status and links its source report", () => {
  let now = 1_000;
  const controller = new WallClockController({ now: () => now }, new MemoryStore());
  const server = new WallClockMcpServer(controller);
  initialize(server);
  controller.activate("run-1", { durationMs: 60_000, expiryPolicy: "block-new" }, [{ id: "one", title: "One", status: "active" }]);
  const assignment = controller.assign("run-1", {
    id: "slice",
    parentPlanItemId: "one",
    objective: "One slice",
    scope: ["src"],
    acceptance: ["Evidence"],
    budgetMs: 10_000,
  });
  now = 2_000;
  controller.report("run-1", {
    assignmentId: assignment.id,
    status: "partial",
    completed: ["Inspection"],
    evidence: ["src/file.ts"],
    partial: ["Edit"],
    skipped: ["Test"],
    validation: ["Read"],
    shortcuts: [{ choice: "Inspect only", tradeoff: "No edit" }],
    risks: ["Untested"],
    unknowns: ["Runtime"],
    recommendedParentAction: "Implement the edit",
  });

  const payload = readObject(callTool(server, 9, "wallclock_revise_plan", {
    sessionId: "run-1",
    sourceAssignmentId: "slice",
    reason: "The slice was partial",
    plan: [{ id: "one", title: "One", status: "partial" }],
  }));
  const revision = readObject(payload.revision);
  assert.equal(revision.sourceAssignmentId, "slice");
  assert.equal(revision.actualAssignmentElapsedMs, 1_000);
  assert.equal(revision.recommendedParentAction, "Implement the edit");
});
