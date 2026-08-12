import { execFile as execFileCallback } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { basename, join, resolve } from "node:path";

const execFile = promisify(execFileCallback);

export const NO_SKILL = "(none)";
export const SOURCES = ["claude", "codex", "pi", "omp"] as const;
export type UsageSource = (typeof SOURCES)[number];
export type AttributionKind = "observed" | "unknown";
export type AttributionMethod =
  | "claude-attributionSkill"
  | "explicit-skill-invocation"
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
  observedRequests: number;
  unknownRequests: number;
  share: number;
};

export type SourceSummary = TokenBuckets & {
  source: UsageSource;
  requests: number;
  observedRequests: number;
  unknownRequests: number;
  share: number;
};

export type UsageReport = {
  roots: string[];
  files: number;
  requests: number;
  tokens: TokenBuckets;
  attribution: {
    observedRequests: number;
    unknownRequests: number;
    observedTokens: number;
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
  /** Set false to exercise local parsers without invoking Memex. */
  useMemex?: boolean;
  /** Test hook and offline input: normalized output from `memex usage --json --events`. */
  memexOutput?: string | JsonObject;
  memexCommand?: string;
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

function timestampMsValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== "") return Math.max(0, Math.floor(numeric));
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

function memexBucketsFor(usage: JsonObject): TokenBuckets {
  const input = firstTokenNumber(usage, ["uncached_input", "input", "input_tokens"]);
  const cacheRead = firstTokenNumber(usage, ["cache_read", "cacheRead", "cached_input"]);
  const cacheCreation = firstTokenNumber(usage, [
    "cache_write",
    "cacheWrite",
    "cache_write_1h",
  ]);
  const output = firstTokenNumber(usage, ["output", "output_tokens", "outputTokens"]);
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
      observedRequests: 0,
      unknownRequests: 0,
      share: 0,
      ...EMPTY_BUCKETS,
    });
  }

  let observedRequests = 0;
  let unknownRequests = 0;
  let observedTokens = 0;
  let unknownTokens = 0;

  for (const event of filtered) {
    addBuckets(tokens, event.tokens);
    const observed = event.attribution === "observed" && event.skill !== null;
    if (observed) {
      observedRequests += 1;
      observedTokens += event.tokens.total;
    } else {
      unknownRequests += 1;
      unknownTokens += event.tokens.total;
    }

    const skill = event.skill ?? NO_SKILL;
    let skillSummary = bySkill.get(skill);
    if (!skillSummary) {
      skillSummary = {
        skill,
        attribution: skill === NO_SKILL ? "unknown" : "observed",
        requests: 0,
        observedRequests: 0,
        unknownRequests: 0,
        share: 0,
        ...EMPTY_BUCKETS,
      };
      bySkill.set(skill, skillSummary);
    }
    skillSummary.requests += 1;
    if (observed) skillSummary.observedRequests += 1;
    else skillSummary.unknownRequests += 1;
    addBuckets(skillSummary, event.tokens);

    const sourceSummary = bySource.get(event.source);
    if (sourceSummary) {
      sourceSummary.requests += 1;
      if (observed) sourceSummary.observedRequests += 1;
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
    attribution: {
      observedRequests,
      unknownRequests,
      observedTokens,
      unknownTokens,
    },
    bySkill: summaries,
    bySource: sourceSummaries,
    warnings: normalizeWarnings(warnings),
  };
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
    omp: [
      env.OMP_AGENT_SESSION_DIR ?? env.OMP_SESSION_DIR ?? join(home, ".omp", "agent", "sessions"),
    ],
  };
}

type AttributionInfo = {
  skill: string | null;
  method: AttributionMethod;
};

type AttributionPoint = AttributionInfo & {
  source: UsageSource;
  sourcePath: string;
  sessionId: string | null;
  timestampMs: number;
  order: number;
};

type AttributionIndex = {
  exact: Map<string, AttributionInfo>;
  timelines: Map<string, AttributionPoint[]>;
};

function attributionKey(source: UsageSource, sourcePath: string, sourceRecordId: string): string {
  return `${source}:${resolve(sourcePath)}:${sourceRecordId}`;
}

function timelineKey(source: UsageSource, sourcePath: string, sessionId: string | null): string {
  return `${source}:${resolve(sourcePath)}:${sessionId ?? ""}`;
}

function pathTimelineKey(source: UsageSource, sourcePath: string): string {
  return `${source}:${resolve(sourcePath)}:`;
}

function addAttributionPoint(index: AttributionIndex, point: AttributionPoint): void {
  const key = timelineKey(point.source as UsageSource, point.sourcePath, point.sessionId);
  const points = index.timelines.get(key) ?? [];
  points.push(point);
  index.timelines.set(key, points);
}

function setExactAttribution(
  index: AttributionIndex,
  source: UsageSource,
  sourcePath: string,
  sourceRecordId: string,
  info: AttributionInfo,
): void {
  index.exact.set(attributionKey(source, sourcePath, sourceRecordId), info);
}

function sourceFromMemex(value: unknown): UsageSource | null {
  if (value === "claude" || value === "codex" || value === "pi" || value === "omp") return value;
  return null;
}

function valueAsObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromUnknown).filter(Boolean).join("\n");
  const object = valueAsObject(value);
  if (!object) return "";
  for (const key of ["text", "input_text", "message", "content", "value"]) {
    const text = textFromUnknown(object[key]);
    if (text) return text;
  }
  return "";
}

function roleAndText(record: JsonObject): { role: string | null; text: string } {
  const candidates: JsonObject[] = [];
  for (const candidate of [record.message, record.payload, record]) {
    const object = valueAsObject(candidate);
    if (object) candidates.push(object);
  }
  for (const candidate of candidates) {
    const role = optionalString(candidate.role);
    if (role) {
      return {
        role,
        text: textFromUnknown(candidate.content ?? candidate.text ?? candidate.message),
      };
    }
  }
  return { role: null, text: "" };
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

function explicitSkillFromRecord(record: JsonObject, text: string): string | null {
  const type = optionalString(record.type)?.toLowerCase() ?? "";
  if (type.includes("skill")) {
    const direct = explicitSkillName(record.skill) ?? explicitSkillName(record.name);
    if (direct) return direct;
  }
  const payload = valueAsObject(record.payload);
  if (payload && optionalString(payload.type)?.toLowerCase().includes("skill")) {
    const direct = explicitSkillName(payload.skill) ?? explicitSkillName(payload.name);
    if (direct) return direct;
  }
  return explicitSkillFromText(text);
}

function sessionIdFromRecord(record: JsonObject, current: string | null): string | null {
  if (record.type === "session") return optionalString(record.id) ?? current;
  if (record.type === "session_meta") {
    const payload = valueAsObject(record.payload);
    return optionalString(payload?.id ?? payload?.session_id) ?? current;
  }
  return optionalString(record.session_id ?? record.sessionId) ?? current;
}

function timestampFromRecord(record: JsonObject): number {
  const message = valueAsObject(record.message);
  return timestampMillis(record.timestamp ?? message?.timestamp ?? record.created_at);
}

function modelFromRecord(record: JsonObject, current: string | null): string | null {
  const message = valueAsObject(record.message);
  const payload = valueAsObject(record.payload);
  return optionalString(message?.model ?? record.model ?? payload?.model ?? payload?.model_name) ?? current;
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
  usage: JsonObject,
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
    cwd: optionalString(record.cwd),
    model,
    skill,
    attribution: skill ? "observed" : "unknown",
    attributionMethod: method,
    sidechain: record.isSidechain === true,
    timestampMs: timestampFromRecord(record),
    tokens: buckets,
  };
}

async function scanLocalSourceFile(
  path: string,
  source: UsageSource,
  index: AttributionIndex,
  events: Map<string, UsageEvent>,
  warnings: string[],
  includeTokens: boolean,
  orderRef: { value: number },
): Promise<void> {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  let sessionId: string | null = null;
  let currentSkill: string | null = null;
  let currentModel: string | null = null;

  try {
    for await (const line of lines) {
      lineNumber += 1;
      const hasUsageHint = /"usage"|"token_count"|\/skill:|skill:\/\//i.test(line);
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
      const { role, text } = roleAndText(object);
      const timestampMs = timestampFromRecord(object);

      if (role === "user") {
        const invokedSkill = explicitSkillFromRecord(object, text);
        currentSkill = invokedSkill;
        if (source !== "claude") {
          addAttributionPoint(index, {
            source,
            sourcePath: resolve(path),
            sessionId,
            timestampMs,
            order: orderRef.value++,
            skill: invokedSkill,
            method: invokedSkill ? "explicit-skill-invocation" : "unknown",
          });
        }
      }

      if (!includeTokens) {
        if (source === "claude" && (object.type === "assistant" || role === "assistant")) {
          const nativeSkill = optionalString(object.attributionSkill);
          const sourceRecordId = `line:${lineNumber}`;
          setExactAttribution(index, source, path, sourceRecordId, {
            skill: nativeSkill,
            method: nativeSkill ? "claude-attributionSkill" : "unknown",
          });
        }
        continue;
      }

      if (source === "claude" && object.type === "assistant") {
        const usage = usageFromRecord(object);
        if (!usage) continue;
        const nativeSkill = optionalString(object.attributionSkill);
        const event = usageEventFromRecord(
          source,
          path,
          lineNumber,
          object,
          sessionId,
          currentModel,
          nativeSkill,
          nativeSkill ? "claude-attributionSkill" : "unknown",
          usage,
          bucketsFor(usage),
        );
        if (event) {
          setExactAttribution(index, source, path, event.sourceRecordId!, {
            skill: nativeSkill,
            method: nativeSkill ? "claude-attributionSkill" : "unknown",
          });
          addEvent(events, event);
        }
        continue;
      }

      if ((source === "pi" || source === "omp") && role === "assistant") {
        const usage = usageFromRecord(object);
        if (!usage) continue;
        const event = usageEventFromRecord(
          source,
          path,
          lineNumber,
          object,
          sessionId,
          currentModel,
          currentSkill,
          currentSkill ? "explicit-skill-invocation" : "unknown",
          usage,
          bucketsFor(usage),
        );
        if (event) addEvent(events, event);
        continue;
      }

      if (source === "codex") {
        const usage = codexUsageFromRecord(object);
        if (!usage) continue;
        const event = usageEventFromRecord(
          source,
          path,
          lineNumber,
          object,
          sessionId,
          currentModel,
          currentSkill,
          currentSkill ? "explicit-skill-invocation" : "unknown",
          usage,
          codexBucketsFor(usage),
        );
        if (event) addEvent(events, event);
      }
    }
  } catch (error: unknown) {
    warnings.push(`cannot scan ${path}: ${String(error)}`);
  } finally {
    lines.close();
  }
}

async function scanClaudeFile(
  path: string,
  events: Map<string, UsageEvent>,
  warnings: string[],
): Promise<void> {
  const index: AttributionIndex = { exact: new Map(), timelines: new Map() };
  await scanLocalSourceFile(path, "claude", index, events, warnings, true, { value: 0 });
}

export async function scanUsage(options: ScanOptions = {}): Promise<UsageReport> {
  const roots = [...(options.roots ?? defaultUsageRoots(options.env))].map((root) => resolve(root));
  const warnings: string[] = [];
  const files = new Set<string>();
  for (const root of roots) {
    for (const file of await discoverJsonlFiles(root, warnings)) files.add(file);
  }

  const events = new Map<string, UsageEvent>();
  for (const file of [...files].sort()) await scanClaudeFile(file, events, warnings);

  const filtered = [...events.values()]
    .filter((event) => matches(event, options))
    .sort((left, right) => {
      if (left.timestampMs !== right.timestampMs) return left.timestampMs - right.timestampMs;
      if (left.sourcePath !== right.sourcePath) return left.sourcePath.localeCompare(right.sourcePath);
      return left.line - right.line;
    });

  return buildReport(filtered, roots, files.size, warnings);
}

type MemexEventInput = {
  source: UsageSource;
  sourcePath: string;
  sourceRecordId: string | null;
  requestId: string | null;
  messageId: string | null;
  sessionId: string | null;
  cwd: string | null;
  model: string | null;
  timestampMs: number;
  tokens: TokenBuckets;
};

function parseMemexOutput(
  output: string | JsonObject,
  warnings: string[],
): MemexEventInput[] {
  let value: unknown = output;
  if (typeof output === "string") {
    try {
      value = JSON.parse(output);
    } catch (error) {
      warnings.push(`invalid Memex JSON: ${String(error)}`);
      return [];
    }
  }
  const object = valueAsObject(value);
  const details = Array.isArray(object?.details) ? object.details : [];
  const events: MemexEventInput[] = [];
  for (const [index, detail] of details.entries()) {
    const item = valueAsObject(detail);
    if (!item) continue;
    const source = sourceFromMemex(item.source);
    if (!source) continue;
    const sourcePath = optionalString(item.source_path);
    if (!sourcePath) {
      warnings.push(`Memex event ${index} has no source path`);
      continue;
    }
    const tokensObject = valueAsObject(item.tokens);
    if (!tokensObject) continue;
    const tokens = memexBucketsFor(tokensObject);
    if (tokens.total === 0) continue;
    events.push({
      source,
      sourcePath: resolve(sourcePath),
      sourceRecordId: optionalString(item.source_record_id),
      requestId: optionalString(item.request_id),
      messageId: optionalString(item.message_id),
      sessionId: optionalString(item.session_id),
      cwd: optionalString(item.project),
      model: optionalString(item.model),
      timestampMs: timestampMsValue(item.timestamp_ms),
      tokens,
    });
  }
  return events;
}

async function loadMemexEvents(
  options: AllSourceScanOptions,
  warnings: string[],
): Promise<MemexEventInput[]> {
  if (options.memexOutput !== undefined) return parseMemexOutput(options.memexOutput, warnings);
  if (options.useMemex === false) return [];

  try {
    const result = await execFile(options.memexCommand ?? "memex", ["usage", "--json", "--events"], {
      env: options.env ?? process.env,
      maxBuffer: 256 * 1024 * 1024,
    });
    return parseMemexOutput(result.stdout, warnings);
  } catch (error: unknown) {
    warnings.push(`Memex unavailable; using local parsers: ${String(error)}`);
    return [];
  }
}

function applyAttribution(event: MemexEventInput, index: AttributionIndex): UsageEvent {
  let info: AttributionInfo | undefined;
  let latestTimestamp = -1;
  if (event.sourceRecordId) {
    info = index.exact.get(attributionKey(event.source, event.sourcePath, event.sourceRecordId));
  }
  if (!info) {
    const keys = [
      timelineKey(event.source, event.sourcePath, event.sessionId),
      pathTimelineKey(event.source, event.sourcePath),
    ];
    for (const key of keys) {
      const points = index.timelines.get(key);
      if (!points) continue;
      for (const point of points) {
        if (event.timestampMs === 0 || point.timestampMs <= event.timestampMs) {
          if (point.timestampMs > latestTimestamp) {
            latestTimestamp = point.timestampMs;
            info = point;
          }
        }
      }
      if (info) break;
    }
  }
  const skill = info?.skill ?? null;
  return {
    source: event.source,
    sourcePath: event.sourcePath,
    line: 0,
    sourceRecordId: event.sourceRecordId,
    requestId: event.requestId,
    messageId: event.messageId,
    sessionId: event.sessionId,
    cwd: event.cwd,
    model: event.model,
    skill,
    attribution: skill ? "observed" : "unknown",
    attributionMethod: info?.method ?? "unknown",
    sidechain: false,
    timestampMs: event.timestampMs,
    tokens: event.tokens,
  };
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
  const sources = [...(options.sources ?? SOURCES)];
  const warnings: string[] = [];
  const memexEvents = await loadMemexEvents(options, warnings);
  const selectedMemexEvents = memexEvents.filter((event) => sources.includes(event.source));
  const memexSources = new Set(selectedMemexEvents.map((event) => event.source));
  const sourceRoots = rootsForSources(options, sources);
  const attribution: AttributionIndex = { exact: new Map(), timelines: new Map() };
  const localEvents = new Map<string, UsageEvent>();

  for (const source of sources) {
    const paths = new Set<string>();
    for (const root of sourceRoots[source]) {
      for (const file of await discoverJsonlFiles(root, warnings)) paths.add(file);
    }
    for (const event of selectedMemexEvents) {
      if (event.source === source) paths.add(event.sourcePath);
    }

    for (const path of [...paths].sort()) {
      await scanLocalSourceFile(
        path,
        source,
        attribution,
        localEvents,
        warnings,
        !memexSources.has(source),
        { value: 0 },
      );
    }
  }

  const events = selectedMemexEvents.map((event) => applyAttribution(event, attribution));
  for (const event of localEvents.values()) {
    if (!memexSources.has(event.source)) events.push(event);
  }

  const filtered = events
    .filter((event) => matches(event, options))
    .sort((left, right) => {
      if (left.timestampMs !== right.timestampMs) return left.timestampMs - right.timestampMs;
      if (left.source !== right.source) return left.source.localeCompare(right.source);
      return left.sourcePath.localeCompare(right.sourcePath);
    });

  const roots = sources.flatMap((source) => sourceRoots[source].map((root) => resolve(root)));
  const files = new Set(filtered.map((event) => event.sourcePath));
  return buildReport(filtered, roots, files.size, warnings, sources);
}
