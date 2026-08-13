import { appendFileSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname } from "node:path";

export type GitMetadata = {
  repo: string;
  worktree: string;
  branch: string;
};

export type GitRunner = (args: string[], cwd: string) => Promise<string | undefined>;

export type SkiterateRecord = {
  datetime: string;
  repo: string;
  worktree: string;
  branch: string;
  cwd: string;
  agent: string;
  model: string | null;
  skill: string | null;
  note: string;
};

export type AppendNoteInput = {
  note: string;
  cwd?: string;
  agent: string;
  model?: unknown;
  skill?: string;
  path?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  git?: GitMetadata;
  runGit?: GitRunner;
};

export type ParsedCommand = {
  note: string;
  skill?: string;
};

const SKILL_FLAG = /^--skill(?:=([^\s]+)|\s+([^\s]+))(?:\s+([\s\S]*))?$/;
const USAGE = "Usage: /skiterate [--skill <name>] <note text>";

export function parseCommandArgs(args: string): ParsedCommand {
  const input = args.trim();
  if (!input) throw new Error(USAGE);

  if (input.startsWith("--skill")) {
    const match = SKILL_FLAG.exec(input);
    if (!match) throw new Error(USAGE);
    const skill = match[1] ?? match[2];
    const note = normalizeNote(match[3] ?? "");
    if (!skill || !note) throw new Error(USAGE);
    return { skill: normalizeValue(skill), note };
  }

  if (input.startsWith("--")) throw new Error(USAGE);
  return { note: normalizeNote(input) };
}

export function outputPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SKITERATE_PATH?.trim();
  return configured || `${homedir()}/SKITERATE.md`;
}

export async function appendSkiterateNote(input: AppendNoteInput): Promise<SkiterateRecord> {
  const note = normalizeNote(input.note);
  if (!note) throw new Error(USAGE);

  const cwd = normalizeValue(input.cwd) || process.cwd();
  const git = input.git ?? await collectGitMetadata(cwd, input.runGit);
  const record: SkiterateRecord = {
    datetime: (input.now ?? new Date()).toISOString(),
    repo: normalizeValue(git.repo) || "unknown",
    worktree: normalizeValue(git.worktree) || cwd,
    branch: normalizeValue(git.branch) || "unknown",
    cwd,
    agent: normalizeValue(input.agent) || "unknown",
    model: modelName(input.model) ?? null,
    skill: normalizeValue(input.skill) || null,
    note,
  };
  const destination = input.path ?? outputPath(input.env);
  mkdirSync(dirname(destination), { recursive: true });
  appendFileSync(destination, `- ${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function collectGitMetadata(cwd: string, runGit: GitRunner = defaultGitValue): Promise<GitMetadata> {
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

export function extractSkillName(event: unknown): string | undefined {
  if (typeof event === "string") return skillNameFromText(event);
  if (!event || typeof event !== "object") return undefined;
  const value = event as Record<string, unknown>;

  const direct = normalizeValue(value.skillName);
  if (direct) return direct;
  const skill = value.skill;
  if (skill && typeof skill === "object") {
    const name = normalizeValue((skill as Record<string, unknown>).name);
    if (name) return name;
  }

  const details = value.details;
  if (details && typeof details === "object") {
    const name = normalizeValue((details as Record<string, unknown>).name);
    if (name) return name;
  }

  const message = value.message;
  if (message && typeof message === "object") {
    const messageValue = message as Record<string, unknown>;
    const messageDetails = messageValue.details;
    if (messageDetails && typeof messageDetails === "object") {
      const name = normalizeValue((messageDetails as Record<string, unknown>).name);
      if (name) return name;
    }
    const content = messageValue.content;
    const contentText = contentTextFrom(content);
    const name = skillNameFromText(contentText);
    if (name) return name;
  }

  const prompt = normalizeValue(value.prompt);
  return prompt ? skillNameFromText(prompt) : undefined;
}

export function normalizeNote(value: string): string {
  return value.replace(/\r\n|\r|\n/g, " ").replace(/[\t ]+/g, " ").trim();
}

function normalizeValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeNote(value);
  return normalized || undefined;
}

function skillNameFromText(text: string): string | undefined {
  const marker = /<skill\s+name="([^"]+)"/i.exec(text)
    ?? /\[IMPORTANT:\s*User invoked the "([^"]+)" skill;/i.exec(text)
    ?? /(?:^|\s)\/skill:([^\s/]+)/.exec(text);
  return marker?.[1] ? normalizeValue(marker[1]) : undefined;
}

function contentTextFrom(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
      ? (part as Record<string, string>).text
      : "")
    .join("\n");
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
  // Pi and OMP run under Bun; Node package tests use the child-process fallback.
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
