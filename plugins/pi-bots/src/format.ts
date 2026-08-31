import type { BotRoster, BotStateSnapshot } from "./types.ts";

export function formatRoster(
  roster: BotRoster | undefined,
  availableNames: readonly string[],
  configError?: string,
): string {
  const lines = ["Pi Bots"];
  if (configError) lines.push(`Configuration error: ${configError}`);
  if (!roster) {
    lines.push("No valid roster is loaded.");
    return lines.join("\n");
  }
  const available = new Set(availableNames);
  if (roster.bots.length === 0) lines.push("No bots configured.");
  for (const bot of roster.bots) {
    const state = !bot.enabled ? "disabled" : available.has(bot.runtimeName) ? "available" : "unavailable";
    const domains = bot.domains.length > 0 ? bot.domains.join(", ") : "none";
    const delegates = bot.delegates.length > 0 ? bot.delegates.join(", ") : "none";
    const models = [bot.model, ...bot.fallbackModels].filter((value): value is string => Boolean(value));
    lines.push(`- ${bot.name} — ${bot.title} [${state}]`);
    lines.push(`  runtime: ${bot.runtimeName}`);
    lines.push(`  domains: ${domains}`);
    lines.push(`  delegates: ${delegates}`);
    lines.push(`  models: ${models.length > 0 ? models.join(" → ") : "Pi default"}`);
    lines.push(`  memory: ${bot.memory}`);
  }
  lines.push(`Sources: ${roster.sources.length > 0 ? roster.sources.join(", ") : "none"}`);
  lines.push("Background, schedules, status, steering, stop, resume, and FleetView use the native subagent surface.");
  return lines.join("\n");
}

export function formatStateSnapshot(snapshot: BotStateSnapshot): string {
  const lines: string[] = [];
  if (snapshot.bot) {
    lines.push(`Bot: ${snapshot.bot.name} (${snapshot.bot.runtimeName})`);
    lines.push(`Owned domains: ${snapshot.bot.domains.join(", ") || "none"}`);
  }
  if (snapshot.memory !== undefined) {
    lines.push("Private memory:");
    lines.push(snapshot.memory || "(empty)");
  }
  if (snapshot.domains.length === 0) lines.push("Domain records: none");
  for (const domain of snapshot.domains) {
    lines.push(`Domain: ${domain.domain} (owner: ${domain.owner}, path: ${domain.path}${domain.truncated ? ", truncated" : ""})`);
    lines.push(domain.content || "(empty)");
  }
  return lines.join("\n");
}
