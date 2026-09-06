
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fetchAssignedNotCompleted } from "./linear-client.ts";

const toolsDir = dirname(fileURLToPath(import.meta.url));
const cli = join(toolsDir, "prioritize-linear-tickets.ts");

type RunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

type RunOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdinData: string;
  timeoutMs: number;
};

async function runCli(args: string[], options: RunOptions): Promise<RunResult> {
  const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
  const controller = new AbortController();
  const abortSignal = AbortSignal.timeout(options.timeoutMs);
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      cli,
      ...args,
    ],
    {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      signal: controller.signal,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.stdin?.end(options.stdinData);
  child.on("error", (error) => {
    reject(error);
  });
  child.on("close", (code, signal) => {
    resolve({ code, signal, stdout, stderr });
  });
  const abortListener = () => controller.abort();
  abortSignal.addEventListener("abort", abortListener, { once: true });
  try {
    return await promise;
  } finally {
    abortSignal.removeEventListener("abort", abortListener);
  }
}

async function writeFakeLinear(root: string): Promise<void> {
  const binDir = join(root, "bin");
  await writeFile(
    join(binDir, "linear"),
    `#!/bin/sh
set -e
LOG="$LINEAR_FAKE_LOG"
STATE="$LINEAR_FAKE_STATE"
if [ "$1" = "api" ]; then
  exec node -e '
    const fs = require("fs");
    const db = JSON.parse(fs.readFileSync(process.env.LINEAR_FAKE_STATE, "utf8"));
    const payload = {
      data: {
        viewer: {
          assignedIssues: {
            nodes: db.tickets.map((t) => ({
              id: t.id,
              identifier: t.id,
              title: t.title,
              priority: t.priority,
              state: { name: "Todo", type: "triage" },
              team: { key: "NAT" },
            })),
          },
        },
      },
    };
    process.stdout.write(JSON.stringify(payload));
  '
fi
if [ "$1" = "issue" ]; then
  id="$3"
  priority="$5"
  echo "update $id priority $priority" >> "$LOG"
  if [ "$LINEAR_FAIL_UPDATE_INDEX" = "$(($(wc -l < "$LOG")))" ]; then
    echo "simulated linear failure" >&2
    exit 1
  fi
  node -e '
    const fs = require("fs");
    const db = JSON.parse(fs.readFileSync(process.env.LINEAR_FAKE_STATE, "utf8"));
    const ticket = db.tickets.find((t) => t.id === process.argv[1]);
    ticket.priority = Number(process.argv[2]);
    fs.writeFileSync(process.env.LINEAR_FAKE_STATE, JSON.stringify(db));
  ' "$id" "$priority"
  exit 0
fi
exit 1
`,
    { mode: 0o755 },
  );
}

type FakeDb = {
  tickets: Array<{ id: string; title: string; priority?: number }>;
};

async function createRoot(db: FakeDb): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "prioritize-regression-"));
  await mkdir(join(root, "bin"), { recursive: true });
  await writeFakeLinear(root);
  await writeFile(join(root, "db.json"), JSON.stringify(db));
  await writeFile(join(root, "log"), "");
  return root;
}

function childEnv(root: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
    LINEAR_FAKE_STATE: join(root, "db.json"),
    LINEAR_FAKE_LOG: join(root, "log"),
    NO_COLOR: "1",
    ...extra,
  };
}

async function readLog(root: string): Promise<string[]> {
  const content = await readFile(join(root, "log"), "utf8");
  return content.split("\n").filter(Boolean);
}

test("fetchAssignedNotCompleted returns an empty list when Linear has no assigned issues", async () => {
  const root = await createRoot({ tickets: [] });
  const previousPath = process.env.PATH;
  process.env.PATH = `${join(root, "bin")}:${previousPath ?? ""}`;
  process.env.LINEAR_FAKE_STATE = join(root, "db.json");
  try {
    const tickets = await fetchAssignedNotCompleted();
    assert.deepEqual(tickets, []);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    delete process.env.LINEAR_FAKE_STATE;
    await rm(root, { recursive: true, force: true });
  }
});

test("empty Linear assignment runs the bin CLI without any update calls", async () => {
  const root = await createRoot({ tickets: [] });
  try {
    const result = await runCli(["--bin", "--state", join(root, "state.json")], {
      cwd: root,
      env: childEnv(root, {}),
      stdinData: "",
      timeoutMs: 15000,
    });
    assert.equal(result.signal, null, `killed: ${result.stderr}`);
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    assert.deepEqual(await readLog(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bin apply checkpoint resumes only the failed update on rerun", async () => {
  const root = await createRoot({
    tickets: [
      { id: "NAT-1", title: "First triage ticket", priority: 0 },
      { id: "NAT-2", title: "Second triage ticket", priority: 0 },
    ],
  });
  try {
    const stateFile = join(root, "state.json");
    const first = await runCli(["--bin", "--state", stateFile], {
      cwd: root,
      env: childEnv(root, { LINEAR_FAIL_UPDATE_INDEX: "2" }),
      stdinData: "y\ny\ny\ny\nAPPLY\n",
      timeoutMs: 15000,
    });
    assert.equal(first.code, 1, `stdout: ${first.stdout} stderr: ${first.stderr}`);
    const savedState = JSON.parse(await readFile(stateFile, "utf8")) as {
      applying?: { updates: Record<string, number> };
    };
    assert.deepEqual(savedState.applying?.updates, { "NAT-2": 1 });
    await writeFile(join(root, "log"), "");

    const second = await runCli(["--bin", "--state", stateFile], {
      cwd: root,
      env: childEnv(root, {}),
      stdinData: "",
      timeoutMs: 15000,
    });
    assert.equal(second.signal, null, `killed: ${second.stderr}`);
    assert.equal(second.code, 0, `stdout: ${second.stdout} stderr: ${second.stderr}`);
    const calls = await readLog(root);
    assert.deepEqual(calls, ["update NAT-2 priority 1"]);
    await assert.rejects(readFile(stateFile, "utf8"), /ENOENT/);
    const db = JSON.parse(await readFile(join(root, "db.json"), "utf8")) as {
      tickets: Array<{ id: string; priority: number }>;
    };
    assert.deepEqual(
      db.tickets.map((ticket) => ticket.priority),
      [1, 1],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("top-k apply checkpoint resumes only the failed update on rerun", async () => {
  const root = await createRoot({
    tickets: [
      { id: "NAT-1", title: "Alpha ticket", priority: 0 },
      { id: "NAT-2", title: "Beta ticket", priority: 0 },
      { id: "NAT-3", title: "Gamma ticket", priority: 0 },
    ],
  });
  try {
    const stateFile = join(root, "state.json");
    const first = await runCli(
      ["--top", "2", "--priority", "1", "--state", stateFile],
      {
        cwd: root,
        env: childEnv(root, { LINEAR_FAIL_UPDATE_INDEX: "2" }),
        stdinData: "l\nl\nl\nAPPLY\n",
        timeoutMs: 15000,
      },
    );
    assert.equal(first.code, 1, `stdout: ${first.stdout} stderr: ${first.stderr}`);
    const savedState = JSON.parse(await readFile(stateFile, "utf8")) as {
      applying?: { updates: Record<string, number> };
      comparisons: Record<string, string>;
    };
    assert.equal(Object.keys(savedState.applying?.updates ?? {}).length, 1);
    assert.equal(
      Object.values(savedState.applying?.updates ?? {})[0],
      1,
    );
    const appliedFirst = Object.keys(savedState.comparisons).length > 0;
    assert.ok(appliedFirst);
    const firstLog = await readLog(root);
    assert.equal(firstLog.length, 2);
    const failedId = firstLog[1]!.split(" ")[1]!;
    await writeFile(join(root, "log"), "");

    const second = await runCli(
      ["--top", "2", "--priority", "1", "--state", stateFile],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "",
        timeoutMs: 15000,
      },
    );
    assert.equal(second.signal, null, `killed: ${second.stderr}`);
    assert.equal(second.code, 0, `stdout: ${second.stdout} stderr: ${second.stderr}`);
    assert.deepEqual(await readLog(root), [`update ${failedId} priority 1`]);
    await assert.rejects(readFile(stateFile, "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
