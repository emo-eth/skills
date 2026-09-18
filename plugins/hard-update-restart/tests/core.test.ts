import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  captureNativeSessionRefs,
  createRemoteRunner,
  discoverMeshTargets,
  restoredPaneIds,
  runFleetRestartPipeline,
  runHardRestartPipeline,
  shellEscape,
  shouldSkipHerdrUpdate,
  isOfficialHerdrReleaseVersion,
  parseHerdrVersionOutput,
  isCargoTargetHerdrPath,
  planClientLaunch,
  type CommandRunner,
  type FleetTarget,
  type HardRestartDependencies,
  type WorkerStatus,
} from "../src/core.ts";

const session = { agent: "omp", source: "herdr:omp", kind: "id", value: "conversation-a" };
const agent = { pane_id: "w1:p1", agent: "omp", agent_status: "idle", agent_session: session };
const list = (agents: unknown[]) => JSON.stringify({ result: { agents } });

const fakeHerdr = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const root = process.env.RESTART_TEST_ROOT;
const path = root + '/server.json';
const state = JSON.parse(readFileSync(path, 'utf8'));
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('herdr 0.9.0'); process.exit(0); }
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
      env: { ...process.env, PATH: `${root}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`, HERDR_ENV: "1", HERDR_SOCKET_PATH: "/wrong.sock", HERDR_SESSION: "wrong", HERDR_SKIP_CLIENT_LAUNCH: "1", RESTART_TEST_ROOT: root, RESTART_TEST_SCENARIO: scenario },
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

test("shellEscape correctly handles safe and unsafe characters", () => {
  assert.equal(shellEscape("simple"), "simple");
  assert.equal(shellEscape("/path/to/file.json"), "/path/to/file.json");
  assert.equal(shellEscape("with spaces"), "'with spaces'");
  assert.equal(shellEscape("foo'bar"), "'foo'\\''bar'");
  assert.equal(shellEscape(""), "''");
});

test("discoverMeshTargets extracts local and enabled remote machines", () => {
  const local = { session: "default", socket: "/tmp/herdr.sock" };
  const mockMachineList = JSON.stringify([
    { id: "1", label: "spark0", target: "spark0", session: "default", enabled: true },
    { id: "2", label: "disabled-node", target: "disabled", session: "default", enabled: false },
    { id: "3", label: "mbp-16-24", target: "mbp-16-24", session: "custom", enabled: true },
  ]);
  const targets = discoverMeshTargets("herdr", local, () => ({
    status: 0,
    stdout: mockMachineList,
  }));
  assert.equal(targets.length, 3);
  assert.deepEqual(targets[0], { kind: "local", label: "Local", session: "default", socket: "/tmp/herdr.sock" });
  assert.deepEqual(targets[1], { kind: "remote", label: "spark0", sshTarget: "spark0", session: "default" });
  assert.deepEqual(targets[2], { kind: "remote", label: "mbp-16-24", sshTarget: "mbp-16-24", session: "custom" });
});

test("createRemoteRunner wraps commands into SSH invocation", async () => {
  const recorded: { executable: string; args: string[] }[] = [];
  const mockRunner: CommandRunner = async (executable, args) => {
    recorded.push({ executable, args });
    return { status: 0, stdout: "ok\n", stderr: "" };
  };
  const runner = createRemoteRunner("spark0", mockRunner);
  const res = await runner("herdr", ["--session", "default", "agent", "list"]);
  assert.equal(res.status, 0);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].executable, "ssh");
  assert.equal(recorded[0].args[0], "-o");
  assert.equal(recorded[0].args[1], "BatchMode=yes");
  assert.equal(recorded[0].args[4], "spark0");
  assert.match(recorded[0].args[5], /export PATH=/);
  assert.match(recorded[0].args[5], /herdr --session default agent list/);
});

test("captureNativeSessionRefs with isLocal false skips local file check", () => {
  const remoteSession = { agent: "omp", source: "herdr:omp", kind: "path", value: "/remote/path/to/session.jsonl" };
  const remoteAgent = { pane_id: "w1:p1", agent: "omp", agent_status: "idle", agent_session: remoteSession };
  // On local, this throws because /remote/path does not exist locally
  assert.throws(() => captureNativeSessionRefs(list([remoteAgent]), true), /does not exist/);
  // With isLocal: false, it successfully captures the remote session ref
  const saved = captureNativeSessionRefs(list([remoteAgent]), false);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].nativeSession.value, "/remote/path/to/session.jsonl");
});

test("runFleetRestartPipeline coordinates multiple targets and aggregates completion", async () => {
  const targets: FleetTarget[] = [
    { kind: "local", label: "Local", session: "default", socket: "/tmp/test.sock" },
    { kind: "remote", label: "spark0", sshTarget: "spark0", session: "default" },
  ];
  const statuses: WorkerStatus[] = [];
  const logs: string[] = [];
  const serverState = new Map<string, boolean>([
    ["Local", true],
    ["spark0", true],
  ]);
  const mockRunner: CommandRunner = async (cmd, args) => {
    const full = `${cmd} ${args.join(" ")}`;
    const label = full.includes("spark0") ? "spark0" : "Local";
    if (full.includes("server stop")) {
      serverState.set(label, false);
      return { status: 0, stdout: "ok\n", stderr: "" };
    }
    if (full.includes("status server --json")) {
      const isRunning = serverState.get(label) !== false;
      return {
        status: 0,
        stdout: JSON.stringify({
          status: isRunning ? "running" : "not_running",
          running: isRunning,
          session: "default",
          socket: "/tmp/test.sock",
          capabilities: { detached_server_daemon: true, endpoint_protocol_generation: 1 },
        }),
        stderr: "",
      };
    }
    if (full.includes("agent list")) {
      return { status: 0, stdout: list([agent]), stderr: "" };
    }
    return { status: 0, stdout: "ok\n", stderr: "" };
  };
  let fakeTime = 1000;
  const finalStatus = await runFleetRestartPipeline({
    request: {
      target: { session: "default", socket: "/tmp/local.sock" },
      targets,
      scope: "fleet",
      herdrBinary: "herdr",
      cwd: "/tmp",
    },
    jobDir: "/tmp",
    targets,
    publishStatus: (st) => statuses.push(st),
    log: (msg) => logs.push(msg),
    run: mockRunner,
    delay: async () => {},
    startServer: async (t) => {
      serverState.set(t.label, true);
    },
    updatePlugins: async () => {},
    now: () => {
      fakeTime += 10;
      return fakeTime;
    },
  });


  assert.equal(finalStatus.phase, "complete");
  assert.match(finalStatus.message, /Fleet restart completed successfully/);
  assert.equal(statuses.some((s) => s.message.includes("[Local]")), true);
  assert.equal(statuses.some((s) => s.message.includes("[spark0]")), true);
});

test("official herdr versions are stable or preview; custom suffixes are not", () => {
  assert.equal(isOfficialHerdrReleaseVersion("0.9.0"), true);
  assert.equal(isOfficialHerdrReleaseVersion("0.9.0-preview"), true);
  assert.equal(isOfficialHerdrReleaseVersion("0.9.0-preview.abc123"), true);
  assert.equal(isOfficialHerdrReleaseVersion("0.9.0-bandwidth-fix"), false);
  assert.equal(parseHerdrVersionOutput("herdr 0.9.0-bandwidth-fix\n"), "0.9.0-bandwidth-fix");
  assert.equal(isCargoTargetHerdrPath("/Users/emo/dev/herdr/target/release/herdr"), true);
  assert.equal(isCargoTargetHerdrPath("/Users/emo/.local/bin/herdr"), false);
});

test("planClientLaunch prefers Ghostty on macOS", () => {
  const plan = planClientLaunch({
    platform: "darwin",
    herdrBinary: "/Users/emo/.local/bin/herdr",
    attachArgs: ["--session", "proof"],
    appExists: (path) => path === "/Applications/Ghostty.app",
  });
  assert.ok(plan);
  assert.equal(plan.command, "open");
  assert.deepEqual(plan.args.slice(0, 5), ["-na", "Ghostty.app", "--args", "-e", "/bin/zsh"]);
  assert.match(plan.args.at(-1)!, /exec \/Users\/emo\/.local\/bin\/herdr --session proof/);
});

test("shouldSkipHerdrUpdate honors env var and remote symlink check", async () => {
  const baseRequest = {
    target: { session: "default", socket: "/tmp/sock" },
    herdrBinary: "herdr",
    cwd: "/tmp",
  };
  const dummyDeps = (
    isRemote: boolean,
    isSymlink: boolean,
    version = "herdr 0.9.0\n",
  ): HardRestartDependencies => ({
    request: {
      ...baseRequest,
      target: { ...baseRequest.target, kind: isRemote ? "remote" : "local" },
    },
    jobDir: "/tmp",
    publishStatus: () => {},
    log: () => {},
    saveAgents: () => {},
    run: async (_cmd, args) => {
      if (args.join(" ").includes("test -L")) {
        return { status: isSymlink ? 0 : 1, stdout: "", stderr: "" };
      }
      if (args.includes("--version")) {
        return { status: 0, stdout: version, stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
    delay: async () => {},
    startServer: async () => {},
    updatePlugins: async () => {},
    now: () => 1000,
  });

  const envCheck = await shouldSkipHerdrUpdate(dummyDeps(false, false), {
    HERDR_SKIP_SELF_UPDATE: "1",
  });
  assert.equal(envCheck.skip, true);

  const remoteSymlinkCheck = await shouldSkipHerdrUpdate(dummyDeps(true, true), {});
  assert.equal(remoteSymlinkCheck.skip, true);
  assert.match(remoteSymlinkCheck.reason!, /symlink/);

  const remoteRegularCheck = await shouldSkipHerdrUpdate(dummyDeps(true, false), {});
  assert.equal(remoteRegularCheck.skip, false);

  const customVersion = await shouldSkipHerdrUpdate(
    dummyDeps(false, false, "herdr 0.9.0-bandwidth-fix\n"),
    {},
  );
  assert.equal(customVersion.skip, true);
  assert.match(customVersion.reason!, /0\.9\.0-bandwidth-fix/);

  const cargoBuild = await shouldSkipHerdrUpdate(
    {
      ...dummyDeps(false, false),
      request: {
        ...baseRequest,
        herdrBinary: "/tmp/herdr/target/release/herdr",
      },
    },
    {},
  );
  assert.equal(cargoBuild.skip, true);
  assert.match(cargoBuild.reason!, /cargo target/);
});

test("runHardRestartPipeline with skipUpdates: true restarts server and restores agents without running updates", async () => {
  const commandsRun: string[] = [];
  let pluginsUpdated = false;
  let clientStarted = false;
  let isServerRunning = true;

  const mockRunner: CommandRunner = async (cmd, args) => {
    const full = `${cmd} ${args.join(" ")}`;
    commandsRun.push(full);
    if (full.includes("server stop")) {
      isServerRunning = false;
      return { status: 0, stdout: "ok\n", stderr: "" };
    }
    if (full.includes("status server --json")) {
      return {
        status: 0,
        stdout: JSON.stringify({
          status: isServerRunning ? "running" : "not_running",
          running: isServerRunning,
          session: "default",
          socket: "/tmp/sock",
          capabilities: { detached_server_daemon: true, endpoint_protocol_generation: 1 },
        }),
        stderr: "",
      };
    }
    if (full.includes("agent list")) {
      return { status: 0, stdout: list([agent]), stderr: "" };
    }
    return { status: 0, stdout: "ok\n", stderr: "" };
  };

  let time = 1000;
  const status = await runHardRestartPipeline({
    request: {
      target: { session: "default", socket: "/tmp/sock" },
      herdrBinary: "herdr",
      cwd: "/tmp",
      skipUpdates: true,
    },
    jobDir: "/tmp",
    publishStatus: () => {},
    log: () => {},
    saveAgents: () => {},
    run: mockRunner,
    delay: async () => {},
    startServer: async () => {
      isServerRunning = true;
    },
    startClient: async () => {
      clientStarted = true;
    },
    updatePlugins: async () => {
      pluginsUpdated = true;
    },
    now: () => {
      time += 10;
      return time;
    },
  });

  assert.equal(status.phase, "complete");
  assert.match(status.message, /updates skipped/);
  assert.equal(pluginsUpdated, false);
  assert.equal(clientStarted, true);
  assert.equal(commandsRun.some((c) => c.includes("update")), false);
  assert.equal(commandsRun.some((c) => c.includes("server stop")), true);
});

test("custom herdr version skips herdr update but still restarts server and client", async () => {
  const commandsRun: string[] = [];
  let clientStarted = false;
  let isServerRunning = true;

  const mockRunner: CommandRunner = async (cmd, args) => {
    const full = `${cmd} ${args.join(" ")}`;
    commandsRun.push(full);
    if (args.includes("--version")) {
      return { status: 0, stdout: "herdr 0.9.0-bandwidth-fix\n", stderr: "" };
    }
    if (full.includes("server stop")) {
      isServerRunning = false;
      return { status: 0, stdout: "ok\n", stderr: "" };
    }
    if (full.includes("status server --json")) {
      return {
        status: 0,
        stdout: JSON.stringify({
          status: isServerRunning ? "running" : "not_running",
          running: isServerRunning,
          session: "default",
          socket: "/tmp/sock",
          capabilities: { detached_server_daemon: true, endpoint_protocol_generation: 1 },
        }),
        stderr: "",
      };
    }
    if (full.includes("agent list")) {
      return { status: 0, stdout: list([agent]), stderr: "" };
    }
    return { status: 0, stdout: "ok\n", stderr: "" };
  };

  let time = 1000;
  const status = await runHardRestartPipeline({
    request: {
      target: { session: "default", socket: "/tmp/sock" },
      herdrBinary: "herdr",
      cwd: "/tmp",
    },
    jobDir: "/tmp",
    publishStatus: () => {},
    log: () => {},
    saveAgents: () => {},
    run: mockRunner,
    delay: async () => {},
    startServer: async () => {
      isServerRunning = true;
    },
    startClient: async () => {
      clientStarted = true;
    },
    updatePlugins: async () => {},
    now: () => {
      time += 10;
      return time;
    },
  });

  assert.equal(status.phase, "complete");
  assert.equal(clientStarted, true);
  assert.equal(commandsRun.some((c) => c.includes("server stop")), true);
  assert.equal(commandsRun.some((c) => c.includes("--version")), true);
  assert.equal(
    commandsRun.some((c) => c.includes("update") && !c.includes("omp") && !c.includes("pi")),
    false,
  );
});
