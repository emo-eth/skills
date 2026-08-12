import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const piBin = join(pluginRoot, "node_modules", ".bin", "pi");
const ompBin = join(pluginRoot, "node_modules", ".bin", "omp");

function run(binary: string, args: string[], input = ""): string {
  const result = spawnSync(binary, args, {
    cwd: pluginRoot,
    encoding: "utf8",
    input,
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function rpcLines(...commands: unknown[]): string {
  return `${commands.map((command) => JSON.stringify(command)).join("\n")}\n`;
}

function runExpiredBash(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: pluginRoot, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errorOutput = "";
    let sentBash = false;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`RPC host timed out:\n${errorOutput}\n${output}`));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { errorOutput += chunk; });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (!sentBash && /"id":"start"[^\n]+"success":true/.test(output)) {
        sentBash = true;
        setTimeout(() => {
          child.stdin.end(rpcLines({ id: "bash", type: "bash", command: "printf SHOULD_NOT_RUN" }));
        }, 10);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`RPC host exited ${code}:\n${errorOutput}\n${output}`));
      else resolve(output);
    });
    child.stdin.write(rpcLines({ id: "start", type: "prompt", message: "/wallclock start 1ms block-new" }));
  });
}

test("pinned Pi host loads, activates, reports, and blocks expired shell work", { timeout: 30_000 }, async () => {
  assert.equal(run(piBin, ["--version"]).trim(), "0.84.1");
  const sessionDir = mkdtempSync(join(tmpdir(), "wall-clock-pi-host-"));
  try {
    const output = run(piBin, [
      "--offline", "--mode", "rpc", "--no-extensions", "--no-skills", "--no-prompt-templates",
      "--no-context-files", "--no-approve", "--extension", join(pluginRoot, "src", "pi.ts"),
      "--session-dir", sessionDir,
    ], rpcLines(
      { id: "commands", type: "get_commands" },
      { id: "start", type: "prompt", message: "/wallclock start 2s block-new" },
      { id: "status", type: "prompt", message: "/wallclock status" },
    ));
    assert.match(output, /"name":"wallclock"/);
    assert.match(output, /Wall-clock active: active/);
    assert.match(output, /Latest tool-call elapsed: 0s \(0ms\)/);
    assert.match(output, /"id":"status"[^\n]+"success":true/);
    const blocked = await runExpiredBash(piBin, [
      "--offline", "--mode", "rpc", "--no-extensions", "--no-skills", "--no-prompt-templates",
      "--no-context-files", "--no-approve", "--extension", join(pluginRoot, "src", "pi.ts"),
      "--session-dir", sessionDir,
    ]);
    assert.match(blocked, /Wall-clock blocked this command: The wall-clock deadline has expired/);
    assert.match(blocked, /"exitCode":1,"cancelled":true/);
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
  }
});

test("pinned OMP host loads, activates, reports, and blocks expired shell work", { timeout: 30_000 }, async () => {
  assert.equal(run(ompBin, ["--version"]).trim(), "omp/17.2.15");
  const sessionDir = mkdtempSync(join(tmpdir(), "wall-clock-omp-host-"));
  try {
    const output = run(ompBin, [
      "--mode", "rpc", "--no-extensions", "--no-skills", "--no-rules",
      "--extension", join(pluginRoot, "src", "omp.ts"), "--session-dir", sessionDir,
    ], rpcLines(
      { id: "start", type: "prompt", message: "/wallclock start 2s block-new" },
      { id: "status", type: "prompt", message: "/wallclock status" },
    ));
    assert.match(output, /"name":"wallclock"/);
    assert.match(output, /Wall-clock active: active/);
    assert.match(output, /Latest tool-call elapsed: 0s \(0ms\)/);
    assert.match(output, /"id":"status"[^\n]+"success":true/);
    assert.doesNotMatch(output, /"agentInvoked":true/);
    const blocked = await runExpiredBash(ompBin, [
      "--mode", "rpc", "--no-extensions", "--no-skills", "--no-rules",
      "--extension", join(pluginRoot, "src", "omp.ts"), "--session-dir", sessionDir,
    ]);
    assert.match(blocked, /Wall-clock blocked this command: The wall-clock deadline has expired/);
    assert.match(blocked, /"exitCode":1,"cancelled":true/);
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
  }
});

test("OMP discovers the portable Agent Plugin skill and MCP tools", { timeout: 30_000 }, () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "wall-clock-agent-plugin-"));
  try {
    const output = run(ompBin, [
      "--mode", "rpc", "--no-extensions", "--no-rules", "--skills", "wall-clock",
      "--plugin-dir", pluginRoot, "--session-dir", sessionDir,
    ], rpcLines({ id: "tools", type: "prompt", message: "/tools" }));
    assert.match(output, /"name":"skill:wall-clock"/);
    assert.match(output, /mcp__wall_clock_wall_clock_wallclock_start/);
    assert.match(output, /mcp__wall_clock_wall_clock_wallclock_report/);
    assert.match(output, /"id":"tools"[^\n]+"agentInvoked":false/);
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
  }
});
