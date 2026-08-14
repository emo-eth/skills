import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendBugRecord, modelName, parseCommandArgs } from "../src/record.ts";

test("command arguments accept plugin and skill context flags", () => {
  assert.deepEqual(parseCommandArgs("--plugin focus-order --skill understand the popup is stale"), {
    plugin: "focus-order",
    skill: "understand",
    note: "the popup is stale",
  });
  assert.deepEqual(parseCommandArgs("--plugin=turn-summary record this\nwithout ceremony"), {
    plugin: "turn-summary",
    note: "record this without ceremony",
  });
  assert.throws(() => parseCommandArgs("--plugin"), /Usage: \/bug/);
  assert.throws(() => parseCommandArgs("--unknown note"), /Usage: \/bug/);
});

test("append writes one JSON record with debugging context", async () => {
  const root = await mkdtemp(join(tmpdir(), "bug-command-record-"));
  const destination = join(root, "logs", "BUGS.md");
  try {
    const record = await appendBugRecord({
      note: "the plugin command needed a clearer session lookup\nstep",
      host: "pi",
      agent: "Pi",
      cwd: "/repo/worktree",
      model: { provider: "openai", id: "gpt-test" },
      plugin: "focus-order",
      skill: "understand",
      sessionId: "session-123",
      sessionName: "debug session",
      sessionFile: "/tmp/session-123.jsonl",
      turn: 4,
      turnStartedAt: "2026-08-14T12:34:00.000Z",
      lastEvent: "tool_call",
      lastEventAt: "2026-08-14T12:34:02.000Z",
      lastCommand: "focus-order",
      lastTool: "read",
      sessionEntryCount: 12,
      branchEntryCount: 8,
      path: destination,
      now: new Date("2026-08-14T12:34:56.000Z"),
      git: {
        repo: "https://github.com/emo-eth/skills",
        worktree: "/repo/worktree",
        branch: "bug-command",
      },
    });

    const lines = (await readFile(destination, "utf8")).trimEnd().split("\n");
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.startsWith("- "), true);
    assert.deepEqual(JSON.parse(lines[0]!.slice(2)), record);
    assert.deepEqual(record, {
      schema: "bug.v1",
      id: record.id,
      datetime: "2026-08-14T12:34:56.000Z",
      host: "pi",
      repo: "https://github.com/emo-eth/skills",
      worktree: "/repo/worktree",
      branch: "bug-command",
      cwd: "/repo/worktree",
      agent: "Pi",
      model: "openai/gpt-test",
      plugin: "focus-order",
      skill: "understand",
      sessionId: "session-123",
      sessionName: "debug session",
      sessionFile: "/tmp/session-123.jsonl",
      turn: 4,
      turnStartedAt: "2026-08-14T12:34:00.000Z",
      lastEvent: "tool_call",
      lastEventAt: "2026-08-14T12:34:02.000Z",
      lastCommand: "focus-order",
      lastTool: "read",
      sessionEntryCount: 12,
      branchEntryCount: 8,
      note: "the plugin command needed a clearer session lookup step",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model metadata uses the provider and model id", () => {
  assert.equal(modelName({ provider: "openai", id: "gpt-test" }), "openai/gpt-test");
  assert.equal(modelName({ id: "gpt-test" }), "gpt-test");
  assert.equal(modelName(undefined), undefined);
});
