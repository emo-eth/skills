import { basename, join, resolve } from "node:path";

import {
  extractSection,
  formatTicketFile,
  goalPath,
  parseGoalTicket,
  parseTicketFile,
  ticketFace,
  ticketFilePath,
  upsertGoal,
  type MapInfo,
} from "./goal.ts";
import { humanTitle, isTicketNumberName, type TicketRef } from "./ticket.ts";

export type WorkspaceInfo = {
  workspace_id: string;
  label: string;
  worktree?: { checkout_path?: string } | null;
};

export type CaptureInput = {
  workspaceId?: string;
  path?: string;
  name?: string;
  cwd?: string;
  team?: string;
  env?: NodeJS.ProcessEnv;
};

export type CaptureResult = {
  action: "created" | "bound";
  identifier: string;
  url: string;
  title: string;
  path: string;
  workspace_id?: string;
  label?: string;
};

export type CaptureDeps = {
  readFile(path: string): Promise<string | undefined>;
  writeFile(path: string, contents: string): Promise<void>;
  createIssue(input: { title: string; description: string; team: string }): Promise<TicketRef>;
  getWorkspace(id: string): Promise<WorkspaceInfo | undefined>;
  listWorkspaces(): Promise<WorkspaceInfo[]>;
  reportTicket(workspaceId: string, identifier: string): Promise<void>;
};

const HELP = `Capture or bind a Linear ticket for a worktree.

Usage:
  node --experimental-strip-types src/main.ts [--workspace ID] [--path PATH] [--name NAME]

Binds GOAL.md / .herdr-ticket when a Linear id is already present.
Otherwise creates a team EMO issue with Intention, Vibe, Done-when, and Map.
Chair names are for humans, never ticket numbers. No form. No focus steal.
`;

export function parseCliArgs(argv: string[]): CaptureInput & { help?: boolean } {
  const input: CaptureInput = {};
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--workspace" || arg === "-w") {
      input.workspaceId = required(args, i += 1, arg);
      continue;
    }
    if (arg === "--path") {
      input.path = required(args, i += 1, arg);
      continue;
    }
    if (arg === "--name" || arg === "-n") {
      input.name = required(args, i += 1, arg);
      continue;
    }
    if (arg === "--team") {
      input.team = required(args, i += 1, arg);
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown flag: ${arg}`);
    if (/^w[0-9A-Za-z]+$/.test(arg)) input.workspaceId = arg;
    else input.path = arg;
  }
  return input;
}

export function helpText(): string {
  return HELP;
}

export async function capture(input: CaptureInput, deps: CaptureDeps): Promise<CaptureResult> {
  const resolved = await resolveTarget(input, deps);
  refuseTicketNumber(resolved.chairName, "chair");
  const workName = input.name ?? resolved.chairName;
  refuseTicketNumber(workName, "name");
  const title = humanTitle(workName);
  const map: MapInfo = {
    path: resolved.path,
    label: resolved.label,
    workspaceId: resolved.workspaceId,
  };
  const existing = await readExistingTicket(resolved.path, deps);
  const goalText = await deps.readFile(goalPath(resolved.path));
  const face = {
    intention: extractSection(goalText ?? "", "Intention"),
    vibe: extractSection(goalText ?? "", "Vibe"),
    doneWhen: extractSection(goalText ?? "", "Done-when"),
  };

  let ref = existing;
  let action: "created" | "bound" = "bound";
  if (!ref) {
    ref = await deps.createIssue({
      title,
      description: ticketFace({ ...face, map }),
      team: input.team ?? "EMO",
    });
    action = "created";
  }
  ref = { ...ref, title: ref.title ?? title };

  const nextGoal = upsertGoal(goalText, ref, map, face);
  if (nextGoal !== goalText) await deps.writeFile(goalPath(resolved.path), nextGoal);
  await deps.writeFile(ticketFilePath(resolved.path), formatTicketFile(ref));
  if (resolved.workspaceId) await deps.reportTicket(resolved.workspaceId, ref.identifier);

  return {
    action,
    identifier: ref.identifier,
    url: ref.url,
    title: ref.title ?? title,
    path: resolved.path,
    workspace_id: resolved.workspaceId,
    label: resolved.label,
  };
}

type Resolved = {
  path: string;
  workspaceId?: string;
  label?: string;
  chairName: string;
};

async function resolveTarget(input: CaptureInput, deps: CaptureDeps): Promise<Resolved> {
  const env = input.env ?? {};
  const explicitPath = input.path ? resolve(input.path) : undefined;
  const workspaceId = input.workspaceId
    ?? (explicitPath ? undefined : env.HERDR_WORKSPACE_ID);
  let workspace = workspaceId ? await deps.getWorkspace(workspaceId) : undefined;
  let path = explicitPath
    ?? (workspace?.worktree?.checkout_path
      ? resolve(workspace.worktree.checkout_path)
      : undefined);

  if (!path) {
    const cwd = input.cwd ? resolve(input.cwd) : undefined;
    if (!cwd) throw new Error("capture needs --workspace, --path, or a worktree cwd");
    path = cwd;
  }

  if (!workspace) {
    try {
      const listed = await deps.listWorkspaces();
      workspace = listed.find((row) => {
        const checkout = row.worktree?.checkout_path;
        return checkout ? resolve(checkout) === path : false;
      });
    } catch {
      workspace = undefined;
    }
  }

  const checkout = workspace?.worktree?.checkout_path
    ? resolve(workspace.worktree.checkout_path)
    : undefined;
  if (workspace && !checkout && !explicitPath) {
    throw new Error(`workspace ${workspace.workspace_id} has no checkout_path`);
  }
  if (checkout && !explicitPath) path = checkout;

  const label = workspace?.label;
  const chairName = input.name ?? label ?? basename(path);
  return {
    path,
    workspaceId: workspace?.workspace_id,
    label,
    chairName,
  };
}

async function readExistingTicket(tree: string, deps: CaptureDeps): Promise<TicketRef | undefined> {
  const goal = await deps.readFile(goalPath(tree));
  const fromGoal = goal ? parseGoalTicket(goal) : undefined;
  if (fromGoal) return fromGoal;
  const ticket = await deps.readFile(ticketFilePath(tree));
  return ticket ? parseTicketFile(ticket) : undefined;
}

function refuseTicketNumber(name: string, kind: "chair" | "name"): void {
  if (!isTicketNumberName(name)) return;
  const word = kind === "chair" ? "Chair names" : "Work names";
  throw new Error(`${word} are for humans, never ticket numbers (got ${name.trim()})`);
}

function required(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("-")) throw new Error(`${flag} needs a value`);
  return value;
}

export function workspaceFromCli(payload: unknown, id?: string): WorkspaceInfo | undefined {
  const root = unwrap(payload);
  const workspace = asRecord(root.workspace) ?? (id ? undefined : asRecord(root));
  const workspaces = Array.isArray(root.workspaces) ? root.workspaces : [];
  const match = workspace
    ?? workspaces.map(asRecord).find((row) => row && stringValue(row.workspace_id) === id);
  if (!match) return undefined;
  return asWorkspace(match);
}

export function workspacesFromCli(payload: unknown): WorkspaceInfo[] {
  const root = unwrap(payload);
  const workspaces = Array.isArray(root.workspaces) ? root.workspaces : [];
  return workspaces.flatMap((row) => {
    const parsed = asRecord(row);
    const workspace = parsed ? asWorkspace(parsed) : undefined;
    return workspace ? [workspace] : [];
  });
}

function unwrap(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload) ?? {};
  return asRecord(record.result) ?? record;
}

function asWorkspace(row: Record<string, unknown>): WorkspaceInfo | undefined {
  const workspaceId = stringValue(row.workspace_id);
  const label = stringValue(row.label);
  if (!workspaceId || !label) return undefined;
  const worktree = asRecord(row.worktree);
  return {
    workspace_id: workspaceId,
    label,
    worktree: worktree
      ? { checkout_path: stringValue(worktree.checkout_path) }
      : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export { join };
