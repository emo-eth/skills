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

test("MCP lifecycle exposes wall-clock tools and reports expired work", () => {
  let now = 1_000;
  const controller = new WallClockController({ now: () => now }, new MemoryStore());
  const server = new WallClockMcpServer(controller);

  const initialized = server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  });
  assert.equal(readObject(initialized?.result).protocolVersion, "2025-06-18");
  assert.equal(server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), undefined);

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
  ]);

  const started = readObject(callTool(server, 3, "wallclock_start", { sessionId: "run-1", deadline: "3s", wrapUpMs: 1_000 }));
  const startedStatus = readObject(started.status);
  assert.equal(startedStatus.phase, "active");
  assert.equal(startedStatus.remainingMs, 3_000);

  const assignment = readObject(callTool(server, 4, "wallclock_assign", {
    sessionId: "run-1",
    parentPlanItemId: "item-1",
    objective: "Inspect one module",
    scope: ["src"],
    acceptance: ["Return evidence"],
    budgetMs: 1_000,
  }));
  const assignmentValue = readObject(assignment.assignment);
  assert.equal(assignmentValue.status, "active");

  const allowed = readObject(callTool(server, 5, "wallclock_check", {
    sessionId: "run-1",
    toolName: "read",
    action: "read",
    estimatedMs: 500,
    assignmentId: assignmentValue.id,
  }));
  assert.equal(allowed.allow, true);

  now += 3_000;
  const denied = readObject(callTool(server, 6, "wallclock_check", {
    sessionId: "run-1",
    toolName: "read",
    action: "read",
    assignmentId: assignmentValue.id,
  }));
  assert.equal(denied.allow, false);
  assert.match(String(denied.reason), /expired/);

  const otherSession = readObject(callTool(server, 7, "wallclock_status", { sessionId: "run-2" }));
  assert.equal(otherSession.phase, "inactive");
});

test("JSON MCP state survives a new server instance and isolates session keys", () => {
  const directory = mkdtempSync(join(tmpdir(), "wall-clock-mcp-"));
  try {
    const firstController = new WallClockController({ now: () => 1_000 }, new JsonFileStore(directory));
    const firstServer = new WallClockMcpServer(firstController);
    firstServer.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    firstServer.handle({ jsonrpc: "2.0", method: "notifications/initialized" });
    callTool(firstServer, 2, "wallclock_start", { sessionId: "persisted", deadline: "1h" });
    const secondController = new WallClockController({ now: () => 2_000 }, new JsonFileStore(directory));
    const secondServer = new WallClockMcpServer(secondController);
    secondServer.handle({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    secondServer.handle({ jsonrpc: "2.0", method: "notifications/initialized" });
    const restored = readObject(callTool(secondServer, 4, "wallclock_status", { sessionId: "persisted" }));
    const isolated = readObject(callTool(secondServer, 5, "wallclock_status", { sessionId: "other" }));
    assert.equal(restored.phase, "active");
    assert.equal(isolated.phase, "inactive");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
