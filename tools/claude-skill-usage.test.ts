import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NO_SKILL, scanUsage } from "./claude-skill-usage-core.ts";

type UsageRecord = {
  type: "assistant";
  requestId: string;
  timestamp: string;
  cwd: string;
  attributionSkill?: string;
  isSidechain?: boolean;
  message: {
    id: string;
    model: string;
    usage: Record<string, number>;
  };
};

function record(
  requestId: string,
  messageId: string,
  usage: Record<string, number>,
  overrides: Partial<UsageRecord> = {},
): UsageRecord {
  return {
    type: "assistant",
    requestId,
    timestamp: "2026-08-12T10:00:00.000Z",
    cwd: "/tmp/example",
    message: { id: messageId, model: "claude-test", usage },
    ...overrides,
  };
}

async function fixture(lines: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "claude-skill-usage-"));
  await writeFile(join(root, "session.jsonl"), `${lines.join("\n")}\n`);
  return root;
}

test("deduplicates repeated Claude records and retains skill attribution", async () => {
  const root = await fixture([
    JSON.stringify(
      record(
        "request-1",
        "message-1",
        {
          input_tokens: 10,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 3,
          output_tokens: 7,
        },
        { attributionSkill: "alpha" },
      ),
    ),
    JSON.stringify(
      record("request-1", "message-1", {
        input_tokens: 10,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 3,
        output_tokens: 7,
      }),
    ),
    JSON.stringify(
      record("request-2", "message-2", {
        input_tokens: 2,
        output_tokens: 3,
      }),
    ),
  ]);

  const report = await scanUsage({ roots: [root] });
  assert.equal(report.requests, 2);
  assert.deepEqual(report.tokens, {
    input: 12,
    cacheRead: 20,
    cacheCreation: 3,
    output: 10,
    total: 45,
  });
  assert.deepEqual(
    report.bySkill.map(({ skill, requests, total }) => ({ skill, requests, total })),
    [
      { skill: "alpha", requests: 1, total: 40 },
      { skill: NO_SKILL, requests: 1, total: 5 },
    ],
  );
});

test("prefers the main session over a duplicate sidechain event", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-skill-usage-"));
  await mkdir(join(root, "subagents"));
  await writeFile(
    join(root, "main.jsonl"),
    `${JSON.stringify(
      record("request-1", "message-1", { input_tokens: 4 }, {
        attributionSkill: "parent-skill",
      }),
    )}\n`,
  );
  await writeFile(
    join(root, "subagents", "agent-child.jsonl"),
    `${JSON.stringify(
      record("request-1", "message-1", { input_tokens: 4 }, {
        attributionSkill: "child-skill",
        isSidechain: true,
      }),
    )}\n`,
  );

  const report = await scanUsage({ roots: [root] });
  assert.equal(report.requests, 1);
  assert.equal(report.bySkill[0]?.skill, "parent-skill");
  assert.equal(report.bySkill[0]?.total, 4);
});

test("applies time and skill filters and reports malformed records", async () => {
  const root = await fixture([
    "not valid json with \"usage\"",
    JSON.stringify(
      record("request-1", "message-1", { input_tokens: 8 }, {
        attributionSkill: "alpha",
        timestamp: "2026-08-11T23:59:59.000Z",
      }),
    ),
    JSON.stringify(
      record("request-2", "message-2", { input_tokens: 16 }, {
        attributionSkill: "beta",
        timestamp: "2026-08-12T00:00:00.000Z",
      }),
    ),
  ]);

  const report = await scanUsage({
    roots: [root],
    sinceMs: Date.parse("2026-08-12T00:00:00.000Z"),
    skill: "beta",
  });
  assert.equal(report.requests, 1);
  assert.equal(report.tokens.total, 16);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0] ?? "", /invalid JSON/);
});
