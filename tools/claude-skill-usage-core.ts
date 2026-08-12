import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, join, resolve } from "node:path";

export const NO_SKILL = "(none)";

type JsonObject = Record<string, unknown>;

export type TokenBuckets = {
  input: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
  total: number;
};

export type UsageEvent = {
  sourcePath: string;
  line: number;
  requestId: string | null;
  messageId: string | null;
  sessionId: string | null;
  cwd: string | null;
  model: string | null;
  skill: string | null;
  sidechain: boolean;
  timestampMs: number;
  tokens: TokenBuckets;
};

export type SkillSummary = TokenBuckets & {
  skill: string;
  requests: number;
  share: number;
};

export type UsageReport = {
  roots: string[];
  files: number;
  requests: number;
  tokens: TokenBuckets;
  bySkill: SkillSummary[];
  warnings: string[];
};

export type ScanOptions = {
  roots?: readonly string[];
  sinceMs?: number;
  untilMs?: number;
  skill?: string;
};

const EMPTY_BUCKETS: TokenBuckets = {
  input: 0,
  cacheRead: 0,
  cacheCreation: 0,
  output: 0,
  total: 0,
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function tokenNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function firstTokenNumber(usage: JsonObject, names: readonly string[]): number {
  for (const name of names) {
    if (name in usage) return tokenNumber(usage[name]);
  }
  return 0;
}

function timestampMillis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? Math.floor(value * 1_000) : Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function bucketsFor(usage: JsonObject): TokenBuckets {
  const input = firstTokenNumber(usage, ["input_tokens", "inputTokens"]);
  const cacheRead = firstTokenNumber(usage, [
    "cache_read_input_tokens",
    "cacheReadInputTokens",
  ]);
  const cacheCreation = firstTokenNumber(usage, [
    "cache_creation_input_tokens",
    "cacheCreationInputTokens",
  ]);
  const output = firstTokenNumber(usage, ["output_tokens", "outputTokens"]);
  return {
    input,
    cacheRead,
    cacheCreation,
    output,
    total: input + cacheRead + cacheCreation + output,
  };
}

function isSubagentPath(path: string): boolean {
  return path.split(/[\\/]/).includes("subagents");
}

function eventKey(event: UsageEvent): string {
  if (event.requestId && event.messageId) {
    return `request-message:${event.requestId}:${event.messageId}`;
  }
  if (event.messageId) return `message:${event.messageId}`;
  if (event.requestId) return `request:${event.requestId}`;
  return `line:${event.sourcePath}:${event.line}`;
}

function shouldReplace(existing: UsageEvent, incoming: UsageEvent): boolean {
  if (existing.sidechain !== incoming.sidechain) return existing.sidechain;

  const existingParent = !isSubagentPath(existing.sourcePath);
  const incomingParent = !isSubagentPath(incoming.sourcePath);
  if (existingParent !== incomingParent) return incomingParent;

  if (existing.tokens.total !== incoming.tokens.total) {
    return incoming.tokens.total > existing.tokens.total;
  }
  return incoming.line > existing.line;
}

function mergeDuplicate(existing: UsageEvent, incoming: UsageEvent): UsageEvent {
  const chosen = shouldReplace(existing, incoming) ? incoming : existing;
  const other = chosen === existing ? incoming : existing;
  if (chosen.skill || !other.skill) return chosen;
  return { ...chosen, skill: other.skill };
}

function addEvent(events: Map<string, UsageEvent>, event: UsageEvent): void {
  const key = eventKey(event);
  const existing = events.get(key);
  events.set(key, existing ? mergeDuplicate(existing, event) : event);
}

async function discoverJsonlFiles(
  root: string,
  warnings: string[],
): Promise<string[]> {
  const absoluteRoot = resolve(root);
  let info;
  try {
    info = await lstat(absoluteRoot);
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
    if (code !== "ENOENT") {
      warnings.push(`cannot read ${absoluteRoot}: ${String(error)}`);
    }
    return [];
  }

  if (info.isFile()) {
    return absoluteRoot.endsWith(".jsonl") ? [absoluteRoot] : [];
  }
  if (!info.isDirectory()) return [];

  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      warnings.push(`cannot read ${directory}: ${String(error)}`);
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(path);
      }
    }
  }

  await walk(absoluteRoot);
  files.sort();
  return files;
}

async function scanFile(
  path: string,
  events: Map<string, UsageEvent>,
  warnings: string[],
): Promise<void> {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;

  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (!line.includes('"usage"')) continue;

      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        warnings.push(`invalid JSON in ${path}:${lineNumber}`);
        continue;
      }
      if (!record || typeof record !== "object") continue;
      const object = record as JsonObject;
      if (object.type !== "assistant") continue;

      const message = object.message;
      if (!message || typeof message !== "object") continue;
      const messageObject = message as JsonObject;
      const usage = messageObject.usage;
      if (!usage || typeof usage !== "object") continue;

      const tokens = bucketsFor(usage as JsonObject);
      if (tokens.total === 0) continue;

      addEvent(events, {
        sourcePath: path,
        line: lineNumber,
        requestId: optionalString(object.requestId ?? object.request_id),
        messageId: optionalString(messageObject.id),
        sessionId: optionalString(object.sessionId ?? object.session_id),
        cwd: optionalString(object.cwd),
        model: optionalString(messageObject.model),
        skill: optionalString(object.attributionSkill),
        sidechain: object.isSidechain === true,
        timestampMs: timestampMillis(object.timestamp),
        tokens,
      });
    }
  } finally {
    lines.close();
  }
}

function addBuckets(target: TokenBuckets, source: TokenBuckets): void {
  target.input += source.input;
  target.cacheRead += source.cacheRead;
  target.cacheCreation += source.cacheCreation;
  target.output += source.output;
  target.total += source.total;
}

function matches(event: UsageEvent, options: ScanOptions): boolean {
  if (options.sinceMs !== undefined && event.timestampMs < options.sinceMs) {
    return false;
  }
  if (options.untilMs !== undefined && event.timestampMs >= options.untilMs) {
    return false;
  }
  if (options.skill !== undefined && event.skill !== options.skill) return false;
  return true;
}

export function defaultUsageRoots(
  env: NodeJS.ProcessEnv = process.env,
  home = env.HOME ?? "",
): string[] {
  const configured = env.CLAUDE_CONFIG_DIR?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured && configured.length > 0) {
    return configured.map((value) => {
      const path = resolve(value);
      return basename(path) === "projects" ? path : join(path, "projects");
    });
  }
  return [join(home, ".claude", "projects"), join(home, ".config", "claude", "projects")];
}

export async function scanUsage(options: ScanOptions = {}): Promise<UsageReport> {
  const roots = [...(options.roots ?? defaultUsageRoots())].map((root) => resolve(root));
  const warnings: string[] = [];
  const files = new Set<string>();
  for (const root of roots) {
    for (const file of await discoverJsonlFiles(root, warnings)) files.add(file);
  }

  const events = new Map<string, UsageEvent>();
  for (const file of [...files].sort()) {
    try {
      await scanFile(file, events, warnings);
    } catch (error) {
      warnings.push(`cannot scan ${file}: ${String(error)}`);
    }
  }

  const filtered = [...events.values()]
    .filter((event) => matches(event, options))
    .sort((left, right) => {
      if (left.timestampMs !== right.timestampMs) return left.timestampMs - right.timestampMs;
      if (left.sourcePath !== right.sourcePath) return left.sourcePath.localeCompare(right.sourcePath);
      return left.line - right.line;
    });

  const tokens = { ...EMPTY_BUCKETS };
  const bySkill = new Map<string, SkillSummary>();
  for (const event of filtered) {
    addBuckets(tokens, event.tokens);
    const skill = event.skill ?? NO_SKILL;
    let summary = bySkill.get(skill);
    if (!summary) {
      summary = { skill, requests: 0, share: 0, ...EMPTY_BUCKETS };
      bySkill.set(skill, summary);
    }
    summary.requests += 1;
    addBuckets(summary, event.tokens);
  }

  const summaries = [...bySkill.values()]
    .map((summary) => ({
      ...summary,
      share: tokens.total === 0 ? 0 : summary.total / tokens.total,
    }))
    .sort((left, right) => {
      if (left.total !== right.total) return right.total - left.total;
      return left.skill.localeCompare(right.skill);
    });

  return {
    roots,
    files: files.size,
    requests: filtered.length,
    tokens,
    bySkill: summaries,
    warnings,
  };
}
