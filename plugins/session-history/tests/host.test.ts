import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildExpandArgs,
  buildInspectArgs,
  buildManageArgs,
  buildQueryArgs,
  buildRecallArgs,
  buildResumeArgs,
  buildStatusArgs,
  installSessionHistoryTools,
  runSessionHistoryCli,
} from "../src/host.ts";
import type {
  RuntimeHost,
  SessionHistoryPayload,
  SessionHistoryRunner,
  SessionHistoryToolError,
  SessionRecallResult,
  SessionStatusResult,
} from "../src/host.ts";
import sessionHistoryOmpExtension from "../src/omp.ts";
import sessionHistoryPiExtension from "../src/pi.ts";

type ToolApprovalDecision = "read" | "write" | "exec" | {
  tier: "read" | "write" | "exec";
  reason?: string;
  override?: boolean;
  policy?: "allow" | "deny" | "prompt";
};

type ToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  approval?: ToolApprovalDecision | ((input: unknown) => ToolApprovalDecision);
  execute: (...args: unknown[]) => unknown;
};

class Host implements RuntimeHost {
  readonly tools = new Map<string, ToolDefinition>();

  registerTool(definition: ToolDefinition): void {
    this.tools.set(definition.name, definition);
  }
}

const CITATION = {
  source: "local-pi",
  harness: "pi" as const,
  session_id: "sess-1",
  moment_id: "moment-42",
  timestamp: "2026-09-01T10:00:00Z",
  snippet: "We chose hybrid retrieval",
  role: "assistant",
};

const RECALL_RESULT: SessionRecallResult = {
  answer: "Hybrid retrieval was chosen for session history search.",
  citations: [CITATION],
  degraded: false,
  warnings: [],
  conflicts: [],
  elapsed_ms: 150,
};

const STATUS_RESULT: SessionStatusResult = {
  healthy: true,
  cass_available: true,
  hybrid_ready: true,
  sources: [{ name: "local-pi", harness: "pi", sessions_count: 12, last_sync: "2026-09-16T12:00:00Z" }],
  warnings: [],
  exclusions: { sessions: [], sources: [] },
  purged: { sessions: [], sources: [] },
};

const TOOL_ERROR: SessionHistoryToolError = {
  error: "unavailable",
  message: "Index not ready",
};

const TOOL_NAMES = [
  "session_recall",
  "session_inspect",
  "session_expand",
  "session_resume",
  "session_query",
  "session_status",
  "session_manage",
];

function payloadValue(value: unknown): SessionHistoryPayload {
  if (typeof value !== "object" || value === null || !("content" in value) || !Array.isArray(value.content)) {
    throw new Error("tool returned no content");
  }
  const item = value.content[0];
  if (typeof item !== "object" || item === null || !("text" in item) || typeof item.text !== "string") {
    throw new Error("tool returned no text");
  }
  return JSON.parse(item.text) as SessionHistoryPayload;
}

for (const [name, adapter] of [
  ["Pi", sessionHistoryPiExtension],
  ["OMP", sessionHistoryOmpExtension],
] as const) {
  test(`${name} registers all session history tools`, () => {
    const host = new Host();
    adapter(host);
    assert.deepEqual([...host.tools.keys()], TOOL_NAMES);
    for (const toolName of TOOL_NAMES) {
      const tool = host.tools.get(toolName);
      assert.ok(tool);
      assert.ok(tool.label.length > 0);
      assert.ok(tool.description.length > 0);
    }
  });
}

test("host adapters apply the correct approval boundary", () => {
  const pi = new Host();
  const omp = new Host();
  sessionHistoryPiExtension(pi);
  sessionHistoryOmpExtension(omp);

  for (const name of TOOL_NAMES.filter((tool) => tool !== "session_manage")) {
    assert.equal(pi.tools.get(name)?.approval, undefined);
    assert.equal(omp.tools.get(name)?.approval, "read");
  }

  assert.equal(pi.tools.get("session_manage")?.approval, undefined);
  const approval = omp.tools.get("session_manage")?.approval;
  assert.equal(typeof approval, "function");
  if (typeof approval !== "function") throw new Error("OMP manage approval is not dynamic");
  assert.equal(approval({ action: "reinclude" }), "write");
  assert.deepEqual(approval({ action: "exclude" }), {
    tier: "write",
    reason: "Session history exclude",
    override: true,
    policy: "prompt",
  });
  assert.deepEqual(approval({ action: "purge" }), {
    tier: "exec",
    reason: "Session history purge",
    override: true,
    policy: "prompt",
  });
});

test("installSessionHistoryTools requires the native registerTool seam", () => {
  assert.throws(() => installSessionHistoryTools({}), /native registerTool seam/);
});

test("recall argument construction defaults limit and accepts overrides", () => {
  assert.deepEqual(
    buildRecallArgs({ query: "plot" }),
    ["recall", "--query", "plot", "--json", "--limit", "3", "--hybrid"],
  );
  assert.deepEqual(
    buildRecallArgs({ query: "plot", limit: 5, mode: "lexical-only" }),
    ["recall", "--query", "plot", "--json", "--limit", "5", "--lexical-only"],
  );
  assert.throws(() => buildRecallArgs({ query: "" }), /query must be a non-empty string/);
  assert.throws(() => buildRecallArgs({ query: "x", limit: 0 }), /limit must be a positive integer/);
});

test("inspect and expand argument construction validate inputs", () => {
  assert.deepEqual(
    buildInspectArgs({ session: "sess-1", moment: "moment-10" }),
    ["inspect", "--session", "sess-1", "--moment", "moment-10", "--json"],
  );
  assert.deepEqual(
    buildExpandArgs({ session: "sess-1", moment: "moment-10", before: 5, after: 2 }),
    ["expand", "--session", "sess-1", "--moment", "moment-10", "--json", "--before", "5", "--after", "2"],
  );
  assert.throws(() => buildExpandArgs({ session: "sess-1", moment: "moment-10", before: -1 }), /before must be a non-negative integer/);
});

test("resume, query, status, and manage argument construction", () => {
  assert.deepEqual(buildResumeArgs({ session: "sess-1" }), ["resume", "--session", "sess-1", "--json"]);
  assert.deepEqual(
    buildQueryArgs({ session: "sess-1", query: "decision" }),
    ["query-session", "--session", "sess-1", "--query", "decision", "--json"],
  );
  assert.deepEqual(buildStatusArgs(), ["status", "--json"]);
  assert.deepEqual(
    buildManageArgs({ action: "exclude", session: "sess-1" }),
    ["manage", "--action", "exclude", "--json", "--session", "sess-1"],
  );
  assert.deepEqual(
    buildManageArgs({ action: "disconnect", source: "remote-1" }),
    ["manage", "--action", "disconnect", "--json", "--source", "remote-1"],
  );
  assert.throws(
    () => buildManageArgs({ action: "exclude" }),
    /session or source is required/,
  );
});

test("session_recall forwards args to the runner and parses results", async () => {
  const calls: Array<{ args: string[]; timeoutMs?: number }> = [];
  const runner: SessionHistoryRunner = async (args, options) => {
    calls.push({ args, timeoutMs: options?.timeoutMs });
    return RECALL_RESULT;
  };
  const host = new Host();
  installSessionHistoryTools(host, { runner });

  const value = await host.tools.get("session_recall")?.execute(
    "call-1",
    { query: "hybrid retrieval", limit: 2 },
    new AbortController().signal,
  );

  assert.deepEqual(calls, [{
    args: ["recall", "--query", "hybrid retrieval", "--json", "--limit", "2", "--hybrid"],
    timeoutMs: 2000,
  }]);
  assert.deepEqual(payloadValue(value), RECALL_RESULT);
});

test("session_status uses the default timeout budget", async () => {
  const calls: Array<{ args: string[]; timeoutMs?: number }> = [];
  const runner: SessionHistoryRunner = async (args, options) => {
    calls.push({ args, timeoutMs: options?.timeoutMs });
    return STATUS_RESULT;
  };
  const host = new Host();
  installSessionHistoryTools(host, { runner });

  await host.tools.get("session_status")?.execute("call-1", {}, new AbortController().signal);
  assert.deepEqual(calls, [{ args: ["status", "--json"], timeoutMs: undefined }]);
});

test("content tools pass tool errors through unthrown", async () => {
  const runner: SessionHistoryRunner = async () => TOOL_ERROR;
  const host = new Host();
  installSessionHistoryTools(host, { runner });

  const value = await host.tools.get("session_recall")?.execute(
    "call-1",
    { query: "missing" },
    new AbortController().signal,
  );
  assert.deepEqual(payloadValue(value), TOOL_ERROR);
});

test("Pi-style manage confirmation rejects destructive actions without host approval", async () => {
  const runner: SessionHistoryRunner = async () => ({
    action: "exclude",
    ok: true,
    session: "sess-1",
  });
  const host = new Host();
  installSessionHistoryTools(host, { runner, consent: "context" });

  const value = await host.tools.get("session_manage")?.execute(
    "call-1",
    { action: "exclude", session: "sess-1" },
    new AbortController().signal,
  );
  assert.deepEqual(payloadValue(value), {
    error: "authorization_cancelled",
    message: "Session history manage action requires explicit human approval.",
  });
});

test("Pi-style manage confirmation allows destructive actions after host approval", async () => {
  const calls: string[][] = [];
  const runner: SessionHistoryRunner = async (args) => {
    calls.push(args);
    return {
      action: "exclude",
      ok: true,
      session: "sess-1",
    };
  };
  const host = new Host();
  installSessionHistoryTools(host, { runner, consent: "context" });

  const value = await host.tools.get("session_manage")?.execute(
    "call-1",
    { action: "exclude", session: "sess-1" },
    new AbortController().signal,
    {
      ui: {
        confirm: async () => true,
      },
    },
  );
  assert.deepEqual(calls, [["manage", "--action", "exclude", "--json", "--session", "sess-1"]]);
  assert.deepEqual(payloadValue(value), {
    action: "exclude",
    ok: true,
    session: "sess-1",
  });
});

test("runSessionHistoryCli parses structured output and rejects malformed output", async () => {
  const root = mkdtempSync(join(tmpdir(), "session-history-runner-"));
  const valid = join(root, "valid.py");
  const invalid = join(root, "invalid.py");
  writeFileSync(valid, `#!/usr/bin/env python3\nprint(${JSON.stringify(JSON.stringify(RECALL_RESULT))})\n`);
  writeFileSync(invalid, "#!/usr/bin/env python3\nprint('not json')\n");
  chmodSync(valid, 0o755);
  chmodSync(invalid, 0o755);

  try {
    assert.deepEqual(await runSessionHistoryCli(["status", "--json"], { scriptPath: valid }), RECALL_RESULT);
    await assert.rejects(runSessionHistoryCli(["status", "--json"], { scriptPath: invalid }), /invalid result/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runSessionHistoryCli redacts credential shapes from failure details", async () => {
  const root = mkdtempSync(join(tmpdir(), "session-history-redact-"));
  const failing = join(root, "failing.py");
  writeFileSync(
    failing,
    "#!/usr/bin/env python3\nimport sys\nprint('boom xai-SUPERSECRET', file=sys.stderr)\nsys.exit(1)\n",
  );
  chmodSync(failing, 0o755);

  try {
    await assert.rejects(runSessionHistoryCli(["status", "--json"], { scriptPath: failing }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Session history request failed/);
      assert.match(error.message, /\[redacted\]/);
      assert.ok(!error.message.includes("xai-SUPERSECRET"));
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runSessionHistoryCli passes arguments verbatim without shell interpolation", async () => {
  const root = mkdtempSync(join(tmpdir(), "session-history-argv-"));
  const echo = join(root, "echo.py");
  writeFileSync(echo, "#!/usr/bin/env python3\nimport json, sys\nprint(json.dumps(sys.argv[1:]))\n");
  chmodSync(echo, 0o755);
  const args = ["recall", "--query", "what && who", "--session", "sess 1", "--json"];

  try {
    assert.deepEqual(await runSessionHistoryCli(args, { scriptPath: echo }), args);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runSessionHistoryCli terminates the child process when the host cancels", async () => {
  const root = mkdtempSync(join(tmpdir(), "session-history-cancel-"));
  const slow = join(root, "slow.py");
  writeFileSync(slow, "#!/usr/bin/env python3\nimport time\ntime.sleep(10)\n");
  chmodSync(slow, 0o755);
  const controller = new AbortController();
  const pending = runSessionHistoryCli(["status", "--json"], { scriptPath: slow, signal: controller.signal });
  controller.abort();

  try {
    await assert.rejects(pending, /cancelled/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runSessionHistoryCli merges custom environment variables", async () => {
  const root = mkdtempSync(join(tmpdir(), "session-history-env-"));
  const envScript = join(root, "env.py");
  writeFileSync(
    envScript,
    "#!/usr/bin/env python3\nimport json, os\nprint(json.dumps(os.environ.get('SESSION_HISTORY_FIXTURES_DIR')))\n",
  );
  chmodSync(envScript, 0o755);

  try {
    const value = await runSessionHistoryCli(["status", "--json"], {
      scriptPath: envScript,
      env: { SESSION_HISTORY_FIXTURES_DIR: "/tmp/fixtures" },
    });
    assert.equal(value, "/tmp/fixtures");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
