export type PlannedCommand = {
  label: string;
  executable: string;
  args: string[];
};

export type RefreshDependencies = {
  preflight: () => Promise<void>;
  run: (command: PlannedCommand) => Promise<void>;
  scheduleRestart: () => Promise<void>;
};

export type RestartDependencies = {
  delay: () => Promise<void>;
  stop: () => Promise<void>;
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

export function updatePlan(
  includeExtensions: boolean,
  herdrBinary = "herdr",
): PlannedCommand[] {
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
  commands.push({
    label: "Herdr",
    executable: herdrBinary,
    args: ["update"],
  });

  return commands;
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

export async function performRefresh(
  includeExtensions: boolean,
  herdrBinary: string,
  dependencies: RefreshDependencies,
): Promise<void> {
  await dependencies.preflight();
  for (const command of updatePlan(includeExtensions, herdrBinary)) {
    await dependencies.run(command);
  }
  await dependencies.scheduleRestart();
}

export async function restartHerdr(dependencies: RestartDependencies): Promise<void> {
  await dependencies.delay();
  await dependencies.stop();
  await dependencies.start();
  await dependencies.waitUntilReady();
}
