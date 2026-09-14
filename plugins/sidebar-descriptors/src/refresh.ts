import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

const execHerdr = promisify(execFile);
const binary = process.env.HERDR_BIN_PATH ?? "herdr";
const options = { timeout: 10_000, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" as const };
const tokenNames = ["space", "worktree"] as const;
type Tokens = Record<(typeof tokenNames)[number], string | undefined>;

type Workspace = {
  workspace_id: string;
  label: string;
  worktree?: { repo_name: string; checkout_path: string; is_linked_worktree: boolean } | null;
};
type Pane = { pane_id: string; workspace_id: string; tokens?: Record<string, string> | null };
type SnapshotResponse = { result?: { snapshot?: { workspaces: Workspace[]; panes: Pane[] } } };

function normalizeToken(value: string): string | undefined {
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return Array.from(text).slice(0, 80).join("") || undefined;
}

function workspaceTokens(value: Workspace): [string, Tokens] {
  if (typeof value?.workspace_id !== "string" || typeof value?.label !== "string") {
    throw new Error("Snapshot contains an invalid workspace");
  }
  const worktree = value.worktree;
  if (worktree == null) {
    return [value.workspace_id, { space: normalizeToken(value.label), worktree: undefined }];
  }
  if (
    typeof worktree.repo_name !== "string"
    || typeof worktree.checkout_path !== "string"
    || typeof worktree.is_linked_worktree !== "boolean"
  ) {
    throw new Error(`Workspace ${value.workspace_id} has invalid checkout metadata`);
  }
  return [value.workspace_id, {
    space: normalizeToken(worktree.repo_name),
    worktree: normalizeToken(worktree.is_linked_worktree ? basename(worktree.checkout_path) : "primary checkout"),
  }];
}

function paneClosed(error: unknown): boolean {
  const failure = error as { stderr?: unknown } | null;
  if (typeof failure?.stderr !== "string") return false;
  try {
    return JSON.parse(failure.stderr).error?.code === "pane_not_found";
  } catch {
    return false;
  }
}

async function refresh(): Promise<void> {
  if (!process.env.HERDR_SOCKET_PATH) throw new Error("HERDR_SOCKET_PATH is required");
  const sequence = String(Date.now());
  const { stdout } = await execHerdr(binary, ["api", "snapshot"], options);
  const response = JSON.parse(stdout) as SnapshotResponse;
  const snapshot = response?.result?.snapshot;
  if (!Array.isArray(snapshot?.workspaces) || !Array.isArray(snapshot?.panes)) {
    throw new Error("Herdr response is missing workspace and pane snapshots");
  }
  const workspaces = new Map(snapshot.workspaces.map(workspaceTokens));
  const reports: string[][] = [];
  for (const pane of snapshot.panes) {
    if (typeof pane?.pane_id !== "string" || typeof pane?.workspace_id !== "string") {
      throw new Error("Snapshot contains an invalid pane");
    }
    const desired = workspaces.get(pane.workspace_id);
    if (!desired) throw new Error(`Pane ${pane.pane_id} references an unknown workspace`);
    if (pane.tokens != null && (typeof pane.tokens !== "object" || Array.isArray(pane.tokens))) {
      throw new Error(`Pane ${pane.pane_id} has invalid metadata tokens`);
    }
    const changes: string[] = [];
    for (const name of tokenNames) {
      const current = pane.tokens?.[name];
      if (current !== undefined && typeof current !== "string") {
        throw new Error(`Pane ${pane.pane_id} has an invalid ${name} token`);
      }
      if (current === desired[name]) continue;
      if (desired[name] === undefined) changes.push("--clear-token", name);
      else changes.push("--token", `${name}=${desired[name]}`);
    }
    if (changes.length > 0) {
      reports.push(["pane", "report-metadata", pane.pane_id, "--source", "sidebar-descriptors", "--seq", sequence, ...changes]);
    }
  }
  let updated = 0;
  for (const args of reports) {
    try {
      await execHerdr(binary, args, options);
      updated += 1;
    } catch (error) {
      if (!paneClosed(error)) throw error;
    }
  }
  console.log(JSON.stringify({ updated }));
}

void refresh().catch((error: unknown) => {
  console.error("sidebar-descriptors:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
