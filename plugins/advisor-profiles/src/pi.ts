import {
  discoverAdvisorConfigs,
  defaultAgentDir,
  slugifyAdvisorName,
  type AdvisorConfig,
} from "./config.ts";
import {
  parseModelSelector,
  runAdvisorReviews,
  type AdvisorOutcome,
  type ResolvedReviewModel,
  type ReviewModel,
  type TranscriptMessage,
} from "./review.ts";
import { PERSIST_ENTRY_TYPE, SessionState } from "./state.ts";

export type AdvisorProfilesOptions = {
  agentDir?: string;
  maxTranscriptChars?: number;
};

export type AdvisorProfilesController = {
  getState: () => SessionState;
};

type RuntimeHost = {
  on?: (event: string, handler: (event: unknown, ctx: RuntimeContext) => unknown) => void;
  registerCommand?: (name: string, options: RuntimeCommand) => void;
  appendEntry?: (customType: string, data?: unknown) => void;
  sendUserMessage?: (content: string, options?: { deliverAs?: "steer" | "followUp" }) => void;
};

type RuntimeCommand = {
  description?: string;
  handler: (args: string, ctx: RuntimeContext) => unknown;
};

type RuntimeContext = {
  cwd?: string;
  ui?: {
    notify?: (message: string, level?: string) => void;
  };
  modelRegistry?: {
    find?: (provider: string, modelId: string) => unknown;
    hasConfiguredAuth?: (model: unknown) => boolean;
    complete?: (model: unknown, context: unknown, options?: unknown) => Promise<unknown>;
  };
  model?: { provider?: string; id?: string };
  sessionManager?: {
    getEntries?: () => unknown[];
    getBranch?: () => unknown[];
  };
};

function branchTranscript(ctx: RuntimeContext): TranscriptMessage[] {
  try {
    const entries = ctx.sessionManager?.getBranch?.() ?? [];
    const messages: TranscriptMessage[] = [];
    for (const entry of entries) {
      if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
      const message = entry.message;
      messages.push({
        role: typeof message.role === "string" ? message.role : undefined,
        content: message.content,
        toolName: typeof message.toolName === "string" ? message.toolName : undefined,
        isError: typeof message.isError === "boolean" ? message.isError : undefined,
      });
    }
    return messages;
  } catch {
    return [];
  }
}

export function installAdvisorProfiles(
  hostValue: unknown,
  options: AdvisorProfilesOptions = {},
): AdvisorProfilesController | undefined {
  const host = asRuntimeHost(hostValue);
  if (!host?.on) return undefined;
  const runtimeHost: RuntimeHost = host;

  const state = new SessionState();
  const agentDir = options.agentDir ?? defaultAgentDir();
  const maxTranscriptChars = options.maxTranscriptChars;

  try {
    host.on("session_start", (event, ctx) => {
      state.resetForSession();
      restoreFromEntries(ctx);
      void loadConfig(ctx);
    });

    host.on("agent_start", () => {
      if (state.correctionPending) {
        state.skipNextReview = true;
        state.correctionPending = false;
      }
    });

    host.on("agent_settled", async (event, ctx) => {
      if (state.skipNextReview) {
        state.skipNextReview = false;
        return;
      }
      if (state.correctionPending) {
        state.correctionPending = false;
        return;
      }
      if (!state.roster) {
        const loaded = await loadConfig(ctx);
        if (!loaded) return;
      }
      const advisors = state.selectedAdvisors();
      if (advisors.length === 0) return;

      const dedupeBefore = state.dedupe.size;
      let followUpDelivered = false;
      try {
        const result = await runAdvisorReviews({
          advisors,
          sharedInstructions: state.roster?.sharedInstructions,
          transcript: branchTranscript(ctx),
          dedupe: state.dedupe,
          maxTranscriptChars,
          resolveModel: (advisor) => resolveModel(advisor, ctx),
          complete: (model, system, user) => completeReview(model, system, user, ctx),
          record: (advisor, outcome) => {
            state.statuses.set(slugifyAdvisorName(advisor.name), outcome);
          },
        });
        if (result.followUp) {
          const slug = slugifyAdvisorName(result.followUp.advisor.name);
          const delivered = deliverFollowUp(result.followUp.message);
          if (delivered) {
            followUpDelivered = true;
            state.correctionPending = true;
            state.followUpCount++;
          } else {
            state.statuses.set(slug, { kind: "error", message: "follow-up delivery failed" });
          }
        }
      } catch (error) {
        state.reviewError = error instanceof Error ? error.message : String(error);
      } finally {
        if (followUpDelivered || state.dedupe.size !== dedupeBefore) persist();
      }
    });
  } catch {
    return undefined;
  }

  if (host.registerCommand) {
    try {
      host.registerCommand("advisor-profile", {
        description: "Manage advisor profiles: status, list, use <name>|all|off, reload.",
        handler: async (args, ctx) => {
          const [subcommand, ...rest] = args.trim().split(/\s+/);
          if (subcommand === "status" || subcommand === "") return statusCommand(ctx);
          if (subcommand === "list") return listCommand(ctx);
          if (subcommand === "use") return useCommand(rest, ctx);
          if (subcommand === "all") return useCommand(["all"], ctx);
          if (subcommand === "off") return useCommand(["off"], ctx);
          if (subcommand === "reload") return reloadCommand(ctx);
          throw new Error("Usage: /advisor-profile status|list|use <name>|all|off|reload");
        },
      });
    } catch {
    }
  }

  return { getState: () => state };

  function restoreFromEntries(ctx: RuntimeContext): void {
    try {
      const entries = ctx.sessionManager?.getEntries?.() ?? [];
      let latest: unknown = undefined;
      for (const entry of entries) {
        if (!isRecord(entry)) continue;
        if (entry.type !== "custom" || entry.customType !== PERSIST_ENTRY_TYPE) continue;
        latest = entry.data;
      }
      if (latest !== undefined) state.applyPersist(latest);
    } catch {
    }
  }

  async function loadConfig(ctx: RuntimeContext): Promise<boolean> {
    try {
      const cwd = ctx.cwd ?? process.cwd();
      const discovered = await discoverAdvisorConfigs(cwd, agentDir);
      state.roster = discovered;
      state.configError = undefined;
      return true;
    } catch (error) {
      state.configError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async function statusCommand(ctx: RuntimeContext): Promise<void> {
    if (!state.roster) await loadConfig(ctx);
    const lines: string[] = [];
    lines.push(`Advisor profiles: ${state.selectionDescription()}`);
    lines.push(`Reviewer follow-ups sent: ${state.followUpCount}`);
    if (state.configError) lines.push(`Config error: ${state.configError}`);
    if (state.reviewError) lines.push(`Last review error: ${state.reviewError}`);
    if (!state.roster) {
      lines.push("No WATCHDOG.yml config loaded.");
    } else {
      lines.push("Advisors:");
      for (const advisor of state.roster.advisors) {
        lines.push(formatAdvisorLine(advisor));
      }
    }
    lines.push("Host limitation: Pi advisors have no tool loop; advisor `tools` are OMP-only.");
    notify(ctx, lines.join("\n"), "info");
  }

  function formatAdvisorLine(advisor: AdvisorConfig): string {
    const slug = slugifyAdvisorName(advisor.name);
    const flags: string[] = [];
    flags.push(advisor.enabled === false ? "disabled" : "enabled");
    if (state.selection.mode === "all") {
      if (advisor.enabled !== false) flags.push("selected");
    } else if (state.selection.mode === "one" && state.selection.slug === slug) {
      flags.push("selected");
    }
    if (advisor.model) flags.push(`model: ${advisor.model}`);
    if (advisor.tools && advisor.tools.length > 0) flags.push(`tools: ${advisor.tools.join(",")} (unsupported in Pi)`);
    const outcome = state.statuses.get(slug);
    if (outcome) flags.push(`last: ${formatOutcome(outcome)}`);
    return `- ${advisor.name} [${flags.join(", ")}]`;
  }

  async function listCommand(ctx: RuntimeContext): Promise<void> {
    if (!state.roster) await loadConfig(ctx);
    if (!state.roster) {
      notify(ctx, "No WATCHDOG.yml config loaded.", "info");
      return;
    }
    const lines = state.roster.advisors.map((advisor) => {
      const slug = slugifyAdvisorName(advisor.name);
      const markers: string[] = [];
      if (advisor.enabled === false) markers.push("disabled");
      if (state.selection.mode === "all" && advisor.enabled !== false) markers.push("selected");
      if (state.selection.mode === "one" && state.selection.slug === slug) markers.push("selected");
      return markers.length > 0 ? `- ${advisor.name} (${markers.join(", ")})` : `- ${advisor.name}`;
    });
    notify(ctx, `Advisors:\n${lines.join("\n")}`, "info");
  }

  async function useCommand(args: string[], ctx: RuntimeContext): Promise<void> {
    if (args.length !== 1) {
      throw new Error("Usage: /advisor-profile use <name>|all|off");
    }
    const target = args[0].trim();
    if (target === "all") {
      state.selection = { mode: "all" };
      persist();
      notify(ctx, "Advisor profiles: all enabled advisors selected.", "info");
      return;
    }
    if (target === "off") {
      state.selection = { mode: "off" };
      persist();
      notify(ctx, "Advisor profiles: off.", "info");
      return;
    }
    if (!state.roster) await loadConfig(ctx);
    const slug = slugifyAdvisorName(target);
    const known = state.roster?.advisors.some((advisor) => slugifyAdvisorName(advisor.name) === slug);
    if (!known) {
      notify(ctx, `Unknown advisor "${target}". Run /advisor-profile list to see available advisors.`, "error");
      return;
    }
    state.selectSlug(slug);
    persist();
    notify(ctx, `Advisor profile: using "${target}".`, "info");
  }

  async function reloadCommand(ctx: RuntimeContext): Promise<void> {
    const loaded = await loadConfig(ctx);
    if (loaded) {
      const count = state.roster?.advisors.length ?? 0;
      notify(ctx, `Advisor profiles reloaded: ${count} advisor${count === 1 ? "" : "s"} from WATCHDOG.yml.`, "info");
    } else {
      notify(ctx, `Advisor profiles reload failed: ${state.configError ?? "unknown error"}.`, "error");
    }
  }

  function resolveModel(advisor: AdvisorConfig, ctx: RuntimeContext): ResolvedReviewModel {
    const registry = ctx.modelRegistry;
    if (advisor.model) {
      const parsed = parseModelSelector(advisor.model);
      if (!parsed) return { kind: "no_model", reason: `invalid model selector "${advisor.model}"` };
      const model = registry?.find?.(parsed.provider, parsed.id);
      if (!model) return { kind: "no_model", reason: `model "${advisor.model}" not found` };
      if (!registry?.hasConfiguredAuth?.(model)) {
        return { kind: "no_model", reason: `no credentials configured for "${advisor.model}"` };
      }
      return { kind: "ok", model: { provider: parsed.provider, id: parsed.id } };
    }
    const current = ctx.model;
    if (!current?.provider || !current.id) return { kind: "no_model", reason: "no active model" };
    return { kind: "ok", model: { provider: current.provider, id: current.id } };
  }

  async function completeReview(model: ReviewModel, system: string, user: string, ctx: RuntimeContext): Promise<string> {
    const registry = ctx.modelRegistry;
    if (!registry?.complete) throw new Error("model registry has no complete()");
    const found = registry.find?.(model.provider, model.id);
    if (!found) throw new Error(`model ${model.provider}/${model.id} no longer available`);
    const message = await registry.complete(found, {
      systemPrompt: system,
      messages: [{ role: "user", content: user, timestamp: Date.now() }],
    });
    return textOfMessage(message);
  }

  function deliverFollowUp(message: string): boolean {
    try {
      if (!runtimeHost.sendUserMessage) return false;
      runtimeHost.sendUserMessage(message, { deliverAs: "followUp" });
      return true;
    } catch {
      return false;
    }
  }

  function persist(): void {
    try {
      runtimeHost.appendEntry?.(PERSIST_ENTRY_TYPE, state.toPersist());
    } catch {
    }
  }
}

export default function advisorProfilesPiExtension(host: unknown) {
  return installAdvisorProfiles(host);
}

function asRuntimeHost(value: unknown): RuntimeHost | undefined {
  if (!isRecord(value) || typeof value.on !== "function") return undefined;
  return {
    on: value.on.bind(value) as RuntimeHost["on"],
    registerCommand:
      typeof value.registerCommand === "function"
        ? (value.registerCommand.bind(value) as RuntimeHost["registerCommand"])
        : undefined,
    appendEntry:
      typeof value.appendEntry === "function" ? (value.appendEntry.bind(value) as RuntimeHost["appendEntry"]) : undefined,
    sendUserMessage:
      typeof value.sendUserMessage === "function"
        ? (value.sendUserMessage.bind(value) as RuntimeHost["sendUserMessage"])
        : undefined,
  };
}

function notify(ctx: RuntimeContext, message: string, level: string): void {
  try {
    ctx.ui?.notify?.(message, level);
  } catch {
  }
}

function textOfMessage(message: unknown): string {
  if (!isRecord(message)) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  const parts: string[] = [];
  for (const part of message.content) {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("\n");
}

function formatOutcome(outcome: AdvisorOutcome): string {
  if (outcome.kind === "pass") return "pass";
  if (outcome.kind === "no_model") return `no_model (${outcome.reason})`;
  if (outcome.kind === "error") return `error (${outcome.message})`;
  if (outcome.suppressedDuplicate) return `${outcome.severity} (duplicate suppressed)`;
  return outcome.severity;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
