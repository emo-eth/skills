import { spawn } from "node:child_process";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  capture,
  helpText,
  parseCliArgs,
  workspaceFromCli,
  workspacesFromCli,
  type CaptureDeps,
} from "./capture.ts";
import { parseCreatedIssue } from "./ticket.ts";

const herdrBin = process.env.HERDR_BIN_PATH ?? "herdr";
const linearBin = process.env.LINEAR_BIN ?? "linear";

export function createDeps(env: NodeJS.ProcessEnv = process.env): CaptureDeps {
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
  const parsed = parseCliArgs(process.argv);
  if (parsed.help) {
    process.stdout.write(helpText());
    return;
  }
  const result = await capture(
    { ...parsed, cwd: process.cwd(), env: process.env, team: parsed.team ?? process.env.TICKET_BOUND_TEAM ?? "EMO" },
    createDeps(),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function run(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ stdout: string; stderr: string }>();
  const child = spawn(executable, args, { env, stdio: ["ignore", "pipe", "pipe"] });
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
