import { fileURLToPath } from "node:url";
import type { BotDefinition, BotRoster, RuntimeAgentDefinition } from "./types.ts";

export const BOT_TOOL_NAME = "bots";
export const SUBAGENT_TOOL_NAME = "subagent";
export const MANDATORY_BOT_TOOLS: readonly string[] = [BOT_TOOL_NAME, SUBAGENT_TOOL_NAME];
export const PI_BOTS_EXTENSION_PATH = fileURLToPath(new URL("./pi.ts", import.meta.url));

export interface PromptBounds {
  descriptionChars: number;
  charterChars: number;
  sharedInstructionsChars: number;
  domainsPerBot: number;
  domainChars: number;
  peersListed: number;
  parentBotsListed: number;
  blurbChars: number;
  botPromptChars: number;
  parentPromptChars: number;
}

export const PROMPT_BOUNDS: PromptBounds = {
  descriptionChars: 400,
  charterChars: 6_000,
  sharedInstructionsChars: 2_000,
  domainsPerBot: 12,
  domainChars: 80,
  peersListed: 24,
  parentBotsListed: 48,
  blurbChars: 300,
  botPromptChars: 24_000,
  parentPromptChars: 12_000,
};

export function boundText(text: string, maxChars: number): string {
  const limit = Math.max(1, Math.floor(maxChars));
  if (text.length <= limit) return text;
  const suffix = ` …[+${text.length - limit} chars]`;
  const usable = Math.max(0, limit - suffix.length);
  return `${text.slice(0, usable).trimEnd()}${suffix}`;
}

export function boundItems(items: readonly string[], maxItems: number): string[] {
  const limit = Math.max(1, Math.floor(maxItems));
  if (items.length <= limit) return [...items];
  return [...items.slice(0, limit), `… (+${items.length - limit} more)`];
}

export function buildRuntimeAgentDefinition(bot: BotDefinition, roster: BotRoster): RuntimeAgentDefinition {
  const tools = bot.tools === undefined ? undefined : withMandatoryTools(bot.tools);
  const fallbackModels = toolNames(bot.fallbackModels);
  const skills = bot.skills === undefined ? [] : toolNames(bot.skills);
  const model = bot.model === undefined ? undefined : bot.model.trim();
  const timeoutMs = Number.isInteger(bot.timeoutMs) && bot.timeoutMs > 0 ? bot.timeoutMs : undefined;
  const maxSubagentDepth = Number.isInteger(bot.maxSubagentDepth) && bot.maxSubagentDepth >= 0 ? bot.maxSubagentDepth : undefined;
  return {
    description: nonEmpty(
      boundText(`${bot.title}: ${bot.description}`.trim(), PROMPT_BOUNDS.descriptionChars).trim(),
      bot.runtimeName,
    ),
    systemPrompt: renderBotSystemPrompt(bot, roster),
    ...(tools === undefined ? {} : { tools }),
    allowNestedSubagents: true,
    mutationTools: [BOT_TOOL_NAME],
    subagentOnlyExtensions: [PI_BOTS_EXTENSION_PATH],
    ...(model === undefined || model.length === 0 ? {} : { model }),
    ...(fallbackModels.length === 0 ? {} : { fallbackModels }),
    ...(bot.thinking === undefined ? {} : { thinking: bot.thinking }),
    systemPromptMode: "replace",
    inheritProjectContext: true,
    inheritGlobalContext: false,
    defaultContext: bot.context,
    defaultAsync: false,
    ...(timeoutMs === undefined ? {} : { defaultTimeoutMs: timeoutMs }),
    acceptanceRole: "writer",
    ...(skills.length === 0 ? {} : { skills }),
    ...(maxSubagentDepth === undefined ? {} : { maxSubagentDepth }),
    completionGuard: true,
  };
}

export function renderBotSystemPrompt(bot: BotDefinition, roster: BotRoster): string {
  const peers = enabledPeers(roster, bot);
  const delegates = allowedDelegates(bot, roster);
  const delegateNames = delegates.map((peer) => `\`${peer.runtimeName}\``);
  const sections: string[] = [];

  sections.push(`You are ${bot.name} (\`${bot.runtimeName}\`), the ${bot.title}.`);
  sections.push(`Domains you own: ${joinBounded(bot.domains, PROMPT_BOUNDS.domainsPerBot, PROMPT_BOUNDS.domainChars)}.`);

  const charter = boundText(
    [nonEmpty(bot.description.trim(), bot.title), bot.instructions ?? ""]
      .filter((part) => part.length > 0)
      .join("\n\n"),
    PROMPT_BOUNDS.charterChars,
  ).trim();
  sections.push(`Charter:\n${nonEmpty(charter, bot.runtimeName)}`);

  if (peers.length > 0) {
    sections.push(peerSection(peers));
  }

  sections.push(
    `Allowed delegates: ${nonEmpty(joinBounded(delegateNames, PROMPT_BOUNDS.peersListed, 160), "(none)")} via the \`${SUBAGENT_TOOL_NAME}\` tool. Do not call any runtime name outside this list.`,
  );

  sections.push(liveStateSection(bot));
  sections.push(peerCollaborationSection(bot, delegates));

  const shared = (roster.sharedInstructions ?? "").trim();
  if (shared.length > 0) {
    sections.push(`Shared instructions:\n${boundText(shared, PROMPT_BOUNDS.sharedInstructionsChars).trim()}`);
  }

  return nonEmpty(boundText(sections.join("\n\n"), PROMPT_BOUNDS.botPromptChars).trim(), `You are \`${bot.runtimeName}\`.`);
}

export function renderParentPrompt(roster: BotRoster): string {
  const enabled = roster.bots.filter((bot) => bot.enabled);
  const visible = enabled.slice(0, PROMPT_BOUNDS.parentBotsListed);
  const lines = visible.map((bot) => {
    const blurb = boundText(`${bot.title} — ${bot.description}`.trim(), PROMPT_BOUNDS.blurbChars).trim();
    return boundText([
      `- \`${bot.runtimeName}\` (${bot.scope}) — ${nonEmpty(blurb, bot.runtimeName)}`,
      `domains: ${joinBounded(bot.domains, PROMPT_BOUNDS.domainsPerBot, PROMPT_BOUNDS.domainChars)}`,
    ].join("; "), PROMPT_BOUNDS.blurbChars);
  });
  if (enabled.length > visible.length) {
    lines.push(`… (+${enabled.length - visible.length} more bots)`);
  }

  const sections: string[] = [
    `Domain bots (call with the native \`${SUBAGENT_TOOL_NAME}\` tool, exact runtime name, synchronous in the foreground):\n${nonEmpty(lines.join("\n"), "(none)")}`,
    [
      `${BOT_TOOL_NAME} tool routines:`,
      `- \`${BOT_TOOL_NAME} context\` — read-only view of shared team context (domain records). Use it for routing decisions; never write domain state yourself.`,
      `- \`${BOT_TOOL_NAME} record\` — owning bots write domain records ({domain, kind, summary, evidence?}); kind is observation | inference | verified; \`verified\` requires evidence.`,
      `- \`${BOT_TOOL_NAME} remember\` — a bot's private memory notes, separate from shared team context.`,
    ].join("\n"),
    "Use native subagent workflows for background or parallel work and `schedule.create` for routines. Status, steering, stop, resume, missions, and FleetView stay on the native subagent surface.",
    "Route each domain task to its owning bot. Live domain contents are never embedded in this prompt; the owning bots and the bots tool are the source of truth.",
  ];

  return nonEmpty(boundText(sections.join("\n\n"), PROMPT_BOUNDS.parentPromptChars).trim(), "Domain bots: (none).");
}

function withMandatoryTools(tools: readonly string[]): string[] {
  return toolNames([...tools, ...MANDATORY_BOT_TOOLS]);
}

function toolNames(tools: readonly string[]): string[] {
  const names: string[] = [];
  for (const tool of tools) {
    const name = tool.trim();
    if (name.length > 0 && !names.includes(name)) names.push(name);
  }
  return names;
}


function nonEmpty(text: string, fallback: string): string {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function joinBounded(items: readonly string[], maxItems: number, itemChars: number): string {
  const bounded = boundItems(
    items.map((item) => boundText(item, itemChars).trim()).filter((item) => item.length > 0),
    maxItems,
  );
  return bounded.join(", ");
}

function enabledPeers(roster: BotRoster, bot: BotDefinition): BotDefinition[] {
  return roster.bots.filter((candidate) => candidate.enabled && candidate.runtimeName !== bot.runtimeName);
}

function allowedDelegates(bot: BotDefinition, roster: BotRoster): BotDefinition[] {
  const delegates = new Set(bot.delegates);
  return enabledPeers(roster, bot).filter((peer) => delegates.has(peer.name) || delegates.has(peer.runtimeName));
}

function peerSection(peers: readonly BotDefinition[]): string {
  const visible = peers.slice(0, PROMPT_BOUNDS.peersListed);
  const lines = visible.map((peer) => {
    const domains = joinBounded(peer.domains, PROMPT_BOUNDS.domainsPerBot, PROMPT_BOUNDS.domainChars);
    return boundText(
      `- \`${peer.runtimeName}\` — ${peer.title}; domains: ${nonEmpty(domains, "(none)")}`,
      PROMPT_BOUNDS.blurbChars,
    );
  });
  if (peers.length > visible.length) {
    lines.push(`… (+${peers.length - visible.length} more peers)`);
  }
  return `Peer bots:\n${lines.join("\n")}`;
}

function liveStateSection(bot: BotDefinition): string {
  const lines = [
    "Shared domain state (live):",
    `- \`${BOT_TOOL_NAME} context\` — read current team context for your domains before acting on stale knowledge.`,
    `- \`${BOT_TOOL_NAME} record\` — write a domain record {domain, kind, summary, evidence?}; kind is observation | inference | verified; \`verified\` requires evidence.`,
  ];
  if (bot.memory === "off") {
    lines.push("- Private memory is disabled for this bot; do not attempt to remember.");
  } else {
    lines.push(`- \`${BOT_TOOL_NAME} remember\` — append a private memory note for your next runs.`);
  }
  lines.push("Keep shared domain knowledge in team-context records, not in private notes.");
  return lines.join("\n");
}

function peerCollaborationSection(bot: BotDefinition, delegates: readonly BotDefinition[]): string {
  const example = delegates[0]?.runtimeName ?? "bot.<peer>";
  return [
    "Peer collaboration:",
    `- Call peers synchronously in the foreground with the native \`${SUBAGENT_TOOL_NAME}\` tool using the exact runtime name, e.g. agent: "${example}". Wait for the inline result before continuing.`,
    "- Owner handoff: when work belongs to a domain you do not own, delegate to the owning bot instead of doing it yourself.",
    `- No recursion: never invoke your own runtime name (\`${bot.runtimeName}\`), never re-delegate a task you were handed, and stay within your subagent depth.`,
    "- Verification: report observations as observation, reasoning as inference, and mark verified only with evidence; verify before reporting completion.",
  ].join("\n");
}
