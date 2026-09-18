import { spawn } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type RestartTarget = {
  session: string | null;
  socket: string;
  kind?: "local" | "remote";
  label?: string;
  sshTarget?: string;
};

export type FleetTarget = {
  kind: "local" | "remote";
  label: string;
  session: string | null;
  socket?: string;
  sshTarget?: string;
};

export type WorkerRequest = {
  target: RestartTarget;
  targets?: FleetTarget[];
  scope?: "local" | "fleet";
  skipUpdates?: boolean;
  skipHerdrUpdate?: boolean;
  herdrBinary: string;
  cwd: string;
  activeLockPath?: string;
};

export type WorkerStatus = {
  phase: string;
  message: string;
  missing?: string[];
  error?: string;
};

export type NativeSessionRef = {
  agent: string;
  kind: "id" | "path";
  source: string;
  value: string;
};

export type SavedAgentSnapshot = {
  paneId: string;
  agent: string;
  nativeSession: NativeSessionRef;
};

export type UnsettledAgent = {
  paneId: string;
  name?: string;
  agent: string;
  status: string;
  cwd?: string;
};

export type AgentDrainDependencies = {
  read: () => Promise<UnsettledAgent[]>;
  delay: () => Promise<void>;
  onChange: (agents: UnsettledAgent[]) => void;
};

export type ExecResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type CommandRunner = (
  executable: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number },
) => Promise<ExecResult>;

export const AGENT_RESTORE_TIMEOUT_MS = 5 * 60 * 1000;

export type HardRestartDependencies = {
  request: WorkerRequest;
  jobDir: string;
  publishStatus: (status: WorkerStatus) => void;
  log: (message: string) => void;
  saveAgents: (agents: SavedAgentSnapshot[]) => void;
  run: CommandRunner;
  delay: (milliseconds: number) => Promise<void>;
  startServer: () => Promise<void>;
  startClient?: () => Promise<void>;
  updatePlugins: (
    run: (
      executable: string,
      args: string[],
      options?: { cwd?: string },
    ) => Promise<ExecResult>,
    herdrBinary: string,
    report: (message: string) => void,
  ) => Promise<void>;
  now: () => number;
};

export type FleetRestartDependencies = {
  request: WorkerRequest;
  jobDir: string;
  targets: FleetTarget[];
  publishStatus: (status: WorkerStatus) => void;
  log: (message: string) => void;
  run: CommandRunner;
  delay: (milliseconds: number) => Promise<void>;
  startServer?: (target: FleetTarget) => Promise<void>;
  startClient?: (target: FleetTarget) => Promise<void>;
  updatePlugins: HardRestartDependencies["updatePlugins"];
  now: () => number;
};

export function shellEscape(arg: string): string {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function createRemoteRunner(
  sshTarget: string,
  baseRunner: CommandRunner,
): CommandRunner {
  return async (executable, args, options) => {
    const remoteCmd = [executable, ...args].map(shellEscape).join(" ");
    const fullCmd = `export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"; ${remoteCmd}`;
    const sshArgs = [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      sshTarget,
      fullCmd,
    ];
    return baseRunner("ssh", sshArgs, options);
  };
}

export async function spawnRemoteServer(
  sshTarget: string,
  target: RestartTarget,
  baseRunner: CommandRunner,
): Promise<void> {
  const sessionArg = target.session !== null ? `--session ${shellEscape(target.session)} ` : "";
  const fullCmd = `export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"; nohup herdr ${sessionArg}server >/dev/null 2>&1 &`;
  const result = await baseRunner("ssh", [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    sshTarget,
    fullCmd,
  ]);
  if (result.status !== 0) {
    throw new Error(
      `failed to start remote server on ${sshTarget}: ${result.stderr || result.error || "exit " + result.status}`,
    );
  }
}

const SETTLED_AGENT_STATES: Record<string, true> = {
  idle: true,
  done: true,
};

const NESTED_HERDR_ENV_KEYS = [
  "HERDR_ENV",
  "HERDR_PANE_ID",
  "HERDR_TAB_ID",
  "HERDR_WORKSPACE_ID",
  "HERDR_PLUGIN_STATE_DIR",
] as const;

type HerdrStatus = {
  status?: unknown;
  running?: unknown;
  session?: unknown;
  socket?: unknown;
  capabilities?: {
    detached_server_daemon?: unknown;
    endpoint_protocol_generation?: unknown;
  };
};

type HerdrAgentListPayload = {
  result?: {
    agents?: unknown;
  };
};

type AgentListRecord = {
  pane_id?: unknown;
  name?: unknown;
  agent?: unknown;
  agent_status?: unknown;
  agent_session?: unknown;
  cwd?: unknown;
};

export function resolveHerdrBinary(injectedPath = process.env.HERDR_BIN_PATH): string {
  if (injectedPath) {
    try {
      accessSync(injectedPath, constants.X_OK);
      return injectedPath;
    } catch {
      // A server can outlive the development binary that launched it.
    }
  }
  return "herdr";
}

export function environmentOutsideHerdr(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...environment };
  for (const key of NESTED_HERDR_ENV_KEYS) {
    delete result[key];
  }
  for (const key of Object.keys(result)) {
    if (key.startsWith("HERDR_PLUGIN_")) {
      delete result[key];
    }
  }
  return result;
}

export function readRestartTarget(raw: string): RestartTarget {
  let status: HerdrStatus;
  try {
    status = JSON.parse(raw) as HerdrStatus;
  } catch {
    throw new Error("Herdr returned invalid server status JSON");
  }

  if (status.status !== "running" || status.running !== true) {
    throw new Error("a persistent Herdr server is not running");
  }
  if (status.capabilities?.detached_server_daemon !== true) {
    throw new Error("this Herdr server cannot launch a detached replacement server");
  }
  const generation = status.capabilities?.endpoint_protocol_generation;
  if (typeof generation !== "number" || generation < 1) {
    throw new Error("this Herdr server does not expose a supported endpoint protocol");
  }

  const session = status.session;
  if (session !== null && typeof session !== "string") {
    throw new Error("Herdr returned an invalid server session");
  }
  if (typeof status.socket !== "string" || status.socket.length === 0) {
    throw new Error("Herdr returned an invalid server socket");
  }

  return {
    session: session ?? null,
    socket: status.socket,
  };
}

export function readWorkerRequest(path: string): WorkerRequest {
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`invalid worker request at ${path}`);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("worker request must be an object");
  }
  const record = payload as Record<string, unknown>;
  const target = record.target;
  if (typeof target !== "object" || target === null || Array.isArray(target)) {
    throw new Error("worker request is missing target");
  }
  const targetRecord = target as Record<string, unknown>;
  const session = targetRecord.session;
  if (session !== null && typeof session !== "string") {
    throw new Error("worker request target.session must be null or a string");
  }
  if (typeof targetRecord.socket !== "string" || targetRecord.socket.length === 0) {
    throw new Error("worker request target.socket must be a non-empty string");
  }
  if (typeof record.herdrBinary !== "string" || record.herdrBinary.length === 0) {
    throw new Error("worker request herdrBinary must be a non-empty string");
  }
  if (typeof record.cwd !== "string" || record.cwd.length === 0) {
    throw new Error("worker request cwd must be a non-empty string");
  }
  const activeLockPath = record.activeLockPath;
  if (
    activeLockPath !== undefined &&
    (typeof activeLockPath !== "string" || activeLockPath.length === 0)
  ) {
    throw new Error("worker request activeLockPath must be a non-empty string when provided");
  }

  const scope =
    record.scope === "fleet" || record.scope === "local" ? record.scope : "local";
  const targets: FleetTarget[] = [];
  if (Array.isArray(record.targets)) {
    for (const rawItem of record.targets) {
      if (typeof rawItem === "object" && rawItem !== null && !Array.isArray(rawItem)) {
        const item = rawItem as Record<string, unknown>;
        const kind = item.kind === "remote" ? "remote" : "local";
        const label = typeof item.label === "string" && item.label.length > 0 ? item.label : kind;
        const session = typeof item.session === "string" ? item.session : null;
        const socket = typeof item.socket === "string" ? item.socket : undefined;
        const sshTarget = typeof item.sshTarget === "string" ? item.sshTarget : undefined;
        targets.push({ kind, label, session, socket, sshTarget });
      }
    }
  }

  const skipUpdates = record.skipUpdates === true;
  const skipHerdrUpdate = record.skipHerdrUpdate === true;

  return {
    target: {
      session: session ?? null,
      socket: targetRecord.socket,
      ...(targetRecord.kind === "remote" || targetRecord.kind === "local" ? { kind: targetRecord.kind } : {}),
      ...(typeof targetRecord.label === "string" ? { label: targetRecord.label } : {}),
      ...(typeof targetRecord.sshTarget === "string" ? { sshTarget: targetRecord.sshTarget } : {}),
    },
    herdrBinary: record.herdrBinary,
    cwd: record.cwd,
    scope,
    ...(skipUpdates ? { skipUpdates: true } : {}),
    ...(skipHerdrUpdate ? { skipHerdrUpdate: true } : {}),
    ...(targets.length > 0 ? { targets } : {}),
    ...(typeof activeLockPath === "string" ? { activeLockPath } : {}),
  };
}

export function writeStatusAtomic(jobDir: string, status: WorkerStatus): void {
  mkdirSync(jobDir, { recursive: true });
  const destination = join(jobDir, "status.json");
  const temporary = join(jobDir, `status.json.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`);
  renameSync(temporary, destination);
}

export function saveAgentsSnapshot(jobDir: string, agents: SavedAgentSnapshot[]): void {
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(join(jobDir, "agents.json"), `${JSON.stringify(agents, null, 2)}\n`);
}

export function targetEnvironment(
  base: NodeJS.ProcessEnv,
  target: RestartTarget,
): NodeJS.ProcessEnv {
  const env = environmentOutsideHerdr(base);
  env.HERDR_SOCKET_PATH = target.socket;
  if (target.session !== null) {
    env.HERDR_SESSION = target.session;
  } else {
    delete env.HERDR_SESSION;
  }
  return env;
}

export function herdrInvocationArgs(target: RestartTarget, command: string[]): string[] {
  if (target.session !== null) {
    return ["--session", target.session, ...command];
  }
  return command;
}

function nonBlankString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}

function nativeSessionKey(ref: NativeSessionRef): string {
  return `${ref.source}|${ref.kind}|${ref.value}`;
}

function assertRegularSessionFile(path: string, paneId: string): void {
  if (!existsSync(path)) {
    throw new Error(`pane ${paneId} native agent session path does not exist: ${path}`);
  }
  if (!statSync(path).isFile()) {
    throw new Error(`pane ${paneId} native agent session path is not a regular file: ${path}`);
  }
}

export function unsettledAgentsFromList(raw: string): UnsettledAgent[] {
  let payload: HerdrAgentListPayload;
  try {
    payload = JSON.parse(raw) as HerdrAgentListPayload;
  } catch {
    throw new Error("Herdr returned invalid agent-list JSON");
  }

  if (!Array.isArray(payload.result?.agents)) {
    throw new Error("Herdr returned an invalid agent-list response");
  }

  const unsettled: UnsettledAgent[] = [];
  for (const rawAgent of payload.result.agents) {
    if (typeof rawAgent !== "object" || rawAgent === null || Array.isArray(rawAgent)) {
      throw new Error("Herdr returned an invalid agent record");
    }
    const value = rawAgent as AgentListRecord;
    const paneId = value.pane_id;
    const agent = value.agent;
    const status = value.agent_status;
    if (typeof paneId !== "string" || typeof agent !== "string" || typeof status !== "string") {
      throw new Error("Herdr returned an incomplete agent record");
    }
    if (SETTLED_AGENT_STATES[status]) {
      continue;
    }

    unsettled.push({
      paneId,
      agent,
      status,
      ...(typeof value.name === "string" ? { name: value.name } : {}),
      ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}),
    });
  }
  return unsettled;
}

function parseNativeSessionRef(
  paneId: string,
  agent: string,
  rawSession: unknown,
  isLocal: boolean = true,
): NativeSessionRef {
  if (typeof rawSession !== "object" || rawSession === null || Array.isArray(rawSession)) {
    throw new Error(`pane ${paneId} is missing a recoverable native agent session`);
  }
  const record = rawSession as Record<string, unknown>;
  const sessionAgent = nonBlankString(
    record.agent,
    `pane ${paneId} has an empty native agent session agent`,
  );
  const source = nonBlankString(
    record.source,
    `pane ${paneId} has an empty native agent session source`,
  );
  const kind = record.kind;
  const value = nonBlankString(
    record.value,
    `pane ${paneId} has an empty native agent session value`,
  );
  if (sessionAgent !== agent) {
    throw new Error(`pane ${paneId} has a mismatched native agent session`);
  }
  if (source !== `herdr:${agent}`) {
    throw new Error(`pane ${paneId} has an unsupported native agent session source`);
  }
  if (kind !== "id" && kind !== "path") {
    throw new Error(`pane ${paneId} has an invalid native agent session kind`);
  }
  if (kind === "path" && isLocal) {
    assertRegularSessionFile(value, paneId);
  }
  return {
    agent,
    kind,
    source,
    value,
  };
}

export function captureNativeSessionRefs(raw: string, isLocal: boolean = true): SavedAgentSnapshot[] {
  let payload: HerdrAgentListPayload;
  try {
    payload = JSON.parse(raw) as HerdrAgentListPayload;
  } catch {
    throw new Error("Herdr returned invalid agent-list JSON");
  }
  if (!Array.isArray(payload.result?.agents)) {
    throw new Error("Herdr returned an invalid agent-list response");
  }

  const saved: SavedAgentSnapshot[] = [];
  const seenPaneIds = new Set<string>();
  const seenNativeRefs = new Map<string, string>();
  for (const rawAgent of payload.result.agents) {
    if (typeof rawAgent !== "object" || rawAgent === null || Array.isArray(rawAgent)) {
      throw new Error("Herdr returned an invalid agent record");
    }
    const record = rawAgent as AgentListRecord;
    const paneId = record.pane_id;
    const agent = record.agent;
    const status = record.agent_status;
    if (typeof paneId !== "string" || typeof agent !== "string" || typeof status !== "string") {
      throw new Error("Herdr returned an incomplete agent record");
    }
    if (!SETTLED_AGENT_STATES[status]) {
      throw new Error(`pane ${paneId} is not settled (${status})`);
    }
    if (seenPaneIds.has(paneId)) {
      throw new Error(`duplicate pane id in agent list: ${paneId}`);
    }
    seenPaneIds.add(paneId);
    const nativeSession = parseNativeSessionRef(paneId, agent, record.agent_session, isLocal);
    const nativeKey = nativeSessionKey(nativeSession);
    const otherPane = seenNativeRefs.get(nativeKey);
    if (otherPane !== undefined) {
      throw new Error(
        `duplicate native agent session across panes ${otherPane} and ${paneId}`,
      );
    }
    seenNativeRefs.set(nativeKey, paneId);
    saved.push({
      paneId,
      agent,
      nativeSession,
    });
  }
  return saved;
}

function nativeSessionMatches(
  expected: NativeSessionRef,
  current: unknown,
): boolean {
  if (typeof current !== "object" || current === null || Array.isArray(current)) {
    return false;
  }
  const record = current as Record<string, unknown>;
  return (
    record.agent === expected.agent &&
    record.source === expected.source &&
    record.kind === expected.kind &&
    record.value === expected.value
  );
}

function agentRecordIsRestored(
  snapshot: SavedAgentSnapshot,
  record: AgentListRecord | undefined,
): "restored" | "pending" | "missing" {
  if (record === undefined) {
    return "missing";
  }
  const agent = record.agent;
  const status = record.agent_status;
  if (typeof agent !== "string" || agent !== snapshot.agent) {
    return "pending";
  }
  if (typeof status !== "string" || status === "unknown" || !SETTLED_AGENT_STATES[status]) {
    return "pending";
  }
  if (nativeSessionMatches(snapshot.nativeSession, record.agent_session)) {
    return "restored";
  }
  return "pending";
}

export function restoredPaneIds(
  saved: SavedAgentSnapshot[],
  raw: string,
): { restored: string[]; pending: string[]; missing: string[] } {
  let payload: HerdrAgentListPayload;
  try {
    payload = JSON.parse(raw) as HerdrAgentListPayload;
  } catch {
    throw new Error("Herdr returned invalid agent-list JSON");
  }
  if (!Array.isArray(payload.result?.agents)) {
    throw new Error("Herdr returned an invalid agent-list response");
  }

  const currentByPane = new Map<string, AgentListRecord>();
  for (const rawAgent of payload.result.agents) {
    if (typeof rawAgent !== "object" || rawAgent === null || Array.isArray(rawAgent)) {
      continue;
    }
    const record = rawAgent as AgentListRecord;
    if (typeof record.pane_id === "string") {
      currentByPane.set(record.pane_id, record);
    }
  }

  const restored: string[] = [];
  const pending: string[] = [];
  const missing: string[] = [];
  for (const snapshot of saved) {
    const outcome = agentRecordIsRestored(snapshot, currentByPane.get(snapshot.paneId));
    if (outcome === "restored") {
      restored.push(snapshot.paneId);
    } else if (outcome === "pending") {
      pending.push(snapshot.paneId);
    } else {
      missing.push(snapshot.paneId);
    }
  }
  return { restored, pending, missing };
}

export async function waitForAgentDrain(
  dependencies: AgentDrainDependencies,
): Promise<void> {
  let consecutiveClearChecks = 0;
  let previousSignature = "";

  while (consecutiveClearChecks < 2) {
    const agents = await dependencies.read();
    if (agents.length === 0) {
      consecutiveClearChecks += 1;
      previousSignature = "";
    } else {
      consecutiveClearChecks = 0;
      const signature = JSON.stringify(agents);
      if (signature !== previousSignature) {
        dependencies.onChange(agents);
        previousSignature = signature;
      }
    }

    if (consecutiveClearChecks < 2) {
      await dependencies.delay();
    }
  }
}

function serverStatusMatchesTarget(raw: string, target: RestartTarget): boolean {
  try {
    const parsed = readRestartTarget(raw);
    const sessionMatches = parsed.session === target.session;
    const socketMatches =
      target.kind === "remote" || target.socket === "" || parsed.socket === target.socket;
    return sessionMatches && socketMatches;
  } catch {
    return false;
  }
}

function serverIsNotRunning(raw: string): boolean {
  let status: HerdrStatus;
  try {
    status = JSON.parse(raw) as HerdrStatus;
  } catch {
    return false;
  }
  return status.status === "not_running" || status.running === false;
}

function commandFailure(label: string, result: ExecResult): Error {
  const detailParts: string[] = [];
  if (result.stderr.trim()) {
    detailParts.push(result.stderr.trim());
  }
  if (result.stdout.trim()) {
    detailParts.push(result.stdout.trim());
  }
  if (result.error) {
    detailParts.push(result.error);
  }
  const detail = detailParts.join("\n\n") || "unknown command failure";
  const suffix = result.status === null ? "" : ` (exit ${result.status})`;
  return new Error(`${label} failed${suffix}:\n${detail}`);
}

function logCommandEvidence(
  deps: HardRestartDependencies,
  label: string,
  executable: string,
  args: string[],
  result: ExecResult,
): void {
  deps.log(`${label}: ${executable} ${args.join(" ")} (exit ${result.status ?? "null"})`);
  if (result.stdout.trim()) {
    deps.log(`${label} stdout:\n${result.stdout.trim()}`);
  }
  if (result.stderr.trim()) {
    deps.log(`${label} stderr:\n${result.stderr.trim()}`);
  }
}

async function runHerdr(
  deps: HardRestartDependencies,
  env: NodeJS.ProcessEnv,
  command: string[],
  label: string,
  timeoutMs = 120_000,
): Promise<ExecResult> {
  const args = herdrInvocationArgs(deps.request.target, command);
  const result = await deps.run(deps.request.herdrBinary, args, {
    env,
    cwd: deps.request.cwd,
    timeoutMs,
  });
  logCommandEvidence(deps, label, deps.request.herdrBinary, args, result);
  if (result.status !== 0) {
    throw commandFailure(label, result);
  }
  return result;
}

async function runUpdateCommand(
  deps: HardRestartDependencies,
  executable: string,
  args: string[],
  label: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 300_000,
): Promise<void> {
  const result = await deps.run(executable, args, { env, cwd: deps.request.cwd, timeoutMs });
  logCommandEvidence(deps, label, executable, args, result);
  if (result.status !== 0) {
    throw commandFailure(label, result);
  }
}

async function readAgentList(
  deps: HardRestartDependencies,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const result = await deps.run(
    deps.request.herdrBinary,
    herdrInvocationArgs(deps.request.target, ["agent", "list"]),
    { env, cwd: deps.request.cwd, timeoutMs: 30_000 },
  );
  if (result.status !== 0) {
    throw commandFailure("agent list", result);
  }
  return result.stdout;
}

function formatBlockingAgents(agents: UnsettledAgent[]): string {
  return agents
    .map((agent) => {
      const identity = agent.name || agent.paneId;
      const location = agent.cwd ? ` at ${agent.cwd}` : "";
      return `${identity}: ${agent.agent} is ${agent.status}${location}`;
    })
    .join("; ");
}

async function drainAndCaptureAgents(
  deps: HardRestartDependencies,
  targetEnv: NodeJS.ProcessEnv,
): Promise<SavedAgentSnapshot[]> {
  while (true) {
    await waitForAgentDrain({
      read: async () => unsettledAgentsFromList(await readAgentList(deps, targetEnv)),
      delay: async () => {
        await deps.delay(1_000);
      },
      onChange: (agents) => {
        const blocking = formatBlockingAgents(agents);
        deps.log(`Blocking agents: ${blocking}`);
        deps.publishStatus({
          phase: "draining-agents",
          message: `Waiting for active agents to become idle or done: ${blocking}`,
        });
      },
    });

    deps.publishStatus({
      phase: "capturing-agents",
      message: "Capturing recoverable native agent sessions",
    });
    const agentList = await readAgentList(deps, targetEnv);
    const unsettled = unsettledAgentsFromList(agentList);
    if (unsettled.length > 0) {
      const blocking = formatBlockingAgents(unsettled);
      deps.log(`Capture found unsettled agents; draining again: ${blocking}`);
      deps.publishStatus({
        phase: "draining-agents",
        message: `Agents became active again before capture: ${blocking}`,
      });
      continue;
    }
    return captureNativeSessionRefs(agentList, deps.request.target.kind !== "remote");
  }
}

function pluginUpdaterRunner(
  deps: HardRestartDependencies,
  env: NodeJS.ProcessEnv,
): (executable: string, args: string[], options?: { cwd?: string }) => Promise<ExecResult> {
  return async (executable, args, options) => {
    if (executable === deps.request.herdrBinary) {
      return deps.run(
        executable,
        herdrInvocationArgs(deps.request.target, args),
        { env, cwd: deps.request.cwd, timeoutMs: 300_000 },
      );
    }
    return deps.run(executable, args, {
      env,
      cwd: options?.cwd ?? deps.request.cwd,
      timeoutMs: 300_000,
    });
  };
}

async function waitForServerReady(
  deps: HardRestartDependencies,
  env: NodeJS.ProcessEnv,
  deadlineMs: number,
): Promise<void> {
  const deadline = deps.now() + deadlineMs;
  let polls = 0;
  while (deps.now() < deadline) {
    const result = await deps.run(
      deps.request.herdrBinary,
      herdrInvocationArgs(deps.request.target, ["status", "server", "--json"]),
      { env, cwd: deps.request.cwd, timeoutMs: 5_000 },
    );
    polls += 1;
    if (result.status === 0 && serverStatusMatchesTarget(result.stdout, deps.request.target)) {
      if (polls > 1) {
        deps.log(`Replacement server ready after ${polls} status polls`);
      }
      return;
    }
    if (polls === 1 || polls % 20 === 0) {
      deps.log(`Waiting for replacement server (${polls} polls)`);
    }
    await deps.delay(100);
  }
  throw new Error("replacement Herdr server did not become ready for the requested target");
}

async function waitForServerStopped(
  deps: HardRestartDependencies,
  env: NodeJS.ProcessEnv,
  deadlineMs: number,
): Promise<void> {
  const deadline = deps.now() + deadlineMs;
  let polls = 0;
  while (deps.now() < deadline) {
    const result = await deps.run(
      deps.request.herdrBinary,
      herdrInvocationArgs(deps.request.target, ["status", "server", "--json"]),
      { env, cwd: deps.request.cwd, timeoutMs: 5_000 },
    );
    polls += 1;
    if (result.status === 0 && serverIsNotRunning(result.stdout)) {
      if (polls > 1) {
        deps.log(`Server stopped after ${polls} status polls`);
      }
      return;
    }
    if (polls === 1 || polls % 20 === 0) {
      deps.log(`Waiting for server stop (${polls} polls)`);
    }
    await deps.delay(100);
  }
  throw new Error("Herdr server did not stop");
}

async function waitForAgentRestore(
  deps: HardRestartDependencies,
  env: NodeJS.ProcessEnv,
  saved: SavedAgentSnapshot[],
  deadlineMs: number,
  updateError?: Error,
): Promise<{ restored: string[]; missing: string[] }> {
  const deadline = deps.now() + deadlineMs;
  let polls = 0;
  while (deps.now() < deadline) {
    const raw = await readAgentList(deps, env);
    const progress = restoredPaneIds(saved, raw);
    polls += 1;
    if (progress.pending.length === 0 && progress.missing.length === 0) {
      return { restored: progress.restored, missing: [] };
    }
    if (polls === 1 || polls % 15 === 0) {
      const waiting = [...progress.pending, ...progress.missing];
      deps.publishStatus({
        phase: "awaiting-reconnect",
        message: `Waiting for native agent sessions to reconnect (${waiting.join(", ")})`,
        ...(updateError ? { error: updateError.message } : {}),
      });
    }
    await deps.delay(1_000);
  }
  const raw = await readAgentList(deps, env);
  const progress = restoredPaneIds(saved, raw);
  return {
    restored: progress.restored,
    missing: [...progress.pending, ...progress.missing],
  };
}

export function activeLockPathFor(request: WorkerRequest, jobDir: string): string {
  return request.activeLockPath ?? join(dirname(jobDir), "active");
}

export function releaseActiveLock(request: WorkerRequest, jobDir: string): void {
  const activeLockPath = activeLockPathFor(request, jobDir);
  const lockFile = join(activeLockPath, "job.json");
  if (!existsSync(lockFile)) {
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(lockFile, "utf8"));
  } catch {
    return;
  }
  const recorded =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).jobDir
      : undefined;
  if (recorded !== jobDir) {
    return;
  }
  rmSync(activeLockPath, { recursive: true, force: true });
}

const OFFICIAL_HERDR_VERSION =
  /^(?:v)?\d+\.\d+\.\d+(?:-preview(?:\.[A-Za-z0-9._-]+)?)?$/i;

export function parseHerdrVersionOutput(raw: string): string | undefined {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = trimmed.match(/(?:^herdr\s+)?(v?\d+\.\d+\.\d+\S*)/i);
    if (match?.[1]) {
      return match[1].replace(/^v/i, "");
    }
  }
  return undefined;
}

export function isOfficialHerdrReleaseVersion(version: string): boolean {
  return OFFICIAL_HERDR_VERSION.test(version.replace(/^v/i, ""));
}

export function isCargoTargetHerdrPath(path: string): boolean {
  return /(?:^|\/)target\/(?:release|debug)\/herdr(?:\.exe)?$/i.test(path.replaceAll("\\", "/"));
}

function skipUpdateMarkerBeside(herdrBinary: string): boolean {
  const candidate =
    herdrBinary.includes("/") || herdrBinary.includes("\\")
      ? herdrBinary
      : resolveHerdrBinary(herdrBinary);
  if (candidate === "herdr") {
    return false;
  }
  try {
    return existsSync(join(dirname(candidate), ".herdr-skip-update"));
  } catch {
    return false;
  }
}

export function isHerdrBinarySymlink(herdrBinary: string): boolean {
  try {
    const resolved = resolveHerdrBinary(herdrBinary);
    return lstatSync(resolved).isSymbolicLink();
  } catch {
    return false;
  }
}

async function herdrVersionSkipReason(
  deps: HardRestartDependencies,
  updateEnv: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  try {
    const result = await deps.run(deps.request.herdrBinary, ["--version"], {
      env: updateEnv,
      cwd: deps.request.cwd,
      timeoutMs: 10_000,
    });
    if (result.status !== 0) {
      return undefined;
    }
    const version = parseHerdrVersionOutput(result.stdout);
    if (version && !isOfficialHerdrReleaseVersion(version)) {
      return `herdr version is custom (${version})`;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export async function shouldSkipHerdrUpdate(
  deps: HardRestartDependencies,
  updateEnv: NodeJS.ProcessEnv,
): Promise<{ skip: boolean; reason?: string }> {
  if (
    deps.request.skipHerdrUpdate ||
    updateEnv.HERDR_SKIP_SELF_UPDATE === "1" ||
    process.env.HERDR_SKIP_SELF_UPDATE === "1"
  ) {
    return { skip: true, reason: "HERDR_SKIP_SELF_UPDATE or skipHerdrUpdate requested" };
  }
  if (isCargoTargetHerdrPath(deps.request.herdrBinary)) {
    return { skip: true, reason: "herdr binary is a cargo target build" };
  }
  if (skipUpdateMarkerBeside(deps.request.herdrBinary)) {
    return { skip: true, reason: "found .herdr-skip-update marker beside herdr binary" };
  }
  if (deps.request.target.kind === "remote") {
    try {
      const res = await deps.run(
        "sh",
        ["-c", 'test -L "$(command -v herdr 2>/dev/null || echo /dev/null)"'],
        {
          env: updateEnv,
          cwd: deps.request.cwd,
          timeoutMs: 10_000,
        },
      );
      if (res.status === 0) {
        return { skip: true, reason: "remote herdr binary is a symlink/custom build" };
      }
    } catch {
      // ignore
    }
  } else if (isHerdrBinarySymlink(deps.request.herdrBinary)) {
    return { skip: true, reason: "local herdr binary is a symlink/custom build" };
  }
  const versionReason = await herdrVersionSkipReason(deps, updateEnv);
  if (versionReason) {
    const scope = deps.request.target.kind === "remote" ? "remote" : "local";
    return { skip: true, reason: `${scope} ${versionReason}` };
  }
  return { skip: false };
}

async function runAllUpdates(
  deps: HardRestartDependencies,
  updateEnv: NodeJS.ProcessEnv,
): Promise<void> {
  const herdrCheck = await shouldSkipHerdrUpdate(deps, updateEnv);
  if (herdrCheck.skip) {
    deps.log(`Skipping herdr update: ${herdrCheck.reason}`);
  } else {
    await runHerdr(deps, updateEnv, ["update"], "Herdr update", 300_000);
  }
  await runUpdateCommand(deps, "omp", ["update"], "OMP update", updateEnv);
  await runUpdateCommand(deps, "omp", ["update", "--plugins"], "OMP plugin update", updateEnv);
  await runUpdateCommand(deps, "pi", ["update", "--all"], "Pi update", updateEnv);
  await deps.updatePlugins(
    pluginUpdaterRunner(deps, updateEnv),
    deps.request.herdrBinary,
    (message) => {
      deps.log(message);
      deps.publishStatus({
        phase: "updating",
        message,
      });
    },
  );
}

export async function runHardRestartPipeline(
  deps: HardRestartDependencies,
): Promise<WorkerStatus> {
  const targetEnv = targetEnvironment(process.env, deps.request.target);
  const updateEnv = targetEnv;
  let savedAgents: SavedAgentSnapshot[] = [];
  let updateError: Error | undefined;
  const initialStatus = await deps.run(
    deps.request.herdrBinary,
    herdrInvocationArgs(deps.request.target, ["status", "server", "--json"]),
    { env: targetEnv, cwd: deps.request.cwd, timeoutMs: 10_000 },
  );
  if (initialStatus.status !== 0 || !serverStatusMatchesTarget(initialStatus.stdout, deps.request.target)) {
    throw new Error("The selected Herdr server no longer matches the confirmed session and socket; nothing was stopped.");
  }

  deps.publishStatus({
    phase: "draining-agents",
    message: "Waiting for active agents to become idle or done",
  });
  savedAgents = await drainAndCaptureAgents(deps, targetEnv);
  deps.saveAgents(savedAgents);
  if (deps.request.skipUpdates) {
    deps.log("Skipping all updates as requested (--no-updates)");
    deps.publishStatus({
      phase: "restarting",
      message: "Hard restart requested without updates; preserving current runtimes and configs",
    });
  } else {
    try {
      deps.publishStatus({
        phase: "updating",
        message: "Updating runtimes and plugins before restarting Herdr",
      });
      await runAllUpdates(deps, updateEnv);
    } catch (error: unknown) {
      updateError = error instanceof Error ? error : new Error(String(error));
    }
    savedAgents = await drainAndCaptureAgents(deps, targetEnv);
    deps.saveAgents(savedAgents);
  }
  deps.publishStatus({
    phase: "stopping-server",
    message: "Stopping the Herdr server",
  });
  const stopArgs = herdrInvocationArgs(deps.request.target, ["server", "stop"]);
  const stopResult = await deps.run(
    deps.request.herdrBinary,
    stopArgs,
    { env: targetEnv, cwd: deps.request.cwd, timeoutMs: 30_000 },
  );
  if (stopResult.status !== 0) {
    throw commandFailure("server stop", stopResult);
  }

  try {
    logCommandEvidence(deps, "server stop", deps.request.herdrBinary, stopArgs, stopResult);
    await waitForServerStopped(deps, targetEnv, 30_000);
  } catch (error: unknown) {
    const stopError = error instanceof Error ? error : new Error(String(error));
    updateError = new Error([updateError?.message, stopError.message].filter(Boolean).join("\n\n"));
  } finally {
    try {
      await deps.startServer();
      deps.publishStatus({
        phase: "starting-server",
        message: "Starting replacement Herdr server",
      });
      await waitForServerReady(deps, targetEnv, 30_000);
    } catch (error: unknown) {
      const restartError = error instanceof Error ? error : new Error(String(error));
      const status: WorkerStatus = {
        phase: "failed",
        message: "Replacement Herdr server could not be started or verified",
        error: [restartError.message, updateError?.message].filter(Boolean).join("\n\n"),
      };
      deps.publishStatus(status);
      return status;
    }
  }

  if (deps.startClient && deps.request.target.kind !== "remote") {
    deps.publishStatus({
      phase: "starting-client",
      message: "Opening a replacement Herdr client",
    });
    try {
      await deps.startClient();
      deps.log("Replacement Herdr client launched");
    } catch (error: unknown) {
      const reattach = deps.request.target.session
        ? `herdr --session ${deps.request.target.session}`
        : "herdr";
      const message = error instanceof Error ? error.message : String(error);
      deps.log(`Client relaunch failed: ${message}. Reattach with: ${reattach}`);
    }
  }

  deps.publishStatus({
    phase: "awaiting-reconnect",
    message: "Waiting for native agent sessions to reconnect",
    ...(updateError ? { error: updateError.message } : {}),
  });

  const restore = await waitForAgentRestore(
    deps,
    targetEnvironment(process.env, deps.request.target),
    savedAgents,
    AGENT_RESTORE_TIMEOUT_MS,
    updateError,
  );

  if (restore.missing.length > 0) {
    const status: WorkerStatus = {
      phase: "failed",
      message: "Replacement server is running but some native agent sessions did not reconnect",
      missing: restore.missing,
      ...(updateError ? { error: updateError.message } : {}),
    };
    deps.publishStatus(status);
    return status;
  }

  if (updateError) {
    const status: WorkerStatus = {
      phase: "failed",
      message: "Replacement server is running and agents reconnected, but updates failed",
      error: updateError.message,
    };
    deps.publishStatus(status);
    return status;
  }

  const status: WorkerStatus = {
    phase: "complete",
    message: deps.request.skipUpdates
      ? "Herdr hard-restarted and native agent sessions reconnected (updates skipped)"
      : "Updates finished and native agent sessions reconnected",
  };
  deps.publishStatus(status);
  return status;
}

export type HerdrMachineRecord = {
  id: string;
  label: string;
  target: string;
  session: string;
  enabled: boolean;
  selected?: boolean;
};

export function discoverMeshTargets(
  herdrBinary: string,
  localTarget: RestartTarget,
  run: (cmd: string, args: string[]) => { status: number | null; stdout: string },
): FleetTarget[] {
  const targets: FleetTarget[] = [
    {
      kind: "local",
      label: "Local",
      session: localTarget.session,
      socket: localTarget.socket,
    },
  ];
  try {
    const res = run(herdrBinary, ["machine", "list", "--json"]);
    if (res.status === 0 && res.stdout.trim()) {
      const machines = JSON.parse(res.stdout) as HerdrMachineRecord[];
      for (const m of machines) {
        if (m.enabled && m.target) {
          targets.push({
            kind: "remote",
            label: m.label || m.target,
            sshTarget: m.target,
            session: m.session || "default",
          });
        }
      }
    }
  } catch {
    // If machine list fails, fall back to local only
  }
  return targets;
}

export async function runFleetRestartPipeline(
  deps: FleetRestartDependencies,
): Promise<WorkerStatus> {
  const targets = deps.targets;
  deps.log(`Starting fleet restart across ${targets.length} targets: ${targets.map((t) => t.label).join(", ")}`);
  deps.publishStatus({
    phase: "fleet-starting",
    message: `Starting fleet restart across ${targets.length} targets: ${targets.map((t) => t.label).join(", ")}`,
  });

  const targetStatuses = new Map<string, WorkerStatus>();
  const updateAggregateStatus = (label: string, status: WorkerStatus) => {
    targetStatuses.set(label, status);
    deps.publishStatus({
      phase: status.phase === "complete" ? "fleet-progress" : status.phase,
      message: `[${label}] ${status.message}`,
      ...(status.error ? { error: `[${label}] ${status.error}` } : {}),
    });
  };

  const tasks = targets.map(async (target) => {
    const isRemote = target.kind === "remote";
    const runner =
      isRemote && target.sshTarget
        ? createRemoteRunner(target.sshTarget, deps.run)
        : deps.run;
    const startServer = deps.startServer
      ? () => deps.startServer!(target)
      : isRemote && target.sshTarget
      ? () => spawnRemoteServer(target.sshTarget!, target as RestartTarget, deps.run)
      : () => spawnDetachedServer(deps.request.herdrBinary, target as RestartTarget, process.env);
    const targetRequest: WorkerRequest = {
      target: {
        kind: target.kind,
        label: target.label,
        session: target.session,
        socket: target.socket ?? "",
        sshTarget: target.sshTarget,
      },
      herdrBinary: deps.request.herdrBinary,
      cwd: deps.request.cwd,
      scope: "local",
      skipUpdates: deps.request.skipUpdates,
      skipHerdrUpdate: deps.request.skipHerdrUpdate,
    };

    const targetDeps: HardRestartDependencies = {
      request: targetRequest,
      jobDir: deps.jobDir,
      publishStatus: (st) => updateAggregateStatus(target.label, st),
      log: (msg) => deps.log(`[${target.label}] ${msg}`),
      saveAgents: () => {},
      run: runner,
      delay: deps.delay,
      startServer,
      startClient:
        target.kind !== "remote" && deps.startClient
          ? () => deps.startClient!(target)
          : undefined,
      updatePlugins: deps.updatePlugins,
      now: deps.now,
    };

    try {
      const result = await runHardRestartPipeline(targetDeps);
      targetStatuses.set(target.label, result);
      return { target, result };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const failedStatus: WorkerStatus = {
        phase: "failed",
        message: `Restart failed on ${target.label}`,
        error,
      };
      targetStatuses.set(target.label, failedStatus);
      return { target, result: failedStatus };
    }
  });

  const results = await Promise.all(tasks);
  const failures = results.filter((r) => r.result.phase !== "complete");

  if (failures.length > 0) {
    const failedNames = failures.map((f) => f.target.label).join(", ");
    const errorDetails = failures
      .map((f) => `[${f.target.label}] ${f.result.error || f.result.message}`)
      .join("\n");
    const finalStatus: WorkerStatus = {
      phase: "failed",
      message: `Fleet restart failed on: ${failedNames}`,
      error: errorDetails,
    };
    deps.publishStatus(finalStatus);
    return finalStatus;
  }

  const finalStatus: WorkerStatus = {
    phase: "complete",
    message: deps.request.skipUpdates
      ? `Fleet hard-restart completed successfully across all ${targets.length} machines (${targets.map((t) => t.label).join(", ")})`
      : `Fleet restart completed successfully across all ${targets.length} machines (${targets.map((t) => t.label).join(", ")})`,
  };
  deps.publishStatus(finalStatus);
  return finalStatus;
}

export function spawnDetachedServer(
  herdrBinary: string,
  target: RestartTarget,
  baseEnv: NodeJS.ProcessEnv,
): Promise<void> {
  const server = spawn(herdrBinary, herdrInvocationArgs(target, ["server"]), {
    detached: true,
    env: targetEnvironment(baseEnv, target),
    stdio: "ignore",
  });
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  server.once("error", reject);
  server.once("spawn", resolve);
  return promise.then(() => {
    server.unref();
  });
}

export type ClientLaunchPlan = {
  command: string;
  args: string[];
};

export function planClientLaunch(input: {
  platform: NodeJS.Platform;
  herdrBinary: string;
  attachArgs: string[];
  appExists?: (appPath: string) => boolean;
}): ClientLaunchPlan | undefined {
  const exists = input.appExists ?? ((path: string) => existsSync(path));
  const commandLine = [input.herdrBinary, ...input.attachArgs];
  const script = `exec ${commandLine.map(shellEscape).join(" ")}`;
  if (input.platform === "darwin") {
    if (exists("/Applications/Ghostty.app")) {
      return {
        command: "open",
        args: ["-na", "Ghostty.app", "--args", "-e", "/bin/zsh", "-lc", script],
      };
    }
    if (exists("/Applications/WezTerm.app")) {
      return {
        command: "/Applications/WezTerm.app/Contents/MacOS/wezterm",
        args: ["start", "--", ...commandLine],
      };
    }
    if (exists("/Applications/Alacritty.app")) {
      return {
        command: "open",
        args: ["-na", "Alacritty.app", "--args", "-e", "/bin/zsh", "-lc", script],
      };
    }
  }
  return undefined;
}

export async function spawnDetachedClient(
  herdrBinary: string,
  target: RestartTarget,
  baseEnv: NodeJS.ProcessEnv,
): Promise<void> {
  if (baseEnv.HERDR_SKIP_CLIENT_LAUNCH === "1" || process.env.HERDR_SKIP_CLIENT_LAUNCH === "1") {
    return;
  }
  const attachArgs = target.session ? ["--session", target.session] : [];
  const plan = planClientLaunch({
    platform: process.platform,
    herdrBinary,
    attachArgs,
  });
  if (!plan) {
    const reattach = target.session ? `herdr --session ${target.session}` : "herdr";
    throw new Error(`No GUI terminal available to relaunch the Herdr client. Run: ${reattach}`);
  }
  const client = spawn(plan.command, plan.args, {
    detached: true,
    env: targetEnvironment(baseEnv, target),
    stdio: "ignore",
  });
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  client.once("error", reject);
  client.once("spawn", resolve);
  await promise;
  client.unref();
}
