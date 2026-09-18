import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { updatePlugins } from "../../plugin-updater/src/core.ts";
import {
  readWorkerRequest,
  releaseActiveLock,
  resolveHerdrBinary,
  runFleetRestartPipeline,
  runHardRestartPipeline,
  saveAgentsSnapshot,
  spawnDetachedClient,
  spawnDetachedServer,
  writeStatusAtomic,
  type CommandRunner,
  type ExecResult,
  type WorkerRequest,
  type WorkerStatus,
} from "./core.ts";

const jobDir = process.argv[2];
if (!jobDir) {
  console.error("usage: restart-helper.ts <job-dir>");
  process.exit(1);
}

const requestPath = join(jobDir, "request.json");
const logPath = join(jobDir, "output.log");

function appendLog(message: string): void {
  mkdirSync(jobDir, { recursive: true });
  appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
}

function publishStatus(status: WorkerStatus): void {
  writeStatusAtomic(jobDir, status);
  appendLog(`${status.phase}: ${status.message}`);
  if (status.error) {
    appendLog(`error:\n${status.error}`);
  }
  if (status.missing?.length) {
    appendLog(`missing panes: ${status.missing.join(", ")}`);
  }
}

function runCommand(
  executable: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number },
): Promise<ExecResult> {
  const { promise, resolve } = Promise.withResolvers<ExecResult>();
  const child = spawn(executable, args, {
    cwd: options?.cwd,
    env: options?.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(
    () => child.kill("SIGKILL"),
    options?.timeoutMs ?? 120_000,
  );
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.once("error", (error: Error) => {
    clearTimeout(timer);
    resolve({ status: null, stdout, stderr, error: error.message });
  });
  child.once("close", (code: number | null) => {
    clearTimeout(timer);
    resolve({ status: code, stdout, stderr });
  });
  return promise;
}

function delay(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
}

let request: WorkerRequest | undefined;
try {
  request = readWorkerRequest(requestPath);
  const herdrBinary = resolveHerdrBinary(request.herdrBinary);
  publishStatus({
    phase: "starting",
    message: "Hard update restart worker started",
  });

  let finalStatus: WorkerStatus;
  if (request.scope === "fleet" && request.targets && request.targets.length > 1) {
    finalStatus = await runFleetRestartPipeline({
      request: { ...request, herdrBinary },
      jobDir,
      targets: request.targets,
      publishStatus,
      log: appendLog,
      run: runCommand as CommandRunner,
      delay,
      updatePlugins,
      startClient: async (target) => {
        if (target.kind === "remote") {
          return;
        }
        await spawnDetachedClient(
          herdrBinary,
          {
            session: target.session,
            socket: target.socket ?? "",
            kind: "local",
            label: target.label,
          },
          process.env,
        );
      },
      now: () => Date.now(),
    });
  } else {
    finalStatus = await runHardRestartPipeline({
      request: { ...request, herdrBinary },
      jobDir,
      publishStatus,
      log: appendLog,
      saveAgents: (agents) => {
        saveAgentsSnapshot(jobDir, agents);
      },
      run: runCommand as CommandRunner,
      delay,
      startServer: async () => {
        await spawnDetachedServer(herdrBinary, request!.target, process.env);
      },
      startClient: async () => {
        await spawnDetachedClient(herdrBinary, request!.target, process.env);
      },
      updatePlugins,
      now: () => Date.now(),
    });
  }
  if (finalStatus.phase !== "complete") {
    process.exitCode = 1;
  }
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? `\n${error.stack}` : "";
  publishStatus({
    phase: "failed",
    message: "Hard update restart worker failed",
    error: `${message}${stack}`,
  });
  process.exitCode = 1;
} finally {
  if (request) {
    releaseActiveLock(request, jobDir);
  }
}
