import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export type SessionHarness = "pi" | "omp" | "codex" | "claude";

export type SessionCitation = {
  source: string;
  harness: SessionHarness;
  session_id: string;
  moment_id: string;
  timestamp: string;
  snippet: string;
  role: string;
};

export type SessionConflict = {
  topic: string;
  positions: Array<{ decision: string; citation: SessionCitation }>;
};

export type SessionRecallResult = {
  answer: string;
  citations: SessionCitation[];
  degraded: boolean;
  warnings: string[];
  conflicts: SessionConflict[];
  elapsed_ms: number;
};

export type SessionInspectResult = {
  session_id: string;
  harness: string;
  source: string;
  moment: {
    moment_id: string;
    timestamp: string;
    role: string;
    content: string;
  };
};

export type SessionMoment = {
  moment_id: string;
  role: string;
  content: string;
  timestamp: string;
};

export type SessionExpandResult = {
  session_id: string;
  moments: SessionMoment[];
};

export type SessionResumePacket = {
  session_id: string;
  title: string;
  harness: string;
  source: string;
  last_active: string;
  decisions: string[];
  unfinished_work: string[];
  excerpts: string[];
};

export type SessionQueryResult = {
  session_id: string;
  answer: string;
  moments: SessionMoment[];
};

export type SessionStatusSource = {
  name: string;
  harness: string;
  sessions_count: number;
  last_sync: string;
};

export type SessionStatusResult = {
  healthy: boolean;
  cass_available: boolean;
  hybrid_ready: boolean;
  sources: SessionStatusSource[];
  warnings: string[];
  exclusions: { sessions: string[]; sources: string[] };
  purged: { sessions: string[]; sources: string[] };
};

export type SessionManageAction = "exclude" | "purge" | "disconnect" | "reinclude";

export type SessionManageResult = {
  action: SessionManageAction;
  session?: string;
  source?: string;
  ok: boolean;
  message?: string;
};

export type SessionHistoryToolError = {
  error: string;
  code?: string;
  message?: string;
};

export type SessionHistoryPayload =
  | SessionRecallResult
  | SessionInspectResult
  | SessionExpandResult
  | SessionResumePacket
  | SessionQueryResult
  | SessionStatusResult
  | SessionManageResult
  | SessionHistoryToolError;

export type SessionHistoryRunner = (
  args: string[],
  options?: { env?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number },
) => Promise<unknown>;

type ToolApprovalDecision = "read" | "write" | "exec" | {
  tier: "read" | "write" | "exec";
  reason?: string;
  override?: boolean;
  policy?: "allow" | "deny" | "prompt";
};

type ToolApproval = ToolApprovalDecision | ((input: unknown) => ToolApprovalDecision);

export type RuntimeHost = {
  registerTool?: (definition: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    approval?: ToolApproval;
    execute: (...args: unknown[]) => unknown;
  }) => void;
};

type ToolUserContext = {
  ui?: {
    confirm?: (title: string, message: string) => Promise<boolean>;
  };
};

type RecallInput = {
  query: string;
  limit?: number;
  mode?: "hybrid" | "lexical-only";
};

type InspectInput = {
  session: string;
  moment: string;
};

type ExpandInput = {
  session: string;
  moment: string;
  before?: number;
  after?: number;
};

type ResumeInput = {
  session: string;
};

type QueryInput = {
  session: string;
  query: string;
};

type ManageInput = {
  action: SessionManageAction;
  session?: string;
  source?: string;
};

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/session-history.py", import.meta.url));
const RECALL_TIMEOUT_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

const RECALL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 1, description: "Natural-language search over session history." },
    limit: { type: "integer", minimum: 1, maximum: 10, default: 3, description: "Maximum citations to return (default 3)." },
    mode: {
      type: "string",
      enum: ["hybrid", "lexical-only"],
      default: "hybrid",
      description: "Retrieval mode. Hybrid uses lexical and semantic paths when available.",
    },
  },
} as const;

const INSPECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["session", "moment"],
  properties: {
    session: { type: "string", minLength: 1, description: "Session id from a citation." },
    moment: { type: "string", minLength: 1, description: "Moment id from a citation." },
  },
} as const;

const EXPAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["session", "moment"],
  properties: {
    session: { type: "string", minLength: 1, description: "Session id from a citation." },
    moment: { type: "string", minLength: 1, description: "Moment id from a citation." },
    before: { type: "integer", minimum: 0, default: 3, description: "Moments before the anchor (default 3)." },
    after: { type: "integer", minimum: 0, default: 3, description: "Moments after the anchor (default 3)." },
  },
} as const;

const RESUME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["session"],
  properties: {
    session: { type: "string", minLength: 1, description: "Session id to resume." },
  },
} as const;

const QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["session", "query"],
  properties: {
    session: { type: "string", minLength: 1, description: "Session id to search within." },
    query: { type: "string", minLength: 1, description: "Natural-language query within the session." },
  },
} as const;

const STATUS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

const MANAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["exclude", "purge", "disconnect", "reinclude"],
      description: "Lifecycle action to apply.",
    },
    session: { type: "string", minLength: 1, description: "Session id targeted by the action." },
    source: { type: "string", minLength: 1, description: "Source name targeted by the action." },
  },
} as const;

export function installSessionHistoryTools(
  host: RuntimeHost,
  options: { runner?: SessionHistoryRunner; consent?: "context" | "approval" } = {},
): void {
  if (typeof host?.registerTool !== "function") {
    throw new Error("session-history requires the host's native registerTool seam");
  }

  const runner = options.runner ?? runSessionHistoryCli;
  const consent = options.consent ?? "context";
  const readApproval = consent === "approval" ? "read" : undefined;
  const manageApproval = consent === "approval" ? manageApprovalFn : undefined;

  host.registerTool({
    name: "session_recall",
    label: "Recall session history",
    description: "Search cross-agent session history with provenance-preserving citations. Use when the user nudges recall or plot continuity is clear. Returns a concise answer with 1-3 citations.",
    parameters: RECALL_SCHEMA,
    approval: readApproval,
    execute: async (...args: unknown[]) => {
      const input = toolInput<RecallInput>(args);
      const value = await runner(buildRecallArgs(input), {
        signal: toolSignal(args),
        timeoutMs: RECALL_TIMEOUT_MS,
      });
      return textResult(parseToolPayload(value, parseRecallResult));
    },
  });

  host.registerTool({
    name: "session_inspect",
    label: "Inspect session moment",
    description: "Inspect the exact moment behind a session-history citation.",
    parameters: INSPECT_SCHEMA,
    approval: readApproval,
    execute: async (...args: unknown[]) => {
      const input = toolInput<InspectInput>(args);
      const value = await runner(buildInspectArgs(input), { signal: toolSignal(args) });
      return textResult(parseToolPayload(value, parseInspectResult));
    },
  });

  host.registerTool({
    name: "session_expand",
    label: "Expand session context",
    description: "Expand surrounding transcript context for a session-history citation.",
    parameters: EXPAND_SCHEMA,
    approval: readApproval,
    execute: async (...args: unknown[]) => {
      const input = toolInput<ExpandInput>(args);
      const value = await runner(buildExpandArgs(input), { signal: toolSignal(args) });
      return textResult(parseToolPayload(value, parseExpandResult));
    },
  });

  host.registerTool({
    name: "session_resume",
    label: "Resume prior session",
    description: "Build a resume packet with excerpts, recorded decisions, and unfinished work from a prior session.",
    parameters: RESUME_SCHEMA,
    approval: readApproval,
    execute: async (...args: unknown[]) => {
      const input = toolInput<ResumeInput>(args);
      const value = await runner(buildResumeArgs(input), { signal: toolSignal(args) });
      return textResult(parseToolPayload(value, parseResumeResult));
    },
  });

  host.registerTool({
    name: "session_query",
    label: "Query one session",
    description: "Search within a single selected session without corpus-wide retrieval.",
    parameters: QUERY_SCHEMA,
    approval: readApproval,
    execute: async (...args: unknown[]) => {
      const input = toolInput<QueryInput>(args);
      const value = await runner(buildQueryArgs(input), { signal: toolSignal(args) });
      return textResult(parseToolPayload(value, parseQueryResult));
    },
  });

  host.registerTool({
    name: "session_status",
    label: "Session history status",
    description: "Report session-history corpus health, hybrid readiness, and connected source status.",
    parameters: STATUS_SCHEMA,
    approval: readApproval,
    execute: async (...args: unknown[]) => {
      const value = await runner(buildStatusArgs(), { signal: toolSignal(args) });
      return textResult(parseToolPayload(value, parseStatusResult));
    },
  });

  host.registerTool({
    name: "session_manage",
    label: "Manage session history",
    description: "Exclude, purge, disconnect, or re-include sessions and sources from the session-history corpus.",
    parameters: MANAGE_SCHEMA,
    approval: manageApproval,
    execute: async (...args: unknown[]) => {
      const input = toolInput<ManageInput>(args);
      if (consent === "context" && !await confirmManage(args)) {
        return textResult({
          error: "authorization_cancelled",
          message: "Session history manage action requires explicit human approval.",
        });
      }
      const value = await runner(buildManageArgs(input), { signal: toolSignal(args) });
      return textResult(parseToolPayload(value, parseManageResult));
    },
  });
}

export async function runSessionHistoryCli(
  args: string[],
  options: {
    env?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
    pythonBinary?: string;
    scriptPath?: string;
  } = {},
): Promise<unknown> {
  const pythonBinary = options.pythonBinary ?? process.env.SESSION_HISTORY_PYTHON ?? "python3";
  const scriptPath = options.scriptPath ?? SCRIPT_PATH;
  const timeoutMs = options.timeoutMs ?? (args[0] === "recall" ? RECALL_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

  return await new Promise<unknown>((resolve, reject) => {
    execFile(
      pythonBinary,
      [scriptPath, ...args],
      {
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
        signal: options.signal,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        if (error) {
          if (options.signal?.aborted) {
            reject(new Error("Session history request cancelled"));
            return;
          }
          const detail = redactProcessDetail(stderr.trim() || error.message);
          reject(new Error(`Session history request failed: ${detail}`));
          return;
        }

        try {
          const parsed: unknown = JSON.parse(stdout);
          assertNoSecretFields(parsed);
          resolve(parsed);
        } catch (parseError) {
          const detail = parseError instanceof Error ? parseError.message : String(parseError);
          reject(new Error(`Session history returned an invalid result: ${detail}`));
        }
      },
    );
  });
}

export function buildRecallArgs(input: RecallInput): string[] {
  const query = requiredText(input.query, "query");
  const args = ["recall", "--query", query, "--json"];
  const limit = input.limit ?? 3;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  args.push("--limit", String(limit));
  const mode = input.mode ?? "hybrid";
  if (mode === "lexical-only") args.push("--lexical-only");
  else args.push("--hybrid");
  return args;
}

export function buildInspectArgs(input: InspectInput): string[] {
  return [
    "inspect",
    "--session", requiredText(input.session, "session"),
    "--moment", requiredText(input.moment, "moment"),
    "--json",
  ];
}

export function buildExpandArgs(input: ExpandInput): string[] {
  const args = [
    "expand",
    "--session", requiredText(input.session, "session"),
    "--moment", requiredText(input.moment, "moment"),
    "--json",
  ];
  if (input.before !== undefined) {
    if (!Number.isInteger(input.before) || input.before < 0) throw new Error("before must be a non-negative integer");
    args.push("--before", String(input.before));
  }
  if (input.after !== undefined) {
    if (!Number.isInteger(input.after) || input.after < 0) throw new Error("after must be a non-negative integer");
    args.push("--after", String(input.after));
  }
  return args;
}

export function buildResumeArgs(input: ResumeInput): string[] {
  return ["resume", "--session", requiredText(input.session, "session"), "--json"];
}

export function buildQueryArgs(input: QueryInput): string[] {
  return [
    "query-session",
    "--session", requiredText(input.session, "session"),
    "--query", requiredText(input.query, "query"),
    "--json",
  ];
}

export function buildStatusArgs(): string[] {
  return ["status", "--json"];
}

export function buildManageArgs(input: ManageInput): string[] {
  const action = requiredManageAction(input.action, "action");
  const args = ["manage", "--action", action, "--json"];
  if (input.session !== undefined) args.push("--session", requiredText(input.session, "session"));
  if (input.source !== undefined) args.push("--source", requiredText(input.source, "source"));
  if ((action === "exclude" || action === "purge" || action === "reinclude") && input.session === undefined && input.source === undefined) {
    throw new Error("session or source is required for this manage action");
  }
  if (action === "disconnect" && input.source === undefined) {
    throw new Error("source is required for disconnect");
  }
  return args;
}

function manageApprovalFn(input: unknown): ToolApprovalDecision {
  const action = typeof input === "object" && input !== null && "action" in input
    ? (input as { action?: string }).action
    : undefined;
  if (action === "reinclude") return "write";
  if (action === "exclude" || action === "disconnect") {
    return {
      tier: "write",
      reason: `Session history ${action}`,
      override: true,
      policy: "prompt",
    };
  }
  if (action === "purge") {
    return {
      tier: "exec",
      reason: "Session history purge",
      override: true,
      policy: "prompt",
    };
  }
  return "write";
}

async function confirmManage(args: unknown[]): Promise<boolean> {
  const input = toolInput<ManageInput>(args);
  const destructive = input.action === "exclude"
    || input.action === "disconnect"
    || input.action === "purge";
  if (!destructive) return true;
  const ui = args.find((candidate) => (
    candidate
    && typeof candidate === "object"
    && "ui" in candidate
    && (candidate as ToolUserContext).ui
  )) as ToolUserContext | undefined;
  if (typeof ui?.ui?.confirm === "function") {
    const target = input.session ?? input.source ?? "target";
    return await ui.ui.confirm(
      "Session history manage",
      `Apply ${input.action} to ${target}?`,
    );
  }
  return false;
}

function parseToolPayload<T extends SessionHistoryPayload>(
  value: unknown,
  parse: (record: Record<string, unknown>) => T,
): SessionHistoryPayload {
  const record = objectValue(value, "payload");
  if (isToolError(record)) return record;
  return parse(record);
}

function isToolError(record: Record<string, unknown>): record is SessionHistoryToolError {
  return typeof record.error === "string";
}

function parseRecallResult(record: Record<string, unknown>): SessionRecallResult {
  return {
    answer: stringValue(record.answer, "answer"),
    citations: citationsValue(record.citations, "citations"),
    degraded: booleanValue(record.degraded, "degraded"),
    warnings: stringsValue(record.warnings, "warnings"),
    conflicts: conflictsValue(record.conflicts, "conflicts"),
    elapsed_ms: numberValue(record.elapsed_ms, "elapsed_ms"),
  };
}

function parseInspectResult(record: Record<string, unknown>): SessionInspectResult {
  const moment = objectValue(record.moment, "moment");
  return {
    session_id: stringValue(record.session_id, "session_id"),
    harness: stringValue(record.harness, "harness"),
    source: stringValue(record.source, "source"),
    moment: {
      moment_id: stringValue(moment.moment_id, "moment.moment_id"),
      timestamp: stringValue(moment.timestamp, "moment.timestamp"),
      role: stringValue(moment.role, "moment.role"),
      content: stringValue(moment.content, "moment.content"),
    },
  };
}

function parseExpandResult(record: Record<string, unknown>): SessionExpandResult {
  return {
    session_id: stringValue(record.session_id, "session_id"),
    moments: momentsValue(record.moments, "moments"),
  };
}

function parseResumeResult(record: Record<string, unknown>): SessionResumePacket {
  return {
    session_id: stringValue(record.session_id, "session_id"),
    title: stringValue(record.title, "title"),
    harness: stringValue(record.harness, "harness"),
    source: stringValue(record.source, "source"),
    last_active: stringValue(record.last_active, "last_active"),
    decisions: stringsValue(record.decisions, "decisions"),
    unfinished_work: stringsValue(record.unfinished_work, "unfinished_work"),
    excerpts: stringsValue(record.excerpts, "excerpts"),
  };
}

function parseQueryResult(record: Record<string, unknown>): SessionQueryResult {
  return {
    session_id: stringValue(record.session_id, "session_id"),
    answer: stringValue(record.answer, "answer"),
    moments: momentsValue(record.moments, "moments"),
  };
}

function parseStatusResult(record: Record<string, unknown>): SessionStatusResult {
  const exclusions = objectValue(record.exclusions, "exclusions");
  const purged = objectValue(record.purged, "purged");
  return {
    healthy: booleanValue(record.healthy, "healthy"),
    cass_available: booleanValue(record.cass_available, "cass_available"),
    hybrid_ready: booleanValue(record.hybrid_ready, "hybrid_ready"),
    sources: arrayValue(record.sources, "sources").map((entry, index) => {
      const source = objectValue(entry, `sources[${index}]`);
      return {
        name: stringValue(source.name, `sources[${index}].name`),
        harness: stringValue(source.harness, `sources[${index}].harness`),
        sessions_count: numberValue(source.sessions_count, `sources[${index}].sessions_count`),
        last_sync: stringValue(source.last_sync, `sources[${index}].last_sync`),
      };
    }),
    warnings: stringsValue(record.warnings, "warnings"),
    exclusions: {
      sessions: stringsValue(exclusions.sessions, "exclusions.sessions"),
      sources: stringsValue(exclusions.sources, "exclusions.sources"),
    },
    purged: {
      sessions: stringsValue(purged.sessions, "purged.sessions"),
      sources: stringsValue(purged.sources, "purged.sources"),
    },
  };
}

function parseManageResult(record: Record<string, unknown>): SessionManageResult {
  const result: SessionManageResult = {
    action: requiredManageAction(record.action, "action"),
    ok: booleanValue(record.ok, "ok"),
  };
  if (record.session !== undefined) result.session = stringValue(record.session, "session");
  if (record.source !== undefined) result.source = stringValue(record.source, "source");
  if (record.message !== undefined) result.message = stringValue(record.message, "message");
  return result;
}

function citationValue(value: unknown, name: string): SessionCitation {
  const record = objectValue(value, name);
  return {
    source: stringValue(record.source, `${name}.source`),
    harness: harnessValue(record.harness, `${name}.harness`),
    session_id: stringValue(record.session_id, `${name}.session_id`),
    moment_id: stringValue(record.moment_id, `${name}.moment_id`),
    timestamp: stringValue(record.timestamp, `${name}.timestamp`),
    snippet: stringValue(record.snippet, `${name}.snippet`),
    role: stringValue(record.role, `${name}.role`),
  };
}

function citationsValue(value: unknown, name: string): SessionCitation[] {
  return arrayValue(value, name).map((entry, index) => citationValue(entry, `${name}[${index}]`));
}

function conflictsValue(value: unknown, name: string): SessionConflict[] {
  return arrayValue(value, name).map((entry, index) => {
    const conflict = objectValue(entry, `${name}[${index}]`);
    return {
      topic: stringValue(conflict.topic, `${name}[${index}].topic`),
      positions: arrayValue(conflict.positions, `${name}[${index}].positions`).map((positionEntry, positionIndex) => {
        const position = objectValue(positionEntry, `${name}[${index}].positions[${positionIndex}]`);
        return {
          decision: stringValue(position.decision, `${name}[${index}].positions[${positionIndex}].decision`),
          citation: citationValue(position.citation, `${name}[${index}].positions[${positionIndex}].citation`),
        };
      }),
    };
  });
}

function momentsValue(value: unknown, name: string): SessionMoment[] {
  return arrayValue(value, name).map((entry, index) => {
    const moment = objectValue(entry, `${name}[${index}]`);
    return {
      moment_id: stringValue(moment.moment_id, `${name}[${index}].moment_id`),
      role: stringValue(moment.role, `${name}[${index}].role`),
      content: stringValue(moment.content, `${name}[${index}].content`),
      timestamp: stringValue(moment.timestamp, `${name}[${index}].timestamp`),
    };
  });
}

function harnessValue(value: unknown, name: string): SessionHarness {
  return enumValue(value, name, ["pi", "omp", "codex", "claude"]);
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`);
  return value;
}

function requiredManageAction(value: unknown, name: string): SessionManageAction {
  return enumValue(value, name, ["exclude", "purge", "disconnect", "reinclude"]);
}

function enumValue<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  const text = stringValue(value, name);
  if ((allowed as readonly string[]).includes(text)) return text as T;
  throw new Error(`${name} must be one of ${allowed.join(", ")}`);
}

function arrayValue(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function numberValue(value: unknown, name: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) throw new Error(`${name} must be a number`);
  return value;
}

function stringsValue(value: unknown, name: string): string[] {
  return arrayValue(value, name).map((entry) => stringValue(entry, name));
}

function toolInput<T>(args: unknown[]): T {
  const input = args[1];
  if (typeof input !== "object" || input === null) throw new Error("tool input must be an object");
  return input as T;
}

function toolSignal(args: unknown[]): AbortSignal | undefined {
  const signal = args[2];
  return signal instanceof AbortSignal ? signal : undefined;
}

function textResult(value: SessionHistoryPayload): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function assertNoSecretFields(value: unknown): void {
  const forbidden = new Set([
    "access_token",
    "refresh_token",
    "device_code",
    "apiKey",
    "api_key",
    "password",
    "secret",
    "token",
  ]);
  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, child] of Object.entries(node)) {
      const childPath = path ? `${path}.${key}` : key;
      if (forbidden.has(key)) throw new Error(`forbidden secret field: ${childPath}`);
      visit(child, childPath);
    }
  };
  visit(value, "");
}

function redactProcessDetail(value: string): string {
  return value
    .replace(/cass-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/xai-[A-Za-z0-9_-]+/gi, "[redacted]");
}
