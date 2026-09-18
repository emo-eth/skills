import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  capture,
  helpText,
  parseCliArgs,
  parseCommand,
  workspaceFromCli,
  workspacesFromCli,
  type CaptureDeps,
} from "./capture.ts";
import { captureInputFromEnv } from "./event.ts";
import { parseCreatedIssue } from "./ticket.ts";

const EXTRA_BIN_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  join(homedir(), ".local/bin"),
];

export function resolveBin(name: string, env: NodeJS.ProcessEnv, override?: string): string {
  if (override?.trim()) return override;
  const dirs = [
    ...(env.PATH ?? "").split(":").filter(Boolean),
    ...EXTRA_BIN_DIRS,
  ];
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

function spawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const path = [...EXTRA_BIN_DIRS, env.PATH ?? ""].filter(Boolean).join(":");
  return { ...env, PATH: path };
}
export function createDeps(env: NodeJS.ProcessEnv = process.env): CaptureDeps {
  const herdrBin = resolveBin("herdr", env, env.HERDR_BIN_PATH);
  const linearBin = resolveBin("linear", env, env.LINEAR_BIN);
  return {
    async readFile(path) {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return undefined;
        throw error;
      }
    },
    writeFile(path, contents) {
      return writeFile(path, contents, "utf8");
    },
    async createIssue(input) {
      const dir = await mkdtemp(join(tmpdir(), "ticket-bound-"));
      const file = join(dir, "description.md");
      await writeFile(file, input.description, "utf8");
      try {
        const result = await run(linearBin, [
          "issue",
          "create",
          "--no-interactive",
          "--no-use-default-template",
          "--team",
          input.team,
          "--assignee",
          "self",
          "--title",
          input.title,
          "--description-file",
          file,
        ], env);
        return parseCreatedIssue(`${result.stdout}\n${result.stderr}`);
      } finally {
        await unlink(file).catch(() => undefined);
      }
    },
    async getWorkspace(id) {
      const result = await run(herdrBin, ["workspace", "get", id], env);
      return workspaceFromCli(JSON.parse(result.stdout), id);
    },
    async listWorkspaces() {
      const result = await run(herdrBin, ["workspace", "list"], env);
      return workspacesFromCli(JSON.parse(result.stdout));
    },
    async reportTicket(workspaceId, identifier) {
      await run(herdrBin, [
        "workspace",
        "report-metadata",
        workspaceId,
        "--source",
        "ticket-bound-attention",
        "--seq",
        String(Date.now()),
        "--token",
        `ticket=${identifier}`,
      ], env);
    },
  };
}

async function main(): Promise<void> {
  const env = process.env;
  const command = parseCommand(process.argv, env);
  const parsed = parseCliArgs(process.argv);
  if (parsed.help) {
    process.stdout.write(helpText());
    return;
  }
  if (command === "skip") return;
  if (command !== "capture") {
    throw new Error(`action ${command} is not in this slice`);
  }
  const fromEvent = captureInputFromEnv(env);
  const workspaceId = parsed.workspaceId ?? fromEvent?.workspaceId ?? env.HERDR_WORKSPACE_ID;
  const path = parsed.path ?? fromEvent?.path;
  const result = await capture(
    {
      ...fromEvent,
      ...parsed,
      cwd: path || workspaceId ? undefined : process.cwd(),
      env,
      team: parsed.team ?? env.TICKET_BOUND_TEAM ?? "EMO",
    },
    createDeps(env),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function run(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ stdout: string; stderr: string }>();
  const child = spawn(executable, args, { env: spawnEnv(env), stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.once("error", (error: Error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once("close", (code: number | null) => {
    clearTimeout(timer);
    if (code !== 0) {
      reject(new Error(`${executable} ${args.join(" ")} failed (${code}): ${stderr.trim() || stdout.trim()}`));
      return;
    }
    resolve({ stdout, stderr });
  });
  return promise;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    console.error("ticket-bound-attention:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
