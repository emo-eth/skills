import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import { discoverBotRoster, normalizeBotName } from "./config.ts";
import { formatRoster, formatStateSnapshot } from "./format.ts";
import {
  MaterializedBotRosterChangedError,
  isMaterializedBotRosterCurrent,
  materializeBotAgents,
  type MaterializedBotAgents,
  withMaterializedBotRosterLease,
  withMaterializedBotRosterMutation,
} from "./materialize.ts";
import { renderParentPrompt } from "./runtime.ts";
import { BotStateStore } from "./state.ts";
import { SubagentsAdapter, type EventBus } from "./subagents.ts";
import type { BotDefinition, BotRoster, DomainRecordKind } from "./types.ts";

type RuntimeContext = {
  cwd?: string;
  signal?: AbortSignal;
  sessionManager?: { getSessionId?: () => string };
  ui?: { notify?: (message: string, level?: string) => void };
};

type RuntimeHost = {
  events: EventBus;
  on(event: string, handler: (event: unknown, ctx: RuntimeContext) => unknown): void;
  registerCommand(name: string, options: {
    description?: string;
    handler: (args: string, ctx: RuntimeContext) => Promise<void>;
  }): void;
  registerTool(definition: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute: (
      toolCallId: string,
      params: unknown,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: RuntimeContext,
    ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
  }): void;
};

export type PiBotsOptions = {
  agentDir?: string;
};

export type BotsToolInput = {
  action: "list" | "run" | "context" | "record" | "remember" | "doctor";
  bot?: string;
  task?: string;
  domain?: string;
  kind?: DomainRecordKind;
  summary?: string;
  evidence?: string;
};

export class PiBotsController {
  private roster?: BotRoster;
  private store?: BotStateStore;
  private configError?: string;
  private materialized?: MaterializedBotAgents;
  private cwd?: string;
  private reloadCwd?: string;
  private reloadPromise?: Promise<BotRoster>;
  private readonly adapter: SubagentsAdapter;
  private readonly options: PiBotsOptions;
  private readonly runtimeName = process.env.PI_SUBAGENT_CHILD_AGENT;
  private readonly childProcess = process.env.PI_SUBAGENT_CHILD === "1";

  constructor(events: EventBus, options: PiBotsOptions = {}) {
    this.adapter = new SubagentsAdapter(events);
    this.options = options;
  }

  currentRoster(): BotRoster | undefined {
    return this.roster;
  }

  currentError(): string | undefined {
    return this.configError;
  }

  availableNames(): string[] {
    return this.adapter.availableNames();
  }

  async reload(cwd: string): Promise<BotRoster> {
    const requestedCwd = resolvePath(cwd);
    if (this.reloadPromise) {
      if (this.reloadCwd === requestedCwd) return this.reloadPromise;
      try {
        await this.reloadPromise;
      } catch {
      }
      return this.reload(requestedCwd);
    }
    this.reloadCwd = requestedCwd;
    const load = async () => {
      try {
        const discover = () => discoverBotRoster(requestedCwd, this.options.agentDir);
        let candidate = await discover();
        if (this.childProcess) {
          this.materialized = undefined;
        } else {
          for (let attempt = 0; ; attempt += 1) {
            try {
              this.materialized = await materializeBotAgents(candidate, discover);
              candidate = this.materialized.roster;
              break;
            } catch (error) {
              if (!(error instanceof MaterializedBotRosterChangedError) || attempt >= 2) throw error;
              candidate = await discover();
            }
          }
        }
        this.adapter.activateRoster(candidate);
        this.roster = candidate;
        this.store = new BotStateStore(candidate);
        this.cwd = requestedCwd;
        this.configError = undefined;
        return candidate;
      } catch (error) {
        this.configError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        this.reloadPromise = undefined;
        this.reloadCwd = undefined;
      }
    };
    this.reloadPromise = load();
    return this.reloadPromise;
  }

  async ensure(cwd: string): Promise<BotRoster> {
    const requestedCwd = resolvePath(cwd);
    if (this.reloadPromise) return this.reload(requestedCwd);
    if (!this.roster || !this.store || this.cwd !== requestedCwd) return this.reload(requestedCwd);
    if (await isMaterializedBotRosterCurrent(this.roster)) return this.roster;
    return this.reload(requestedCwd);
  }

  dispose(): void {
    this.adapter.dispose();
  }

  async prompt(cwd: string, existingSystemPrompt: string): Promise<string> {
    let roster: BotRoster;
    try {
      roster = await this.ensure(cwd);
    } catch {
      return `${existingSystemPrompt}\n\nPi Bots is unavailable: ${this.configError ?? "configuration failed"}`;
    }
    if (this.runtimeName) {
      const snapshot = await this.store!.snapshot(this.runtimeName);
      if (!snapshot.bot) return existingSystemPrompt;
      return `${existingSystemPrompt}\n\nLive Pi Bots state\n${formatStateSnapshot(snapshot)}`;
    }
    return `${existingSystemPrompt}\n\n${renderParentPrompt(roster)}`;
  }

  async execute(
    inputValue: unknown,
    context: RuntimeContext,
    toolCallId: string = randomUUID(),
    signal?: AbortSignal,
  ): Promise<string> {
    const input = parseBotsToolInput(inputValue);
    const cwd = context.cwd ?? process.cwd();
    const roster = await this.ensure(cwd);
    const store = this.store!;
    if (input.action === "list") return formatRoster(roster, this.adapter.availableNames(), this.configError);
    if (input.action === "doctor") return this.doctor(roster, store);
    if (input.action === "run") {
      if (this.childProcess) throw new Error("Bots delegate to peers with Pi's native subagent tool.");
      const task = requireUtf8Text(input.task, "run requires task", 1_048_576);
      const launch = async (activeRoster: BotRoster) => {
        let bot: BotDefinition | undefined;
        const response = await withMaterializedBotRosterLease(activeRoster, () => {
          bot = requireEnabledBot(activeRoster, input.bot);
          return this.adapter.run({
            bot,
            task,
            cwd,
            ownerRunId: context.sessionManager?.getSessionId?.() ?? "pi-bots",
            nodeId: `${toolCallId}:${bot.name}`.slice(0, 256),
            signal: signal ?? context.signal,
          });
        });
        if (bot === undefined) throw new Error("Bot launch did not resolve an enabled bot.");
        return { bot, response };
      };
      let launched;
      try {
        launched = await launch(roster);
      } catch (error) {
        if (!(error instanceof MaterializedBotRosterChangedError)) throw error;
        launched = await launch(await this.reload(cwd));
      }
      const { bot, response } = launched;
      if (response.status !== "completed") {
        throw new Error(`Bot ${bot.name} ended with ${response.status}${response.error ? `: ${response.error}` : "."}`);
      }
      if (!response.result || response.result.kind !== "text") throw new Error(`Bot ${bot.name} returned no text result.`);
      return JSON.stringify({
        bot: bot.name,
        runtimeName: bot.runtimeName,
        status: response.status,
        result: response.result.text,
        model: response.model,
        thinking: response.thinking,
        usage: response.usage,
      }, null, 2);
    }
    if (input.action === "context") {
      if (input.domain && !Object.hasOwn(roster.domainOwners, input.domain)) {
        throw new Error(`Unknown enabled domain: ${input.domain}`);
      }
      const snapshot = await store.snapshot(this.runtimeName, input.domain);
      return formatStateSnapshot(snapshot);
    }
    if (input.action === "record") {
      const runtimeName = requireBotIdentity(this.runtimeName);
      const domain = requireText(input.domain, "record requires domain", 128);
      const kind = requireRecordKind(input.kind);
      const summary = requireText(input.summary, "record requires summary", 8_192);
      const write = (activeRoster: BotRoster, activeStore: BotStateStore) =>
        withMaterializedBotRosterMutation(activeRoster, () => activeStore.recordDomain(runtimeName, {
          domain,
          kind,
          summary,
          evidence: input.evidence,
        }));
      let result;
      try {
        result = await write(roster, store);
      } catch (error) {
        if (!(error instanceof MaterializedBotRosterChangedError)) throw error;
        const activeRoster = await this.reload(cwd);
        result = await write(activeRoster, this.store!);
      }
      return JSON.stringify({ domain, kind, ...result }, null, 2);
    }
    const runtimeName = requireBotIdentity(this.runtimeName);
    const summary = requireText(input.summary, "remember requires summary", 8_192);
    const write = (activeRoster: BotRoster, activeStore: BotStateStore) =>
      withMaterializedBotRosterMutation(
        activeRoster,
        () => activeStore.remember(runtimeName, { summary }),
      );
    let result;
    try {
      result = await write(roster, store);
    } catch (error) {
      if (!(error instanceof MaterializedBotRosterChangedError)) throw error;
      const activeRoster = await this.reload(cwd);
      result = await write(activeRoster, this.store!);
    }
    return JSON.stringify(result, null, 2);
  }

  private async doctor(roster: BotRoster, store: BotStateStore): Promise<string> {
    const enabled = roster.bots.filter((bot) => bot.enabled);
    const available = this.adapter.availableNames();
    const lines = [
      "Pi Bots doctor",
      `Mode: ${this.childProcess ? `bot child (${this.runtimeName ?? "unknown"})` : "parent"}`,
      `Configuration: ${this.configError ? `error: ${this.configError}` : "valid"}`,
      `Sources: ${roster.sources.length > 0 ? roster.sources.join(", ") : "none"}`,
      `Enabled bots: ${enabled.length}`,
      `Native agent files: ${this.childProcess ? "discovered from project mirror" : `${available.length}/${enabled.length} in ${this.materialized?.directory ?? "unavailable"}`}`,
      `Domain owners: ${Object.keys(roster.domainOwners).length}`,
    ];
    try {
      await store.snapshot(this.runtimeName);
      lines.push("State reads: available");
    } catch (error) {
      lines.push(`State error: ${error instanceof Error ? error.message : String(error)}`);
    }
    lines.push("Background lifecycle: native pi-subagents");
    lines.push("Schedules require the native pi-subagents schedule launcher");
    return lines.join("\n");
  }
}

export function installPiBots(hostValue: unknown, options: PiBotsOptions = {}): PiBotsController | undefined {
  const host = requireHost(hostValue);
  if (!host) return undefined;
  const controller = new PiBotsController(host.events, options);
  host.on("session_start", async (_event, context) => {
    try {
      await controller.reload(context.cwd ?? process.cwd());
    } catch (error) {
      context.ui?.notify?.(`Pi Bots failed to load: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  });
  host.on("before_agent_start", async (event, context) => {
    const systemPrompt = typeof event === "object" && event !== null && "systemPrompt" in event && typeof event.systemPrompt === "string"
      ? event.systemPrompt
      : "";
    return { systemPrompt: await controller.prompt(context.cwd ?? process.cwd(), systemPrompt) };
  });
  host.on("session_shutdown", () => controller.dispose());
  host.registerTool({
    name: "bots",
    label: "Pi Bots",
    description: "List domain bots, run one foreground bot, read live team context, or let the current bot record owned state and private memory. Use native subagent for background work, schedules, status, steering, stop, and resume.",
    parameters: BOTS_TOOL_SCHEMA,
    execute: async (toolCallId, params, signal, _onUpdate, context) => textResult(
      await controller.execute(params, context, toolCallId, signal),
    ),
  });
  host.registerCommand("bots", {
    description: "List, run, inspect, reload, and diagnose Pi domain bots.",
    handler: async (args, context) => {
      const result = await executeCommand(controller, args, context);
      context.ui?.notify?.(result, "info");
    },
  });
  return controller;
}

async function executeCommand(controller: PiBotsController, args: string, context: RuntimeContext): Promise<string> {
  const trimmed = args.trim();
  if (!trimmed) return controller.execute({ action: "list" }, context);
  const [action, target, ...rest] = trimmed.split(/\s+/);
  if (action === "list") return controller.execute({ action: "list" }, context);
  if (action === "doctor") return controller.execute({ action: "doctor" }, context);
  if (action === "reload") {
    const roster = await controller.reload(context.cwd ?? process.cwd());
    return `Reloaded ${roster.bots.filter((bot) => bot.enabled).length} enabled bots.`;
  }
  if (action === "run") {
    return controller.execute({ action: "run", bot: target, task: rest.join(" ") }, context);
  }
  if (action === "context") {
    return controller.execute({ action: "context", domain: target }, context);
  }
  throw new Error("Usage: /bots [list|run <bot> <task>|context [domain]|doctor|reload]");
}

function parseBotsToolInput(input: unknown): BotsToolInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("bots input must be an object");
  if (!("action" in input) || typeof input.action !== "string") throw new Error("bots action is required");
  if (!["list", "run", "context", "record", "remember", "doctor"].includes(input.action)) {
    throw new Error(`Unknown bots action: ${input.action}`);
  }
  return input as BotsToolInput;
}

function requireEnabledBot(roster: BotRoster, name: string | undefined): BotDefinition {
  const target = requireText(name, "run requires bot", 128);
  const normalized = target.startsWith("bot.") ? target : normalizeBotName(target);
  const bot = roster.bots.find((candidate) => candidate.enabled && (candidate.name === normalized || candidate.runtimeName === normalized));
  if (!bot) throw new Error(`Unknown enabled bot: ${target}`);
  return bot;
}
function requireUtf8Text(value: string | undefined, message: string, maxBytes: number): string {
  const text = value?.trim();
  if (!text) throw new Error(message);
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error(`${message}; maximum UTF-8 size is ${maxBytes} bytes`);
  }
  return text;
}


function requireText(value: string | undefined, message: string, maxChars: number): string {
  const text = value?.trim();
  if (!text) throw new Error(message);
  if (text.length > maxChars) throw new Error(`${message}; maximum length is ${maxChars} characters`);
  return text;
}

function requireRecordKind(value: DomainRecordKind | undefined): DomainRecordKind {
  if (value === "observation" || value === "inference" || value === "verified") return value;
  throw new Error("record kind must be observation, inference, or verified");
}

function requireBotIdentity(runtimeName: string | undefined): string {
  if (!runtimeName) throw new Error("Only a configured bot child can write bot state.");
  return runtimeName;
}

function requireHost(value: unknown): RuntimeHost | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  if (!("events" in value) || !("on" in value) || !("registerTool" in value) || !("registerCommand" in value)) return undefined;
  if (typeof value.on !== "function" || typeof value.registerTool !== "function" || typeof value.registerCommand !== "function") return undefined;
  const events = value.events;
  if (typeof events !== "object" || events === null || !("on" in events) || !("emit" in events)) return undefined;
  if (typeof events.on !== "function" || typeof events.emit !== "function") return undefined;
  return value as RuntimeHost;
}

function textResult(text: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text }] };
}

const BOTS_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["list", "run", "context", "record", "remember", "doctor"] },
    bot: { type: "string", minLength: 1, maxLength: 128 },
    task: { type: "string", minLength: 1, maxLength: 1_048_576 },
    domain: { type: "string", minLength: 1, maxLength: 128 },
    kind: { type: "string", enum: ["observation", "inference", "verified"] },
    summary: { type: "string", minLength: 1, maxLength: 8_192 },
    evidence: { type: "string", minLength: 1, maxLength: 8_192 },
  },
} as const;
