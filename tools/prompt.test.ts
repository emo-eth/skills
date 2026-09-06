
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { rawChoice } from "./prompt.ts";

const toolsDir = dirname(fileURLToPath(import.meta.url));
const prioritizeCli = join(toolsDir, "prioritize-linear-tickets.ts");
const reviewCli = join(toolsDir, "review-model-callable-skills.ts");

type Normalize = (input: string) => string | "pause" | undefined;

function starNormalizeAction(value: string): string | "pause" | undefined {
  const answer = value.trim().toLowerCase();
  if (["s", "star"].includes(answer)) return "star";
  if (["d", "flag", "delete"].includes(answer)) return "flag";
  if (["n", "skip", "right"].includes(answer)) return "skip";
  if (["b", "back", "left"].includes(answer)) return "back";
  if (["q", "quit", "pause", "ctrl-c"].includes(answer)) return "pause";
  return undefined;
}

function binNormalizeYesNo(value: string): string | "pause" | undefined {
  const answer = value.trim().toLowerCase();
  if (["y", "yes", "right", "j"].includes(answer)) return "yes";
  if (["n", "no", "left", "k"].includes(answer)) return "no";
  if (["q", "quit", "pause", "ctrl-c"].includes(answer)) return "pause";
  return undefined;
}

function stubTtyStdin(): { restore: () => void } {
  const stdin = process.stdin as NodeJS.ReadStream & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  const originals = {
    isTTY: Object.getOwnPropertyDescriptor(stdin, "isTTY"),
    setRawMode: Object.getOwnPropertyDescriptor(stdin, "setRawMode"),
  };
  Object.defineProperty(stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(stdin, "setRawMode", {
    value: () => {},
    configurable: true,
  });
  return {
    restore: () => {
      for (const key of ["isTTY", "setRawMode"] as const) {
        const descriptor = originals[key];
        if (descriptor) {
          Object.defineProperty(stdin, key, descriptor);
        } else {
          delete (stdin as unknown as Record<string, unknown>)[key];
        }
      }
    },
  };
}

test("rawChoice sends TTY left-arrow input through the caller normalizer", async () => {
  const stub = stubTtyStdin();
  try {
    const pending = rawChoice("prompt: ", starNormalizeAction);
    process.stdin.emit("data", Buffer.from("\u001b[D"));
    assert.equal(await pending, "back");
  } finally {
    stub.restore();
  }
});

test("rawChoice sends TTY right-arrow input through the caller normalizer", async () => {
  const stub = stubTtyStdin();
  try {
    const pending = rawChoice("prompt: ", binNormalizeYesNo);
    process.stdin.emit("data", Buffer.from("\u001b[C"));
    assert.equal(await pending, "yes");
  } finally {
    stub.restore();
  }
});

test("rawChoice sends OC/OD application cursor keycodes through the caller normalizer", async () => {
  const stub = stubTtyStdin();
  try {
    const pendingLeft = rawChoice("prompt: ", starNormalizeAction);
    process.stdin.emit("data", Buffer.from("\u001bOD"));
    assert.equal(await pendingLeft, "back");
    const pendingRight = rawChoice("prompt: ", binNormalizeYesNo);
    process.stdin.emit("data", Buffer.from("\u001bOC"));
    assert.equal(await pendingRight, "yes");
  } finally {
    stub.restore();
  }
});

type RunOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdinData: string;
  keepStdinOpen: boolean;
  timeoutMs: number;
};

type RunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

async function runNode(
  script: string,
  args: string[],
  options: RunOptions,
): Promise<RunResult> {
  const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
  const controller = new AbortController();
  const abortSignal = AbortSignal.timeout(options.timeoutMs);
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      script,
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
  if (options.keepStdinOpen) {
    child.stdin?.write(options.stdinData);
  } else {
    child.stdin?.end(options.stdinData);
  }
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

async function createFixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "prompt-regression-"));
  const binDir = join(root, "bin");
  await mkdir(binDir);
  await writeFile(
    join(binDir, "linear"),
    [
      "#!/bin/sh",
      'echo "$@" >> "$LINEAR_CALL_LOG"',
      'echo "fixture stub must not be invoked" >&2',
      "exit 1",
    ].join("\n"),
    { mode: 0o755 },
  );
  return root;
}

test("prioritize --bin --input runs from a local fixture without invoking the linear CLI", async () => {
  const root = await createFixtureRoot();
  try {
    const callLog = join(root, "linear-calls.log");
    const inputPath = join(root, "tickets.json");
    await writeFile(
      inputPath,
      JSON.stringify([
        {
          id: "BIN-1",
          title: "Triage me",
          description: "No priority yet.",
          state: "Backlog",
          priority: 0,
        },
      ]),
    );
    const result = await runNode(
      prioritizeCli,
      [
        "--bin",
        "--input",
        inputPath,
        "--state",
        join(root, "state.json"),
        "--output",
        join(root, "top-k.json"),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
          LINEAR_CALL_LOG: callLog,
          NO_COLOR: "1",
        },
        stdinData: "q\n",
        keepStdinOpen: false,
        timeoutMs: 15000,
      },
    );
    assert.equal(
      result.signal,
      null,
      `killed, stdout: ${result.stdout} stderr: ${result.stderr}`,
    );
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    let calls = "";
    try {
      calls = await readFile(callLog, "utf8");
    } catch {
      calls = "";
    }
    assert.equal(calls, "", `linear stub was invoked: ${calls}`);
    assert.match(result.stdout, /Binning 1 ticket\(s\)/);
    assert.match(result.stdout, /BIN-1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review-model-callable-skills --help exits with an open stdin pipe", async () => {
  const result = await runNode(reviewCli, ["--help"], {
    cwd: tmpdir(),
    env: { ...process.env, NO_COLOR: "1" },
    stdinData: "",
    keepStdinOpen: true,
    timeoutMs: 15000,
  });
  assert.equal(
    result.signal,
    null,
    `help hung on open stdin and was killed: ${result.stderr}`,
  );
  assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
  assert.match(result.stdout, /Usage:/);
});
