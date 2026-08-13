import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  NO_SKILL,
  SOURCES,
  scanAllSources,
  scanUsage,
} from "./claude-skill-usage-core.ts";

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

test("joins Memex Claude and Codex events with local attribution", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/all-source-skill-usage");
  const claudePath = join(root, "claude/session.jsonl");
  const codexPath = join(root, "codex/session.jsonl");
  const report = await scanAllSources({
    sources: SOURCES,
    useMemex: false,
    sourceRoots: {
      claude: [join(root, "claude")],
      codex: [join(root, "codex")],
      pi: [join(root, "pi")],
      omp: [join(root, "omp")],
    },
    memexOutput: {
      details: [
        {
          source: "claude",
          source_path: claudePath,
          source_record_id: "line:1",
          request_id: "claude-request-1",
          message_id: "claude-message-1",
          timestamp_ms: Date.parse("2026-08-12T10:00:01.000Z"),
          session_id: null,
          model: "claude-fixture",
          tokens: { uncached_input: 10, cache_read: 20, cache_write: 3, output: 7 },
        },
        {
          source: "claude",
          source_path: claudePath,
          source_record_id: "line:2",
          request_id: "claude-request-2",
          message_id: "claude-message-2",
          timestamp_ms: Date.parse("2026-08-12T10:00:02.000Z"),
          session_id: null,
          model: "claude-fixture",
          tokens: { uncached_input: 2, output: 3 },
        },
        {
          source: "codex",
          source_path: codexPath,
          source_record_id: "event:0",
          request_id: null,
          message_id: null,
          timestamp_ms: Date.parse("2026-08-12T10:00:12.000Z"),
          session_id: "codex-session-1",
          model: "codex-fixture",
          tokens: { uncached_input: 4, cache_read: 5, output: 6 },
        },
        {
          source: "codex",
          source_path: codexPath,
          source_record_id: "event:1",
          request_id: null,
          message_id: null,
          timestamp_ms: Date.parse("2026-08-12T10:00:14.000Z"),
          session_id: "codex-session-1",
          model: "codex-fixture",
          tokens: { uncached_input: 1, output: 1 },
        },
      ],
    },
  });

  assert.deepEqual(
    report.bySource.map(({ source, requests, total, observedRequests, unknownRequests }) => ({
      source,
      requests,
      total,
      observedRequests,
      unknownRequests,
    })),
    [
      { source: "claude", requests: 2, total: 45, observedRequests: 1, unknownRequests: 1 },
      { source: "codex", requests: 2, total: 17, observedRequests: 1, unknownRequests: 1 },
      { source: "pi", requests: 2, total: 30, observedRequests: 1, unknownRequests: 1 },
      { source: "omp", requests: 2, total: 21, observedRequests: 1, unknownRequests: 1 },
    ],
  );
  assert.equal(report.attribution.observedTokens, 98);
  assert.equal(report.attribution.unknownTokens, 15);
  assert.equal(report.bySkill.find((summary) => summary.skill === "alpha")?.attribution, "observed");
  assert.equal(report.bySkill.find((summary) => summary.skill === NO_SKILL)?.attribution, "unknown");
  assert.equal(report.bySkill.find((summary) => summary.skill === "beta")?.total, 15);
  assert.equal(report.bySkill.find((summary) => summary.skill === "gamma")?.total, 25);
  assert.equal(report.bySkill.find((summary) => summary.skill === "delta")?.total, 18);
});

test("consumes normalized Codex attribution after one usage event", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/all-source-skill-usage");
  const codexPath = join(root, "codex/session.jsonl");
  const report = await scanAllSources({
    sources: ["codex"],
    sourceRoots: { codex: [join(root, "codex")] },
    memexOutput: {
      details: [
        {
          source: "codex",
          source_path: codexPath,
          source_record_id: "event:0",
          request_id: null,
          message_id: null,
          timestamp_ms: Date.parse("2026-08-12T10:00:12.000Z"),
          session_id: "codex-session-1",
          model: "codex-fixture",
          tokens: { uncached_input: 4, cache_read: 5, output: 6 },
        },
        {
          source: "codex",
          source_path: codexPath,
          source_record_id: "event:1",
          request_id: null,
          message_id: null,
          timestamp_ms: Date.parse("2026-08-12T10:00:12.500Z"),
          session_id: "codex-session-1",
          model: "codex-fixture",
          tokens: { uncached_input: 2, output: 3 },
        },
        {
          source: "codex",
          source_path: codexPath,
          source_record_id: "event:2",
          request_id: null,
          message_id: null,
          timestamp_ms: Date.parse("2026-08-12T10:00:14.000Z"),
          session_id: "codex-session-1",
          model: "codex-fixture",
          tokens: { uncached_input: 1, output: 1 },
        },
      ],
    },
  });

  assert.equal(report.requests, 3);
  assert.deepEqual(
    report.bySkill.map(({ skill, requests, total }) => ({ skill, requests, total })),
    [
      { skill: "beta", requests: 1, total: 15 },
      { skill: NO_SKILL, requests: 2, total: 7 },
    ],
  );
});

test("local Pi and OMP parsers derive explicit skills and preserve unknown events", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/all-source-skill-usage");
  const report = await scanAllSources({
    sources: ["pi", "omp"],
    useMemex: false,
    sourceRoots: { pi: [join(root, "pi")], omp: [join(root, "omp")] },
  });

  assert.equal(report.requests, 4);
  assert.deepEqual(report.bySkill.map(({ skill, requests }) => ({ skill, requests })), [
    { skill: "gamma", requests: 1 },
    { skill: "delta", requests: 1 },
    { skill: NO_SKILL, requests: 2 },
  ]);
  assert.deepEqual(report.bySource.map(({ source, total }) => ({ source, total })), [
    { source: "pi", total: 30 },
    { source: "omp", total: 21 },
  ]);
});

test("derives a skill from an OMP skill:// read inside assistant content", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/all-source-skill-usage");
  const report = await scanAllSources({
    sources: ["omp"],
    useMemex: false,
    sourceRoots: { omp: [join(root, "omp-tool-skill")] },
  });

  assert.equal(report.requests, 1);
  assert.deepEqual(
    report.bySkill.map(({ skill, attribution, requests, total }) => ({
      skill,
      attribution,
      requests,
      total,
    })),
    [{ skill: "epsilon", attribution: "observed", requests: 1, total: 9 }],
  );
});

test("derives a skill from an OMP custom read execution record", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/all-source-skill-usage");
  const report = await scanAllSources({
    sources: ["omp"],
    useMemex: false,
    sourceRoots: { omp: [join(root, "omp-custom-tool")] },
  });

  assert.equal(report.requests, 1);
  assert.deepEqual(
    report.bySkill.map(({ skill, attribution, requests, total }) => ({
      skill,
      attribution,
      requests,
      total,
    })),
    [{ skill: "zeta", attribution: "observed", requests: 1, total: 13 }],
  );
});
test("attributes only the next OMP usage after an explicit skill read", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/all-source-skill-usage");
  const report = await scanAllSources({
    sources: ["omp"],
    useMemex: false,
    sourceRoots: { omp: [join(root, "omp-one-shot")] },
  });

  assert.equal(report.requests, 4);
  assert.deepEqual(
    report.bySkill.find(({ skill }) => skill === "papercut"),
    {
      skill: "papercut",
      attribution: "observed",
      requests: 2,
      observedRequests: 2,
      unknownRequests: 0,
      input: 6,
      cacheRead: 0,
      cacheCreation: 0,
      output: 7,
      total: 13,
      share: 0.5,
    },
  );
  assert.deepEqual(
    report.bySkill.find(({ skill }) => skill === NO_SKILL),
    {
      skill: NO_SKILL,
      attribution: "unknown",
      requests: 2,
      observedRequests: 0,
      unknownRequests: 2,
      input: 6,
      cacheRead: 0,
      cacheCreation: 0,
      output: 7,
      total: 13,
      share: 0.5,
    },
  );
});

test("local Codex parser counts cached input once", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/all-source-skill-usage");
  const report = await scanAllSources({
    sources: ["codex"],
    useMemex: false,
    sourceRoots: { codex: [join(root, "codex")] },
  });

  assert.deepEqual(report.tokens, {
    input: 1,
    cacheRead: 4,
    cacheCreation: 0,
    output: 7,
    total: 12,
  });
  assert.deepEqual(
    report.bySkill.map(({ skill, requests, total }) => ({ skill, requests, total })),
    [
      { skill: "beta", requests: 1, total: 10 },
      { skill: NO_SKILL, requests: 1, total: 2 },
    ],
  );
});


test("accepts a normalized Memex JSON string for offline reports", async () => {
  const report = await scanAllSources({
    sources: ["claude"],
    sourceRoots: { claude: [] },
    memexOutput: await readFile(
      join(resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/all-source-skill-usage"), "memex.json"),
      "utf8",
    ),
  });
  assert.equal(report.requests, 1);
  assert.equal(report.bySkill[0]?.skill, NO_SKILL);
  assert.equal(report.bySource[0]?.source, "claude");
});
