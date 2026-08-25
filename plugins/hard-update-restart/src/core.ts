import { accessSync, constants } from "node:fs";

export type PlannedCommand = {
  label: string;
  executable: string;
  args: string[];
};

export type AgentDrainPhase = "before_updates" | "before_restart";

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

export type RefreshDependencies = {
  preflight: () => Promise<void>;
  waitForAgents: (phase: AgentDrainPhase) => Promise<void>;
  run: (command: PlannedCommand) => Promise<void>;
  scheduleRestart: () => Promise<void>;
};

export type RestartDependencies = {
  delay: () => Promise<void>;
  stop: () => Promise<void>;
  update: () => Promise<void>;
  start: () => Promise<void>;
  waitUntilReady: () => Promise<void>;
};

type HerdrStatus = {
  status?: unknown;
  running?: unknown;
  capabilities?: {
    detached_server_daemon?: unknown;
  };
};

type HerdrAgentListPayload = {
  result?: {
    agents?: unknown;
  };
};

const SETTLED_AGENT_STATES: Record<string, true> = {
  idle: true,
  done: true,
};

export function updatePlan(includeExtensions: boolean): PlannedCommand[] {
  const commands: PlannedCommand[] = [
    { label: "OMP", executable: "omp", args: ["update"] },
  ];

  if (includeExtensions) {
    commands.push({
      label: "OMP plugins",
      executable: "omp",
      args: ["update", "--plugins"],
    });
  }

  commands.push({
    label: includeExtensions ? "Pi and extensions" : "Pi",
    executable: "pi",
    args: includeExtensions ? ["update", "--all"] : ["update", "--self"],
  });

  return commands;
}

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
  const result = { ...environment };
  delete result.HERDR_ENV;
  return result;
}

export function assertRestartableServerStatus(raw: string): void {
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
    const value = rawAgent as {
      pane_id?: unknown;
      name?: unknown;
      agent?: unknown;
      agent_status?: unknown;
      cwd?: unknown;
    };
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

export async function performRefresh(
  includeExtensions: boolean,
  dependencies: RefreshDependencies,
): Promise<void> {
  await dependencies.preflight();
  await dependencies.waitForAgents("before_updates");
  for (const command of updatePlan(includeExtensions)) {
    await dependencies.run(command);
  }
  await dependencies.waitForAgents("before_restart");
  await dependencies.scheduleRestart();
}

export async function restartHerdr(dependencies: RestartDependencies): Promise<void> {
  await dependencies.delay();
  await dependencies.stop();

  let updateFailed = false;
  let updateError: unknown;
  try {
    await dependencies.update();
  } catch (error: unknown) {
    updateFailed = true;
    updateError = error;
  }

  await dependencies.start();
  await dependencies.waitUntilReady();

  if (updateFailed) {
    throw updateError;
  }
}
