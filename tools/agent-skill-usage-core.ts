import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, join, resolve } from "node:path";

export const NO_SKILL = "(none)";
export const SOURCES = ["claude", "codex", "pi", "omp"] as const;
export type UsageSource = (typeof SOURCES)[number];
export type AttributionKind = "exact" | "unknown";
export type AttributionMethod =
  | "claude-attributionSkill"
  | "explicit-skill-in-record"
  | "unknown";

type JsonObject = Record<string, unknown>;

export type TokenBuckets = {
  input: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
  total: number;
};

export type UsageEvent = {
  source: UsageSource;
  sourcePath: string;
  line: number;
  sourceRecordId: string | null;
  requestId: string | null;
  messageId: string | null;
  sessionId: string | null;
  cwd: string | null;
  model: string | null;
  skill: string | null;
  attribution: AttributionKind;
  attributionMethod: AttributionMethod;
  sidechain: boolean;
  timestampMs: number;
  tokens: TokenBuckets;
};

export type SkillSummary = TokenBuckets & {
  skill: string;
  attribution: AttributionKind;
  requests: number;
  exactRequests: number;
  unknownRequests: number;
  share: number;
};

export type SourceSummary = TokenBuckets & {
  source: UsageSource;
  requests: number;
  exactRequests: number;
  unknownRequests: number;
  share: number;
};

export type UsageReport = {
  roots: string[];
  files: number;
  requests: number;
  tokens: TokenBuckets;
  attribution: {
    exactRequests: number;
    unknownRequests: number;
    exactTokens: number;
    unknownTokens: number;
  };
  bySkill: SkillSummary[];
  bySource: SourceSummary[];
  warnings: string[];
};

export type ScanOptions = {
  roots?: readonly string[];
  sinceMs?: number;
  untilMs?: number;
  skill?: string;
  env?: NodeJS.ProcessEnv;
};

export type SourceRoots = Partial<Record<UsageSource, readonly string[]>>;

export type AllSourceScanOptions = ScanOptions & {
  sources?: readonly UsageSource[];
  sourceRoots?: SourceRoots;
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
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
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
  const input = firstTokenNumber(usage, ["input_tokens", "inputTokens", "input"]);
  const cacheRead = firstTokenNumber(usage, [
    "cache_read_input_tokens",
    "cacheReadInputTokens",
    "cache_read",
    "cacheRead",
  ]);
  const cacheCreation = firstTokenNumber(usage, [
    "cache_creation_input_tokens",
    "cacheCreationInputTokens",
    "cache_write",
    "cacheWrite",
  ]);
  const output = firstTokenNumber(usage, ["output_tokens", "outputTokens", "output"]);
  return {
    input,
    cacheRead,
    cacheCreation,
    output,
    total: input + cacheRead + cacheCreation + output,
  };
}

function codexBucketsFor(usage: JsonObject): TokenBuckets {
  const rawInput = firstTokenNumber(usage, [
    "input_tokens",
    "inputTokens",
    "prompt_tokens",
    "input",
  ]);
  const cachedInput = firstTokenNumber(usage, [
    "cached_input_tokens",
    "cachedInputTokens",
    "cache_read_input_tokens",
    "cacheReadInputTokens",
    "cache_read",
    "cacheRead",
  ]);
  const cacheRead = Math.min(rawInput, cachedInput);
  const output = firstTokenNumber(usage, ["output_tokens", "outputTokens", "output"]);
  return {
    input: rawInput - cacheRead,
    cacheRead,
    cacheCreation: 0,
    output,
    total: rawInput + output,
  };
}

function isSubagentPath(path: string): boolean {
  return path.split(/[\\/]/).includes("subagents");
}

function eventKey(event: UsageEvent): string {
  if (event.requestId && event.messageId) {
    return `request-message:${event.source}:${event.requestId}:${event.messageId}`;
  }
  if (event.sourceRecordId) {
    return `source-record:${event.source}:${event.sourcePath}:${event.sourceRecordId}`;
  }
  if (event.messageId) return `message:${event.source}:${event.messageId}`;
  if (event.requestId) return `request:${event.source}:${event.requestId}`;
  return `line:${event.source}:${event.sourcePath}:${event.line}`;
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
  return {
    ...chosen,
    skill: other.skill,
    attribution: other.attribution,
    attributionMethod: other.attributionMethod,
  };
}

function addEvent(events: Map<string, UsageEvent>, event: UsageEvent): void {
  const key = eventKey(event);
  const existing = events.get(key);
  events.set(key, existing ? mergeDuplicate(existing, event) : event);
}

async function discoverJsonlFiles(root: string, warnings: string[]): Promise<string[]> {
  const absoluteRoot = resolve(root);
  let info;
  try {
    info = await lstat(absoluteRoot);
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
    if (code !== "ENOENT") warnings.push(`cannot read ${absoluteRoot}: ${String(error)}`);
    return [];
  }

  if (info.isFile()) return absoluteRoot.endsWith(".jsonl") ? [absoluteRoot] : [];
  if (!info.isDirectory()) return [];

  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error: unknown) {
      warnings.push(`cannot read ${directory}: ${String(error)}`);
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  }

  await walk(absoluteRoot);
  files.sort();
  return files;
}

function addBuckets(target: TokenBuckets, source: TokenBuckets): void {
  target.input += source.input;
  target.cacheRead += source.cacheRead;
  target.cacheCreation += source.cacheCreation;
  target.output += source.output;
  target.total += source.total;
}

function matches(event: UsageEvent, options: ScanOptions): boolean {
  if (options.sinceMs !== undefined && event.timestampMs < options.sinceMs) return false;
  if (options.untilMs !== undefined && event.timestampMs >= options.untilMs) return false;
  if (options.skill !== undefined) {
    const requested = options.skill === NO_SKILL ? null : options.skill;
    if (event.skill !== requested) return false;
  }
  return true;
}

function normalizeWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)];
}

function buildReport(
  filtered: UsageEvent[],
  roots: string[],
  files: number,
  warnings: string[],
  sources: readonly UsageSource[] = SOURCES,
): UsageReport {
  const tokens = { ...EMPTY_BUCKETS };
  const bySkill = new Map<string, SkillSummary>();
  const bySource = new Map<UsageSource, SourceSummary>();
  for (const source of sources) {
    bySource.set(source, {
      source,
      requests: 0,
      exactRequests: 0,
      unknownRequests: 0,
      share: 0,
      ...EMPTY_BUCKETS,
    });
  }

  let exactRequests = 0;
  let unknownRequests = 0;
  let exactTokens = 0;
  let unknownTokens = 0;

  for (const event of filtered) {
    addBuckets(tokens, event.tokens);
    const exact = event.attribution === "exact" && event.skill !== null;
    if (exact) {
      exactRequests += 1;
      exactTokens += event.tokens.total;
    } else {
      unknownRequests += 1;
      unknownTokens += event.tokens.total;
    }

    const skill = event.skill ?? NO_SKILL;
    let skillSummary = bySkill.get(skill);
    if (!skillSummary) {
      skillSummary = {
        skill,
        attribution: skill === NO_SKILL ? "unknown" : "exact",
        requests: 0,
        exactRequests: 0,
        unknownRequests: 0,
        share: 0,
        ...EMPTY_BUCKETS,
      };
      bySkill.set(skill, skillSummary);
    }
    skillSummary.requests += 1;
    if (exact) skillSummary.exactRequests += 1;
    else skillSummary.unknownRequests += 1;
    addBuckets(skillSummary, event.tokens);

    const sourceSummary = bySource.get(event.source);
    if (sourceSummary) {
      sourceSummary.requests += 1;
      if (exact) sourceSummary.exactRequests += 1;
      else sourceSummary.unknownRequests += 1;
      addBuckets(sourceSummary, event.tokens);
    }
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

  const sourceSummaries = sources.map((source) => {
    const summary = bySource.get(source)!;
    return {
      ...summary,
      share: tokens.total === 0 ? 0 : summary.total / tokens.total,
    };
  });

  return {
    roots,
    files,
    requests: filtered.length,
    tokens,
    attribution: { exactRequests, unknownRequests, exactTokens, unknownTokens },
    bySkill: summaries,
    bySource: sourceSummaries,
    warnings: normalizeWarnings(warnings),
  };
}

function sortEvents(events: Iterable<UsageEvent>, options: ScanOptions): UsageEvent[] {
  return [...events]
    .filter((event) => matches(event, options))
    .sort((left, right) => {
      if (left.timestampMs !== right.timestampMs) return left.timestampMs - right.timestampMs;
      if (left.source !== right.source) return left.source.localeCompare(right.source);
      if (left.sourcePath !== right.sourcePath) return left.sourcePath.localeCompare(right.sourcePath);
      return left.line - right.line;
    });
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

export function defaultSourceRoots(
  env: NodeJS.ProcessEnv = process.env,
  home = env.HOME ?? "",
): Record<UsageSource, string[]> {
  return {
    claude: defaultUsageRoots(env, home),
    codex: [env.CODEX_SESSION_DIR ?? join(home, ".codex", "sessions")],
    pi: [env.PI_CODING_AGENT_SESSION_DIR ?? join(home, ".pi", "agent", "sessions")],
    omp: [env.OMP_AGENT_SESSION_DIR ?? env.OMP_SESSION_DIR ?? join(home, ".omp", "agent", "sessions")],
  };
}

function valueAsObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function roleFromRecord(record: JsonObject): string | null {
  for (const candidate of [record.message, record.payload, record]) {
    const object = valueAsObject(candidate);
    const role = optionalString(object?.role);
    if (role) return role;
  }
  return null;
}

function explicitSkillName(value: unknown): string | null {
  const name = optionalString(value);
  return name && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? name : null;
}

function explicitSkillFromText(text: string): string | null {
  const slash = text.match(/(?:^|\s)\/skill:([A-Za-z0-9][A-Za-z0-9._-]*)\b/);
  if (slash) return slash[1] ?? null;
  const url = text.match(/skill:\/\/([A-Za-z0-9][A-Za-z0-9._-]*)/);
  return url?.[1] ?? null;
}

function explicitSkillFromToolCalls(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const skill = explicitSkillFromToolCalls(item);
      if (skill) return skill;
    }
    return null;
  }
  const object = valueAsObject(value);
  if (!object) return null;
  const type = optionalString(object.type)?.toLowerCase() ?? "";
  const name = optionalString(object.name)?.toLowerCase() ?? "";
  const isToolCall = type === "toolcall"
    || type === "tool_call"
    || type === "function_call"
    || type === "custom_tool_call"
    || name === "read";
  if (isToolCall) {
    const argumentsObject = valueAsObject(object.arguments ?? object.input ?? object.args);
    const skill = explicitSkillFromText(
      optionalString(argumentsObject?.path) ?? optionalString(argumentsObject?.url) ?? "",
    );
    if (skill) return skill;
  }
  for (const key of ["content", "toolCalls", "tool_calls"]) {
    const skill = explicitSkillFromToolCalls(object[key]);
    if (skill) return skill;
  }
  return null;
}

function explicitSkillFromRecord(record: JsonObject): string | null {
  const message = valueAsObject(record.message);
  const payload = valueAsObject(record.payload);
  const direct = [
    record.skill,
    record.attributionSkill,
    message?.skill,
    message?.attributionSkill,
    payload?.skill,
    payload?.attributionSkill,
  ];
  for (const value of direct) {
    const skill = explicitSkillName(value);
    if (skill) return skill;
  }

  const type = optionalString(record.type)?.toLowerCase() ?? "";
  if (type.includes("skill")) {
    const skill = explicitSkillName(record.name);
    if (skill) return skill;
  }
  if (payload && optionalString(payload.type)?.toLowerCase().includes("skill")) {
    const skill = explicitSkillName(payload.name);
    if (skill) return skill;
  }

  return explicitSkillFromToolCalls(message?.content)
    ?? explicitSkillFromToolCalls(payload?.content)
    ?? explicitSkillFromToolCalls(record.content)
    ?? (optionalString(record.customType)?.toLowerCase() === "tool_execution_start"
      ? (() => {
        const data = valueAsObject(record.data);
        const toolName = optionalString(data?.toolName ?? record.toolName)?.toLowerCase();
        if (toolName !== "read") return null;
        const args = valueAsObject(data?.args ?? data?.arguments);
        return explicitSkillFromText(optionalString(args?.path) ?? "");
      })()
      : null);
}

function sessionIdFromRecord(record: JsonObject, current: string | null): string | null {
  if (record.type === "session") return optionalString(record.id) ?? current;
  if (record.type === "session_meta") {
    const payload = valueAsObject(record.payload);
    return optionalString(payload?.id ?? payload?.session_id) ?? current;
  }
  return optionalString(record.session_id ?? record.sessionId) ?? current;
}

function modelFromRecord(record: JsonObject, current: string | null): string | null {
  const message = valueAsObject(record.message);
  const payload = valueAsObject(record.payload);
  return optionalString(message?.model ?? record.model ?? payload?.model ?? payload?.model_name) ?? current;
}

function cwdFromRecord(record: JsonObject): string | null {
  const message = valueAsObject(record.message);
  const payload = valueAsObject(record.payload);
  return optionalString(record.cwd ?? message?.cwd ?? payload?.cwd);
}

function timestampFromRecord(record: JsonObject): number {
  const message = valueAsObject(record.message);
  return timestampMillis(record.timestamp ?? message?.timestamp ?? record.created_at);
}

function usageFromRecord(record: JsonObject): JsonObject | null {
  const message = valueAsObject(record.message);
  const payload = valueAsObject(record.payload);
  return valueAsObject(message?.usage)
    ?? valueAsObject(record.usage)
    ?? valueAsObject(payload?.usage)
    ?? valueAsObject(valueAsObject(record.data)?.usage)
    ?? valueAsObject(valueAsObject(record.response)?.usage);
}

function codexUsageFromRecord(record: JsonObject): JsonObject | null {
  const payload = valueAsObject(record.payload);
  if (record.type === "event_msg" && optionalString(payload?.type) === "token_count") {
    const info = valueAsObject(payload?.info) ?? payload;
    return valueAsObject(info?.last_token_usage) ?? valueAsObject(info?.usage);
  }
  return usageFromRecord(record);
}

function usageEventFromRecord(
  source: UsageSource,
  sourcePath: string,
  line: number,
  record: JsonObject,
  sessionId: string | null,
  model: string | null,
  skill: string | null,
  method: AttributionMethod,
  buckets: TokenBuckets,
): UsageEvent | null {
  if (buckets.total === 0) return null;
  const message = valueAsObject(record.message);
  return {
    source,
    sourcePath: resolve(sourcePath),
    line,
    sourceRecordId: `line:${line}`,
    requestId: optionalString(record.requestId ?? record.request_id),
    messageId: optionalString(message?.id ?? record.id),
    sessionId,
    cwd: cwdFromRecord(record),
    model,
    skill,
    attribution: skill ? "exact" : "unknown",
    attributionMethod: method,
    sidechain: record.isSidechain === true,
    timestampMs: timestampFromRecord(record),
    tokens: buckets,
  };
}

async function scanLocalSourceFile(
  path: string,
  source: UsageSource,
  events: Map<string, UsageEvent>,
  warnings: string[],
): Promise<void> {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  let sessionId: string | null = null;
  let currentModel: string | null = null;

  try {
    for await (const line of lines) {
      lineNumber += 1;
      const hasUsageHint = /"usage"|"token_count"/i.test(line);
      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        if (hasUsageHint) warnings.push(`invalid JSON in ${path}:${lineNumber}`);
        continue;
      }
      const object = valueAsObject(record);
      if (!object) continue;

      sessionId = sessionIdFromRecord(object, sessionId);
      currentModel = modelFromRecord(object, currentModel);
      const role = roleFromRecord(object);
      let usage: JsonObject | null = null;
      let buckets: TokenBuckets | null = null;

      if (source === "claude") {
        if (object.type !== "assistant") continue;
        usage = usageFromRecord(object);
        if (usage) buckets = bucketsFor(usage);
      } else if (source === "codex") {
        usage = codexUsageFromRecord(object);
        if (usage) buckets = codexBucketsFor(usage);
      } else if (role === "assistant") {
        usage = usageFromRecord(object);
        if (usage) buckets = bucketsFor(usage);
      }

      if (!usage || !buckets) continue;
      const skill = source === "claude"
        ? optionalString(object.attributionSkill)
        : explicitSkillFromRecord(object);
      const method: AttributionMethod = skill
        ? source === "claude" ? "claude-attributionSkill" : "explicit-skill-in-record"
        : "unknown";
      const event = usageEventFromRecord(
        source,
        path,
        lineNumber,
        object,
        sessionId,
        currentModel,
        skill,
        method,
        buckets,
      );
      if (event) addEvent(events, event);
    }
  } catch (error: unknown) {
    warnings.push(`cannot scan ${path}: ${String(error)}`);
  } finally {
    lines.close();
  }
}

export async function scanUsage(options: ScanOptions = {}): Promise<UsageReport> {
  const roots = [...(options.roots ?? defaultUsageRoots(options.env))].map((root) => resolve(root));
  const warnings: string[] = [];
  const files = new Set<string>();
  for (const root of roots) {
    for (const file of await discoverJsonlFiles(root, warnings)) files.add(file);
  }

  const events = new Map<string, UsageEvent>();
  for (const file of [...files].sort()) {
    await scanLocalSourceFile(file, "claude", events, warnings);
  }
  return buildReport(sortEvents(events.values(), options), roots, files.size, warnings, ["claude"]);
}

function rootsForSources(
  options: AllSourceScanOptions,
  sources: readonly UsageSource[],
): Record<UsageSource, string[]> {
  const defaults = defaultSourceRoots(options.env);
  const result = { ...defaults };
  for (const source of sources) {
    const configured = options.sourceRoots?.[source];
    if (configured) result[source] = [...configured];
    else if (source === "claude" && options.roots) result[source] = [...options.roots];
  }
  return result;
}

export async function scanAllSources(options: AllSourceScanOptions = {}): Promise<UsageReport> {
  const sources = [...new Set(options.sources ?? SOURCES)];
  const warnings: string[] = [];
  const sourceRoots = rootsForSources(options, sources);
  const files = new Set<string>();
  const events = new Map<string, UsageEvent>();

  for (const source of sources) {
    const paths = new Set<string>();
    for (const root of sourceRoots[source]) {
      for (const file of await discoverJsonlFiles(root, warnings)) paths.add(file);
    }
    for (const path of [...paths].sort()) {
      files.add(path);
      await scanLocalSourceFile(path, source, events, warnings);
    }
  }

  const roots = sources.flatMap((source) => sourceRoots[source].map((root) => resolve(root)));
  return buildReport(sortEvents(events.values(), options), roots, files.size, warnings, sources);
}
