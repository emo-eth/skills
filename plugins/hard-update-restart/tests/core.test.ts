import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { captureNativeSessionRefs, restoredPaneIds } from "../src/core.ts";

const session = { agent: "omp", source: "herdr:omp", kind: "id", value: "conversation-a" };
const agent = { pane_id: "w1:p1", agent: "omp", agent_status: "idle", agent_session: session };
const list = (agents: unknown[]) => JSON.stringify({ result: { agents } });

const fakeHerdr = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const root = process.env.RESTART_TEST_ROOT;
const path = root + '/server.json';
const state = JSON.parse(readFileSync(path, 'utf8'));
const args = process.argv.slice(2);
if (args.shift() !== '--session' || args.shift() !== 'proof' || process.env.HERDR_SOCKET_PATH !== root + '/proof.sock') process.exit(93);
const command = args.join(' ');
const save = () => writeFileSync(path, JSON.stringify(state));
if (command === 'status server --json') {
  console.log(JSON.stringify({status:state.running?'running':'not_running',running:state.running,session:'proof',socket:root+'/proof.sock',capabilities:state.running?{detached_server_daemon:true,endpoint_protocol_generation:1}:null}));
} else if (command === 'agent list') {
  const agent = {pane_id:'w1:p1',agent:'omp',agent_status:'idle'};
  if (process.env.RESTART_TEST_SCENARIO !== 'missing') agent.agent_session = {agent:'omp',source:'herdr:omp',kind:'id',value:'conversation-a'};
  console.log(JSON.stringify({result:{agents:[agent]}}));
} else if (command === 'update') {
  if (process.env.HERDR_ENV === '1' || !state.running) process.exit(91);
  state.herdrUpdated = true;
  save();
} else if (command === 'plugin list --json') {
  if (!state.running) process.exit(94);
  console.log(JSON.stringify({result:{plugins:[]}}));
} else if (command === 'server stop') {
  state.running = false;
  state.stops++;
  save();
} else if (command === 'server') {
  state.running = true;
  state.generation++;
  save();
} else {
  console.error('unexpected Herdr command: '+command);
  process.exit(92);
}
`;

const fakeRuntime = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
const path = process.env.RESTART_TEST_ROOT + '/server.json';
const state = JSON.parse(readFileSync(path, 'utf8'));
if (!state.running || process.env.HERDR_ENV === '1') process.exit(95);
const runtime = basename(process.argv[1]);
if (runtime === 'omp' && process.env.RESTART_TEST_SCENARIO === 'update-failure') {
  console.error('forced runtime update failure');
  process.exit(1);
}
state.updated.push(runtime + ' ' + process.argv.slice(2).join(' '));
writeFileSync(path, JSON.stringify(state));
`;

async function runWorker(scenario: string) {
  const root = await mkdtemp(join(tmpdir(), "restart-worker-"));
  const jobDir = join(root, "job");
  const activeLockPath = join(root, "active");
  const helper = fileURLToPath(new URL("../src/restart-helper.ts", import.meta.url));
  try {
    await mkdir(jobDir);
    await mkdir(activeLockPath);
    await writeFile(join(root, "server.json"), JSON.stringify({ running: true, generation: 0, stops: 0, herdrUpdated: false, updated: [] }));
    await writeFile(join(activeLockPath, "job.json"), JSON.stringify({ jobDir }));
    for (const [name, source] of [["herdr", fakeHerdr], ["omp", fakeRuntime], ["pi", fakeRuntime]]) {
      await writeFile(join(root, name), source);
      await chmod(join(root, name), 0o755);
    }
    await writeFile(join(jobDir, "request.json"), JSON.stringify({
      target: { session: "proof", socket: join(root, "proof.sock") },
      herdrBinary: join(root, "herdr"), cwd: root, activeLockPath,
    }));
    const child = spawn(process.execPath, ["--experimental-strip-types", helper, jobDir], {
      env: { ...process.env, PATH: `${root}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`, HERDR_ENV: "1", HERDR_SOCKET_PATH: "/wrong.sock", HERDR_SESSION: "wrong", RESTART_TEST_ROOT: root, RESTART_TEST_SCENARIO: scenario },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk.toString(); });
    child.stderr.on("data", chunk => { output += chunk.toString(); });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    const status = JSON.parse(await readFile(join(jobDir, "status.json"), "utf8"));
    const state = JSON.parse(await readFile(join(root, "server.json"), "utf8"));
    const log = await readFile(join(jobDir, "output.log"), "utf8");
    await assert.rejects(readFile(join(activeLockPath, "job.json")), { code: "ENOENT" });
    return { code, status, state, evidence: `${output}\n${log}\n${JSON.stringify(status)}` };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("combined worker updates outside Herdr and replaces only the confirmed session", { timeout: 15_000 }, async () => {
  const result = await runWorker("success");
  assert.equal(result.code, 0, result.evidence);
  assert.equal(result.status.phase, "complete", result.evidence);
  assert.equal(result.state.running, true);
  assert.equal(result.state.generation, 1);
  assert.equal(result.state.stops, 1);
  assert.equal(result.state.herdrUpdated, true);
  assert.deepEqual(new Set(result.state.updated), new Set(["omp update", "omp update --plugins", "pi update --all"]));
});

test("runtime update failure still restores the server and remains a failure", { timeout: 15_000 }, async () => {
  const result = await runWorker("update-failure");
  assert.equal(result.code, 1, result.evidence);
  assert.equal(result.status.phase, "failed", result.evidence);
  assert.match(result.status.error, /forced runtime update failure/);
  assert.equal(result.state.running, true);
  assert.equal(result.state.generation, 1);
});

test("missing conversation identity prevents both updates and shutdown", { timeout: 15_000 }, async () => {
  const result = await runWorker("missing");
  assert.equal(result.code, 1, result.evidence);
  assert.equal(result.status.phase, "failed", result.evidence);
  assert.match(result.status.error, /missing a recoverable native agent session/);
  assert.equal(result.state.running, true);
  assert.equal(result.state.generation, 0);
  assert.equal(result.state.stops, 0);
  assert.equal(result.state.herdrUpdated, false);
  assert.deepEqual(result.state.updated, []);
});

test("duplicate, empty, and busy native sessions cannot be captured", () => {
  assert.throws(() => captureNativeSessionRefs(list([agent, { ...agent, pane_id: "w1:p2" }])), /duplicate native agent session/);
  assert.throws(() => captureNativeSessionRefs(list([{ ...agent, agent_session: { ...session, value: " " } }])), /empty native agent session/);
  assert.throws(() => captureNativeSessionRefs(list([{ ...agent, agent_status: "working" }])), /not settled/);
});

test("path references must identify an existing regular session file", async () => {
  const root = await mkdtemp(join(tmpdir(), "restart-session-"));
  const path = join(root, "conversation.jsonl");
  const pathAgent = { ...agent, agent_session: { ...session, kind: "path", value: path } };
  try {
    assert.throws(() => captureNativeSessionRefs(list([pathAgent])), /does not exist/);
    await mkdir(path);
    assert.throws(() => captureNativeSessionRefs(list([pathAgent])), /regular file/);
    await rm(path, { recursive: true });
    await writeFile(path, "{}\n");
    assert.equal(captureNativeSessionRefs(list([pathAgent])).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stale session reference is not sufficient evidence of recovery", () => {
  const saved = captureNativeSessionRefs(list([agent]));
  for (const record of [
    { ...agent, agent: "codex" },
    { ...agent, agent_status: "unknown" },
    { ...agent, agent_session: { ...session, value: "other-conversation" } },
  ]) {
    assert.deepEqual(restoredPaneIds(saved, list([record])).restored, []);
  }
  assert.deepEqual(restoredPaneIds(saved, list([agent])).restored, ["w1:p1"]);
});
