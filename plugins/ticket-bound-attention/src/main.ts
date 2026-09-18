import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  agentsFromCli,
  capture,
  helpText,
  parseCliArgs,
  parseCommand,
  workspaceFromCli,
  workspacesFromCli,
  type PluginDeps,
} from "./capture.ts";
import { desk } from "./desk.ts";
import { captureInputFromEnv } from "./event.ts";
import { funeral } from "./funeral.ts";
import { parseAssignedIssues, rank } from "./rank.ts";
import { shelve } from "./shelve.ts";
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

const ASSIGNED_ISSUES_QUERY = `query {
  viewer {
    assignedIssues(first: 100) {
      nodes {
        id
        identifier
        title
        url
        priority
        priorityLabel
        state { name type }
        parent { id identifier }
        team { key }
      }
    }
  }
}`;

export function createDeps(env: NodeJS.ProcessEnv = process.env): PluginDeps {
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
    async listAgents() {
      const result = await run(herdrBin, ["agent", "list"], env);
      return agentsFromCli(JSON.parse(result.stdout));
    },
    async closeWorkspace(id) {
      await run(herdrBin, ["workspace", "close", id], env);
    },
    async removeWorktree(workspaceId) {
      await run(herdrBin, ["worktree", "remove", "--workspace", workspaceId, "--trust-repository"], env);
    },
    async gitPorcelain(path) {
      const result = await run("git", ["-C", path, "status", "--porcelain"], env);
      return result.stdout;
    },
    async pathExists(path) {
      return existsSync(path);
    },
    async viewIssue(identifier) {
      const result = await run(linearBin, [
        "issue",
        "view",
        identifier,
        "--json",
        "--no-comments",
        "--no-pager",
      ], env);
      const payload = JSON.parse(result.stdout) as {
        identifier?: string;
        title?: string;
        url?: string;
        state?: { name?: string };
      };
      const state = payload.state?.name;
      if (!payload.identifier || !state) throw new Error(`linear issue view ${identifier} missing state`);
      return {
        identifier: payload.identifier,
        title: payload.title ?? identifier,
        state,
        url: payload.url ?? `https://linear.app/emo-eth/issue/${payload.identifier}`,
      };
    },
    async listAssignedIssues() {
      const result = await run(linearBin, ["api", "--paginate", ASSIGNED_ISSUES_QUERY], env);
      return parseAssignedIssues(JSON.parse(result.stdout));
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
  const deps = createDeps(env);
  const fromEvent = captureInputFromEnv(env);
  const workspaceId = parsed.workspaceId ?? fromEvent?.workspaceId ?? env.HERDR_WORKSPACE_ID;
  const path = parsed.path ?? fromEvent?.path;
  const input = {
    ...fromEvent,
    ...parsed,
    cwd: path || workspaceId ? undefined : process.cwd(),
    env,
    team: parsed.team ?? env.TICKET_BOUND_TEAM ?? "EMO",
  };
  if (command === "desk") {
    process.stdout.write(`${JSON.stringify(await desk(deps))}\n`);
    return;
  }
  if (command === "shelve") {
    process.stdout.write(`${JSON.stringify(await shelve(input, deps))}\n`);
    return;
  }
  if (command === "funeral") {
    process.stdout.write(`${JSON.stringify(await funeral(input, deps))}\n`);
    return;
  }
  if (command === "rank") {
    process.stdout.write(`${JSON.stringify(await rank(deps))}\n`);
    return;
  }
  const result = await capture(input, deps);
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
