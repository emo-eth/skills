import {
  appendNoteRecord,
  parseCommandArgs,
  usage,
  normalizeNote,
  NOTE_COMMANDS,
  NOTE_KINDS,
  type BugHost,
} from "./record.ts";

export type SessionManager = {
  getSessionId?: () => unknown;
  getSessionName?: () => unknown;
  getSessionFile?: () => unknown;
  getTurn?: () => unknown;
  getEntries?: () => unknown;
  getBranch?: () => unknown;
};

export type RuntimeContext = {
  cwd?: unknown;
  sessionId?: unknown;
  turn?: unknown;
  model?: unknown;
  sessionManager?: SessionManager;
  ui?: {
    notify?: (message: string, level?: string) => void;
  };
};

export type RuntimeHost = {
  on?: (event: string, handler: (event: unknown, context: RuntimeContext) => unknown) => void;
  registerCommand?: (
    name: string,
    options: {
      description: string;
      handler: (args: string, context: RuntimeContext) => unknown;
    },
  ) => void;
};

type ActivityState = {
  plugin?: string;
  skill?: string;
  turn?: number;
  turnStartedAt?: string;
  lastEvent?: string;
  lastEventAt?: string;
  lastCommand?: string;
  lastTool?: string;
};

type SessionMetadata = {
  sessionId?: string;
  sessionName?: string;
  sessionFile?: string;
  turn?: number;
  sessionEntryCount?: number;
  branchEntryCount?: number;
};

const TRACKED_EVENTS = [
  "session_start",
  "before_agent_start",
  "message_start",
  "command",
  "tool_call",
  "tool_result",
  "user_bash",
  "agent_end",
];

export function installNoteCommands(host: RuntimeHost, agent: string, runtime: BugHost): void {
  if (typeof host.registerCommand !== "function") {
    throw new Error(`${runtime.toUpperCase()} note commands require the host registerCommand hook`);
  }

  const activityBySession = new Map<string, ActivityState>();
  const remember = (eventName: string, event: unknown, context: RuntimeContext): void => {
    const key = sessionKey(context);
    const state = activityBySession.get(key) ?? {};
    rememberEvent(state, eventName, event, context);
    activityBySession.set(key, state);
  };

  for (const eventName of TRACKED_EVENTS) {
    safeOn(host, eventName, (event, context) => {
      remember(eventName, event, context ?? {});
      return undefined;
    });
  }

  for (const kind of NOTE_KINDS) {
    const spec = NOTE_COMMANDS[kind];
    host.registerCommand(kind, {
      description: spec.description,
      handler: async (args, context) => {
        const parsed = parseCommandArgs(kind, args);
        const currentContext = context ?? {};
        const key = sessionKey(currentContext);
        const state = activityBySession.get(key);
        const session = readSessionMetadata(currentContext);
        try {
          const record = await appendNoteRecord({
            kind,
            note: parsed.note,
            host: runtime,
            agent,
            cwd: currentContext.cwd,
            model: currentContext.model,
            plugin: parsed.plugin ?? state?.plugin,
            skill: parsed.skill ?? state?.skill,
            sessionId: session.sessionId,
            sessionName: session.sessionName,
            sessionFile: session.sessionFile,
            turn: state?.turn ?? session.turn,
            turnStartedAt: state?.turnStartedAt,
            lastEvent: state?.lastEvent,
            lastEventAt: state?.lastEventAt,
            lastCommand: state?.lastCommand,
            lastTool: state?.lastTool,
            sessionEntryCount: session.sessionEntryCount,
            branchEntryCount: session.branchEntryCount,
          });
          const label = record.plugin ? ` for ${record.plugin}` : record.skill ? ` for ${record.skill}` : "";
          notify(currentContext, `${spec.label} logged${label}`, "info");
          return record;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === usage(kind)) throw error;
          notify(currentContext, `${spec.label} could not be logged: ${message}`, "error");
          return undefined;
        }
      },
    });
  }
}

function safeOn(
  host: RuntimeHost,
  eventName: string,
  handler: (event: unknown, context: RuntimeContext) => unknown,
): void {
  if (typeof host.on !== "function") return;
  try {
    host.on(eventName, handler);
  } catch {
    // A host may reject an event it does not expose; command registration still works.
  }
}

function rememberEvent(
  state: ActivityState,
  eventName: string,
  event: unknown,
  context: RuntimeContext,
): void {
  const now = new Date().toISOString();
  state.lastEvent = eventName;
  state.lastEventAt = now;

  const plugin = extractPluginName(event);
  if (plugin) state.plugin = plugin;
  const skill = extractSkillName(event);
  if (skill) state.skill = skill;
  const command = extractCommandName(event);
  if (command) state.lastCommand = command;
  const tool = extractToolName(event);
  if (tool) state.lastTool = tool;

  const explicitTurn = extractTurn(event) ?? contextTurn(context);
  if (explicitTurn !== undefined) {
    state.turn = explicitTurn;
    state.turnStartedAt = extractTimestamp(event) ?? state.turnStartedAt ?? now;
    return;
  }

  if (eventName === "before_agent_start") {
    state.turn = (state.turn ?? 0) + 1;
    state.turnStartedAt = extractTimestamp(event) ?? now;
  } else if (eventName === "message_start" && state.turn === undefined) {
    state.turn = 1;
    state.turnStartedAt = extractTimestamp(event) ?? now;
  }
}

function readSessionMetadata(context: RuntimeContext): SessionMetadata {
  const manager = context.sessionManager;
  const sessionId = stringValue(context.sessionId) ?? stringValue(callSessionMethod(manager, "getSessionId"));
  const sessionName = stringValue(callSessionMethod(manager, "getSessionName"));
  const sessionFile = stringValue(callSessionMethod(manager, "getSessionFile"));
  const turn = numberValue(context.turn) ?? numberValue(callSessionMethod(manager, "getTurn"));
  const entries = callSessionMethod(manager, "getEntries");
  const branch = callSessionMethod(manager, "getBranch");
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(sessionName ? { sessionName } : {}),
    ...(sessionFile ? { sessionFile } : {}),
    ...(turn !== undefined ? { turn } : {}),
    ...(Array.isArray(entries) ? { sessionEntryCount: entries.length } : {}),
    ...(Array.isArray(branch) ? { branchEntryCount: branch.length } : {}),
  };
}

function sessionKey(context: RuntimeContext): string {
  const manager = context.sessionManager;
  const sessionId = stringValue(context.sessionId) ?? stringValue(callSessionMethod(manager, "getSessionId"));
  const sessionFile = stringValue(callSessionMethod(manager, "getSessionFile"));
  const cwd = stringValue(context.cwd);
  return sessionId ?? sessionFile ?? cwd ?? "default";
}

function callSessionMethod(manager: SessionManager | undefined, method: keyof SessionManager): unknown {
  try {
    const candidate = manager?.[method];
    return typeof candidate === "function" ? candidate.call(manager) : undefined;
  } catch {
    return undefined;
  }
}

function extractPluginName(event: unknown): string | undefined {
  const value = asRecord(event);
  if (!value) return undefined;

  const direct = firstString(value, ["pluginName", "pluginId", "extensionName", "extensionId", "packageName"]);
  if (direct) return direct;
  const plugin = namedValue(value.plugin);
  if (plugin) return plugin;
  const extension = namedValue(value.extension);
  if (extension) return extension;

  const customType = stringValue(value.customType) ?? stringValue(value.type);
  if (customType?.toLowerCase().includes("plugin") || customType?.toLowerCase().includes("extension")) {
    const details = namedValue(value.details) ?? namedValue(value.message);
    if (details) return details;
  }

  const text = eventText(value);
  const marker = /<plugin\s+name="([^"]+)"/i.exec(text)
    ?? /<extension\s+name="([^"]+)"/i.exec(text)
    ?? /(?:^|\s)\/plugin:([^\s/]+)/i.exec(text);
  return marker?.[1] ? normalizeValue(marker[1]) : undefined;
}

function extractSkillName(event: unknown): string | undefined {
  if (typeof event === "string") return skillNameFromText(event);
  const value = asRecord(event);
  if (!value) return undefined;

  const direct = firstString(value, ["skillName"]);
  if (direct) return direct;
  const skill = namedValue(value.skill);
  if (skill) return skill;

  const details = asRecord(value.details);
  const detailName = stringValue(details?.name);
  if (detailName) return normalizeValue(detailName);

  const message = asRecord(value.message);
  const messageDetails = asRecord(message?.details);
  const messageDetailName = stringValue(messageDetails?.name);
  if (messageDetailName) return normalizeValue(messageDetailName);

  const text = eventText(value);
  return skillNameFromText(text);
}

function skillNameFromText(text: string): string | undefined {
  const marker = /<skill\s+name="([^"]+)"/i.exec(text)
    ?? /\[IMPORTANT:\s*User invoked the "([^"]+)" skill;/i.exec(text)
    ?? /(?:^|\s)\/skill:([^\s/]+)/i.exec(text);
  return marker?.[1] ? normalizeValue(marker[1]) : undefined;
}

function extractCommandName(event: unknown): string | undefined {
  const value = asRecord(event);
  if (!value) return undefined;
  const direct = firstString(value, ["commandName", "slashCommand", "command"]);
  if (direct) return stripCommandPrefix(direct);
  const details = asRecord(value.details);
  const nested = firstString(details, ["commandName", "slashCommand", "command"]);
  return nested ? stripCommandPrefix(nested) : undefined;
}

function extractToolName(event: unknown): string | undefined {
  const value = asRecord(event);
  if (!value) return undefined;
  const direct = firstString(value, ["toolName"]);
  if (direct) return direct;
  return namedValue(value.tool);
}

function extractTurn(event: unknown): number | undefined {
  const value = asRecord(event);
  if (!value) return undefined;
  const direct = firstNumber(value, ["turn", "turnNumber", "turnIndex"]);
  if (direct !== undefined) return direct;
  const details = asRecord(value.details);
  return firstNumber(details, ["turn", "turnNumber", "turnIndex"]);
}

function contextTurn(context: RuntimeContext): number | undefined {
  return numberValue(context.turn) ?? numberValue(callSessionMethod(context.sessionManager, "getTurn"));
}

function extractTimestamp(event: unknown): string | undefined {
  const value = asRecord(event);
  if (!value) return undefined;
  return firstString(value, ["startedAt", "timestamp", "createdAt"]);
}

function eventText(value: Record<string, unknown>): string {
  const parts: string[] = [];
  const prompt = stringValue(value.prompt);
  if (prompt) parts.push(prompt);
  const message = asRecord(value.message);
  if (message) {
    const messageText = stringValue(message.text);
    if (messageText) parts.push(messageText);
    parts.push(contentText(message.content));
  }
  parts.push(contentText(value.content));
  return parts.filter(Boolean).join("\n");
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const value = asRecord(part);
      return stringValue(value?.text) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function namedValue(value: unknown): string | undefined {
  if (typeof value === "string") return normalizeValue(value);
  const record = asRecord(value);
  return record ? firstString(record, ["name", "id", "commandName"]) : undefined;
}

function firstString(value: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const candidate = normalizeValue(value[key]);
    if (candidate) return candidate;
  }
  return undefined;
}

function firstNumber(value: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const candidate = numberValue(value[key]);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

function stripCommandPrefix(value: string): string | undefined {
  const normalized = normalizeValue(value);
  return normalized?.replace(/^\//, "") || undefined;
}

function normalizeValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeNote(value);
  return normalized || undefined;
}

function stringValue(value: unknown): string | undefined {
  return normalizeValue(value);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function notify(context: RuntimeContext, message: string, level: string): void {
  try {
    context.ui?.notify?.(message, level);
  } catch {
    // A notification failure must not change whether the bug was written.
  }
}
