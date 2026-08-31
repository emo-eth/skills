import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFetchArgs,
  buildSearchArgs,
  installGrokTools,
  runGrokCli,
} from "../src/host.ts";
import type { GrokResult, GrokRunner, RuntimeHost } from "../src/host.ts";
import grokSearchOmpExtension from "../src/omp.ts";
import grokSearchPiExtension from "../src/pi.ts";

type ToolDefinition = {
  name: string;
  parameters: unknown;
  execute: (...args: unknown[]) => unknown;
};

class Host implements RuntimeHost {
  readonly tools = new Map<string, ToolDefinition>();

  registerTool(definition: ToolDefinition): void {
    this.tools.set(definition.name, definition);
  }
}

const RESULT: GrokResult = {
  model: "grok-4-fast",
  answer: "Source text",
  citations: [{ title: "Post", url: "https://x.com/i/status/1" }],
  degraded: false,
};

function resultValue(value: unknown): GrokResult {
  if (typeof value !== "object" || value === null || !("content" in value) || !Array.isArray(value.content)) {
    throw new Error("tool returned no content");
  }
  const item = value.content[0];
  if (typeof item !== "object" || item === null || !("text" in item) || typeof item.text !== "string") {
    throw new Error("tool returned no text");
  }
  return JSON.parse(item.text) as GrokResult;
}

for (const [name, adapter] of [
  ["Pi", grokSearchPiExtension],
  ["OMP", grokSearchOmpExtension],
] as const) {
  test(`${name} registers only X search and fetch tools`, () => {
    const host = new Host();
    adapter(host);
    assert.deepEqual([...host.tools.keys()], ["grok_search", "grok_fetch"]);
    for (const tool of host.tools.values()) assert.ok(tool.parameters);

    const schema = host.tools.get("grok_search")?.parameters;
    if (typeof schema !== "object" || schema === null || !("properties" in schema)) {
      throw new Error("grok_search has no parameter schema");
    }
    const properties = schema.properties;
    if (typeof properties !== "object" || properties === null) {
      throw new Error("grok_search has no properties");
    }
    assert.deepEqual(Object.keys(properties), [
      "query",
      "response",
      "handles",
      "excludeHandles",
      "from",
      "to",
      "images",
      "videos",
      "model",
    ]);
  });
}

test("grok_search defaults to source mode and forwards X filters and cancellation", async () => {
  const calls: Array<{ args: string[]; signal?: AbortSignal }> = [];
  const runner: GrokRunner = async (args, options) => {
    calls.push({ args, signal: options.signal });
    return RESULT;
  };
  const host = new Host();
  installGrokTools(host, { runner });
  const controller = new AbortController();

  const value = await host.tools.get("grok_search")?.execute("call-1", {
    query: "Recent posts",
    handles: ["@one", "@two"],
    from: "2026-08-01",
    images: true,
    model: "grok-test",
  }, controller.signal);

  assert.deepEqual(calls, [{
    args: [
      "x",
      "Recent posts",
      "--json",
      "--brief",
      "--handle",
      "@one",
      "--handle",
      "@two",
      "--from",
      "2026-08-01",
      "--images",
      "--model",
      "grok-test",
    ],
    signal: controller.signal,
  }]);
  assert.deepEqual(resultValue(value), RESULT);
});

test("search argument construction always targets X", () => {
  assert.deepEqual(buildSearchArgs({
    query: "Current reactions",
    response: "answer",
    excludeHandles: ["@noise"],
  }), [
    "x",
    "Current reactions",
    "--json",
    "--exclude-handle",
    "@noise",
  ]);

  assert.throws(
    () => buildSearchArgs({ query: "Bad", handles: ["@one"], excludeHandles: ["@two"] }),
    /cannot be combined/,
  );
});

test("fetch maps to the X CLI without shell interpolation", () => {
  assert.deepEqual(buildFetchArgs({
    url: "https://x.com/user/status/123",
    model: "grok-test",
  }), [
    "fetch",
    "https://x.com/user/status/123",
    "--json",
    "--model",
    "grok-test",
  ]);
});

test("runGrokCli parses structured output and rejects malformed output", async () => {
  const root = mkdtempSync(join(tmpdir(), "grok-tool-runner-"));
  const valid = join(root, "valid.py");
  const invalid = join(root, "invalid.py");
  writeFileSync(valid, `#!/usr/bin/env python3\nprint(${JSON.stringify(JSON.stringify(RESULT))})\n`);
  writeFileSync(invalid, "#!/usr/bin/env python3\nprint('not json')\n");
  chmodSync(valid, 0o755);
  chmodSync(invalid, 0o755);

  try {
    assert.deepEqual(await runGrokCli([], { scriptPath: valid }), RESULT);
    await assert.rejects(runGrokCli([], { scriptPath: invalid }), /invalid result/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runGrokCli terminates the child process when the host cancels", async () => {
  const root = mkdtempSync(join(tmpdir(), "grok-tool-cancel-"));
  const slow = join(root, "slow.py");
  writeFileSync(slow, "#!/usr/bin/env python3\nimport time\ntime.sleep(10)\n");
  chmodSync(slow, 0o755);
  const controller = new AbortController();
  const pending = runGrokCli([], { scriptPath: slow, signal: controller.signal });
  controller.abort();

  try {
    await assert.rejects(pending, /cancelled/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
