import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  NO_SKILL,
  SOURCES,
  scanAllSources,
  scanUsage,
} from "./agent-skill-usage-core.ts";

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
  const root = await mkdtemp(join(tmpdir(), "agent-skill-usage-"));
  await writeFile(join(root, "session.jsonl"), `${lines.join("\n")}\n`);
  return root;
}

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/all-source-skill-usage");

function fixtureRoots() {
  return {
    claude: [join(fixtureRoot, "claude")],
    codex: [join(fixtureRoot, "codex")],
    pi: [join(fixtureRoot, "pi")],
    omp: [join(fixtureRoot, "omp")],
  };
}

test("deduplicates repeated Claude records and retains native skill attribution", async () => {
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
  assert.equal(report.attribution.exactRequests, 1);
  assert.equal(report.attribution.unknownRequests, 1);
  assert.deepEqual(report.tokens, {
    input: 12,
    cacheRead: 20,
    cacheCreation: 3,
    output: 10,
    total: 45,
  });
  assert.deepEqual(
    report.bySkill.map(({ skill, requests, total, attribution }) => ({ skill, requests, total, attribution })),
    [
      { skill: "alpha", requests: 1, total: 40, attribution: "exact" },
      { skill: NO_SKILL, requests: 1, total: 5, attribution: "unknown" },
    ],
  );
});

test("prefers the main session over a duplicate sidechain event", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-skill-usage-"));
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

test("applies time and exact skill filters and reports malformed records", async () => {
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

test("scans all four harnesses directly without Memex", async () => {
  const report = await scanAllSources({ sources: SOURCES, sourceRoots: fixtureRoots() });

  assert.deepEqual(
    report.bySource.map(({ source, requests, total, exactRequests, unknownRequests }) => ({
      source,
      requests,
      total,
      exactRequests,
      unknownRequests,
    })),
    [
      { source: "claude", requests: 2, total: 45, exactRequests: 1, unknownRequests: 1 },
      { source: "codex", requests: 2, total: 12, exactRequests: 0, unknownRequests: 2 },
      { source: "pi", requests: 2, total: 30, exactRequests: 0, unknownRequests: 2 },
      { source: "omp", requests: 2, total: 21, exactRequests: 0, unknownRequests: 2 },
    ],
  );
  assert.equal(report.attribution.exactTokens, 40);
  assert.equal(report.attribution.unknownTokens, 68);
});

test("does not attribute a prior Codex skill command to later usage", async () => {
  const report = await scanAllSources({ sources: ["codex"], sourceRoots: fixtureRoots() });

  assert.deepEqual(report.tokens, {
    input: 1,
    cacheRead: 4,
    cacheCreation: 0,
    output: 7,
    total: 12,
  });
  assert.deepEqual(report.bySkill, [{
    skill: NO_SKILL,
    attribution: "unknown",
    requests: 2,
    exactRequests: 0,
    unknownRequests: 2,
    input: 1,
    cacheRead: 4,
    cacheCreation: 0,
    output: 7,
    total: 12,
    share: 1,
  }]);
});

test("attributes a skill only when an OMP usage record contains its read", async () => {
  const report = await scanAllSources({
    sources: ["omp"],
    sourceRoots: { omp: [join(fixtureRoot, "omp-tool-skill")] },
  });

  assert.deepEqual(report.bySkill.map(({ skill, attribution, requests, total }) => ({
    skill,
    attribution,
    requests,
    total,
  })), [{ skill: "epsilon", attribution: "exact", requests: 1, total: 9 }]);
});

test("does not carry a separate OMP tool record into usage attribution", async () => {
  const report = await scanAllSources({
    sources: ["omp"],
    sourceRoots: { omp: [join(fixtureRoot, "omp-custom-tool")] },
  });

  assert.equal(report.requests, 1);
  assert.equal(report.bySkill[0]?.skill, NO_SKILL);
  assert.equal(report.bySkill[0]?.attribution, "unknown");
});

test("does not attribute adjacent OMP usage after a skill command", async () => {
  const report = await scanAllSources({
    sources: ["omp"],
    sourceRoots: { omp: [join(fixtureRoot, "omp-one-shot")] },
  });

  assert.equal(report.requests, 4);
  assert.equal(report.attribution.exactRequests, 0);
  assert.equal(report.bySkill[0]?.skill, NO_SKILL);
  assert.equal(report.bySkill[0]?.total, 26);
});
