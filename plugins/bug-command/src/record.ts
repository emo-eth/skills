import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";

export type BugHost = "omp" | "pi";

export type NoteKind = "bug" | "fear" | "journal" | "grasp" | "do";

export type NoteCommand = {
  description: string;
  noun: string;
  label: string;
  fileName: string;
  envVar: string;
};

export const NOTE_COMMANDS: Record<NoteKind, NoteCommand> = {
  bug: {
    description: "Log a bug with the current agent, session, turn, and activity context",
    noun: "bug description",
    label: "Bug",
    fileName: "BUGS.md",
    envVar: "BUGS_PATH",
  },
  fear: {
    description: "Log a personal fear",
    noun: "fear",
    label: "Fear",
    fileName: "FEARS.md",
    envVar: "FEARS_PATH",
  },
  journal: {
    description: "Log a journal note",
    noun: "journal note",
    label: "Journal note",
    fileName: "JOURNAL.md",
    envVar: "JOURNAL_PATH",
  },
  grasp: {
    description: "Log a concept to understand later",
    noun: "concept to understand",
    label: "Concept",
    fileName: "GRASP.md",
    envVar: "GRASP_PATH",
  },
  do: {
    description: "Log a small personal task",
    noun: "task",
    label: "Task",
    fileName: "DO.md",
    envVar: "DO_PATH",
  },
};

export const NOTE_KINDS = Object.keys(NOTE_COMMANDS) as NoteKind[];

export function usage(kind: NoteKind): string {
  return `Usage: /${kind} [--plugin <name>] [--skill <name>] <${NOTE_COMMANDS[kind].noun}>`;
}

export type GitMetadata = {
  repo: string;
  worktree: string;
  branch: string;
};

export type NoteRecord = {
  schema: `${NoteKind}.v1`;
  id: string;
  datetime: string;
  host: BugHost;
  repo: string;
  worktree: string;
  branch: string;
  cwd: string;
  agent: string;
  model: string | null;
  plugin: string | null;
  skill: string | null;
  sessionId: string | null;
  sessionName: string | null;
  sessionFile: string | null;
  turn: number | null;
  turnStartedAt: string | null;
  lastEvent: string | null;
  lastEventAt: string | null;
  lastCommand: string | null;
  lastTool: string | null;
  sessionEntryCount: number | null;
  branchEntryCount: number | null;
  note: string;
};

export type GitRunner = (args: string[], cwd: string) => Promise<string | undefined>;

export type AppendNoteInput = {
  kind: NoteKind;
  note: string;
  host: BugHost;
  agent: string;
  cwd?: unknown;
  model?: unknown;
  plugin?: unknown;
  skill?: unknown;
  sessionId?: unknown;
  sessionName?: unknown;
  sessionFile?: unknown;
  turn?: unknown;
  turnStartedAt?: unknown;
  lastEvent?: unknown;
  lastEventAt?: unknown;
  lastCommand?: unknown;
  lastTool?: unknown;
  sessionEntryCount?: unknown;
  branchEntryCount?: unknown;
  path?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  git?: GitMetadata;
  runGit?: GitRunner;
};

export type ParsedCommand = {
  note: string;
  plugin?: string;
  skill?: string;
};

const OPTION = /^--(plugin|skill)(?:=([^\s]+)|\s+([^\s]+))(?:\s+([\s\S]*))?$/;

export function parseCommandArgs(kind: NoteKind, args: string): ParsedCommand {
  let input = typeof args === "string" ? args.trim() : "";
  if (!input) throw new Error(usage(kind));

  let plugin: string | undefined;
  let skill: string | undefined;
  while (input.startsWith("--")) {
    const match = OPTION.exec(input);
    if (!match) throw new Error(usage(kind));
    const name = normalizeValue(match[2] ?? match[3]);
    if (!name) throw new Error(usage(kind));
    if (match[1] === "plugin") plugin = name;
    else skill = name;
    input = (match[4] ?? "").trim();
    if (!input) throw new Error(usage(kind));
  }

  const note = normalizeNote(input);
  if (!note) throw new Error(usage(kind));
  return {
    note,
    ...(plugin ? { plugin } : {}),
    ...(skill ? { skill } : {}),
  };
}

export function outputPath(kind: NoteKind, env: NodeJS.ProcessEnv = process.env): string {
  const spec = NOTE_COMMANDS[kind];
  const configured = env[spec.envVar]?.trim();
  return configured || `${homedir()}/${spec.fileName}`;
}

export async function appendNoteRecord(input: AppendNoteInput): Promise<NoteRecord> {
  const note = normalizeNote(input.note);
  if (!note) throw new Error(usage(input.kind));

  const cwd = normalizeValue(input.cwd) || process.cwd();
  const git = input.git ?? await collectGitMetadata(cwd, input.runGit);
  const record: NoteRecord = {
    schema: `${input.kind}.v1`,
    id: randomUUID(),
    datetime: (input.now ?? new Date()).toISOString(),
    host: input.host,
    repo: normalizeValue(git.repo) || "unknown",
    worktree: normalizeValue(git.worktree) || cwd,
    branch: normalizeValue(git.branch) || "unknown",
    cwd,
    agent: normalizeValue(input.agent) || input.host.toUpperCase(),
    model: modelName(input.model) ?? null,
    plugin: normalizeValue(input.plugin) ?? null,
    skill: normalizeValue(input.skill) ?? null,
    sessionId: normalizeValue(input.sessionId) ?? null,
    sessionName: normalizeValue(input.sessionName) ?? null,
    sessionFile: normalizeValue(input.sessionFile) ?? null,
    turn: numberValue(input.turn) ?? null,
    turnStartedAt: normalizeValue(input.turnStartedAt) ?? null,
    lastEvent: normalizeValue(input.lastEvent) ?? null,
    lastEventAt: normalizeValue(input.lastEventAt) ?? null,
    lastCommand: normalizeValue(input.lastCommand) ?? null,
    lastTool: normalizeValue(input.lastTool) ?? null,
    sessionEntryCount: numberValue(input.sessionEntryCount) ?? null,
    branchEntryCount: numberValue(input.branchEntryCount) ?? null,
    note,
  };
  const destination = input.path ?? outputPath(input.kind, input.env);
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  appendFileSync(destination, `- ${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  return record;
}

export async function collectGitMetadata(
  cwd: string,
  runGit: GitRunner = defaultGitValue,
): Promise<GitMetadata> {
  const worktree = await runGit(["rev-parse", "--show-toplevel"], cwd);
  const repo = await runGit(["remote", "get-url", "origin"], cwd) ?? worktree;
  const branch = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
  const detachedCommit = branch ? undefined : await runGit(["rev-parse", "--short", "HEAD"], cwd);
  return {
    repo: repo ?? "unknown",
    worktree: worktree ?? cwd,
    branch: branch ?? (detachedCommit ? `detached:${detachedCommit}` : "unknown"),
  };
}

export function modelName(model: unknown): string | undefined {
  if (typeof model === "string") return normalizeValue(model);
  if (!model || typeof model !== "object") return undefined;
  const value = model as Record<string, unknown>;
  const provider = normalizeValue(value.provider);
  const id = normalizeValue(value.id);
  if (provider && id) return `${provider}/${id}`;
  return id ?? normalizeValue(value.name) ?? normalizeValue(value.model);
}

export function normalizeNote(value: string): string {
  return value.replace(/\r\n|\r|\n/g, " ").replace(/[\t ]+/g, " ").trim();
}

function normalizeValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeNote(value);
  return normalized || undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

function gitValue(args: string[], cwd: string): Promise<string | undefined> {
  const { promise, resolve } = Promise.withResolvers<string | undefined>();
  execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout) => {
    if (error) {
      resolve(undefined);
      return;
    }
    resolve(normalizeValue(stdout));
  });
  return promise;
}

type BunRuntime = {
  spawnSync(options: {
    cmd: string[];
    cwd: string;
    stdout: "pipe";
    stderr: "pipe";
  }): { exitCode: number; stdout?: Uint8Array | string };
};

async function defaultGitValue(args: string[], cwd: string): Promise<string | undefined> {
  const runtime = globalThis as unknown as { Bun?: BunRuntime };
  const bun = runtime.Bun;
  if (!bun) return gitValue(args, cwd);
  try {
    const result = bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) return undefined;
    if (typeof result.stdout === "string") return normalizeValue(result.stdout);
    return result.stdout ? normalizeValue(new TextDecoder().decode(result.stdout)) : undefined;
  } catch {
    return undefined;
  }
}
