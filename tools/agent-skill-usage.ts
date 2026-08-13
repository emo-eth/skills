#!/usr/bin/env -S node --experimental-strip-types --disable-warning=ExperimentalWarning

import {
  NO_SKILL,
  SOURCES,
  scanAllSources,
  type SourceSummary,
  type SkillSummary,
  type UsageReport,
  type UsageSource,
} from "./agent-skill-usage-core.ts";

function parseTimestamp(value: string, option: string): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && value.trim() !== "") {
    return numeric < 1_000_000_000_000 ? Math.floor(numeric * 1_000) : Math.floor(numeric);
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new Error(`${option} must be an ISO date, timestamp, or Unix time: ${value}`);
}

type CliOptions = {
  roots: string[];
  sources: UsageSource[];
  sinceMs?: number;
  untilMs?: number;
  skill?: string;
  json: boolean;
  help: boolean;
};

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function sourceValue(value: string): UsageSource {
  if (SOURCES.includes(value as UsageSource)) return value as UsageSource;
  throw new Error(`--source must be one of ${SOURCES.join(", ")}: ${value}`);
}

function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = {
    roots: [],
    sources: [],
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--root":
        options.roots.push(requireValue(argv, index, argument));
        index += 1;
        break;
      case "--source":
        options.sources.push(sourceValue(requireValue(argv, index, argument)));
        index += 1;
        break;
      case "--since":
        options.sinceMs = parseTimestamp(requireValue(argv, index, argument), argument);
        index += 1;
        break;
      case "--until":
        options.untilMs = parseTimestamp(requireValue(argv, index, argument), argument);
        index += 1;
        break;
      case "--skill":
        options.skill = requireValue(argv, index, argument);
        index += 1;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`unknown option: ${argument}`);
    }
  }

  return options;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printHelp(): void {
  console.log(`Usage: agent-skill-usage [options]

Read local token usage grouped by skill and harness.
Supported harnesses: Claude, Codex, Pi, and OMP.
This command reads local JSONL logs directly. It does not use Memex.
Claude uses native attributionSkill. Other harnesses use a skill field or a
skill:// read in the same usage record. Earlier user messages do not label later
usage events. Unlinked usage is grouped under (none).

Options:
  --root DIR       Claude projects directory or JSONL file (repeatable)
  --source NAME    Limit output to claude, codex, pi, or omp (repeatable)
  --since VALUE    Include events on or after an ISO date or Unix timestamp
  --until VALUE    Include events before an ISO date or Unix timestamp
  --skill NAME     Show only one exact skill; use (none) for unknown
  --json           Emit the report as JSON
  -h, --help       Show this help

Defaults:
  ~/.claude/projects or ~/.config/claude/projects
  ~/.codex/sessions
  ~/.pi/agent/sessions
  ~/.omp/agent/sessions

Attribution is exact only when the skill is present on the usage record itself.
Unknown events are grouped under (none).
`);
}

function renderSkillTable(summaries: readonly SkillSummary[]): string[] {
  if (summaries.length === 0) return ["No matching usage events."];
  const skillWidth = Math.max(6, ...summaries.map((summary) => summary.skill.length));
  const lines = [
    [
      "Skill".padEnd(skillWidth),
      "Evidence".padEnd(8),
      "Requests".padStart(10),
      "Total".padStart(15),
      "Input".padStart(13),
      "CacheRead".padStart(13),
      "CacheCreate".padStart(13),
      "Output".padStart(13),
      "Share".padStart(8),
    ].join("  "),
  ];
  for (const summary of summaries) {
    lines.push(
      [
        summary.skill.padEnd(skillWidth),
        summary.attribution.padEnd(8),
        formatNumber(summary.requests).padStart(10),
        formatNumber(summary.total).padStart(15),
        formatNumber(summary.input).padStart(13),
        formatNumber(summary.cacheRead).padStart(13),
        formatNumber(summary.cacheCreation).padStart(13),
        formatNumber(summary.output).padStart(13),
        formatPercent(summary.share).padStart(8),
      ].join("  "),
    );
  }
  return lines;
}

function renderSourceTable(summaries: readonly SourceSummary[]): string[] {
  const sourceWidth = Math.max(6, ...summaries.map((summary) => summary.source.length));
  const lines = [
    [
      "Source".padEnd(sourceWidth),
      "Requests".padStart(10),
      "Exact".padStart(10),
      "Unknown".padStart(10),
      "Total".padStart(15),
      "Share".padStart(8),
    ].join("  "),
  ];
  for (const summary of summaries) {
    lines.push(
      [
        summary.source.padEnd(sourceWidth),
        formatNumber(summary.requests).padStart(10),
        formatNumber(summary.exactRequests).padStart(10),
        formatNumber(summary.unknownRequests).padStart(10),
        formatNumber(summary.total).padStart(15),
        formatPercent(summary.share).padStart(8),
      ].join("  "),
    );
  }
  return lines;
}

function renderHuman(report: UsageReport): string {
  const lines = [
    "Direct local token usage by skill",
    `Files: ${formatNumber(report.files)}  Requests: ${formatNumber(report.requests)}  Tokens: ${formatNumber(report.tokens.total)}`,
    `Exact attribution: ${formatNumber(report.attribution.exactRequests)} request(s) / ${formatNumber(report.attribution.exactTokens)} token(s); unknown ${formatNumber(report.attribution.unknownRequests)} request(s) / ${formatNumber(report.attribution.unknownTokens)} token(s)`,
    "",
    "By skill",
    ...renderSkillTable(report.bySkill),
    "",
    "By source",
    ...renderSourceTable(report.bySource),
  ];

  if (report.warnings.length > 0) {
    lines.push("", `Warnings: ${report.warnings.length}`);
    for (const warning of report.warnings.slice(0, 10)) lines.push(`- ${warning}`);
    if (report.warnings.length > 10) lines.push(`- ${report.warnings.length - 10} more warning(s)`);
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const sources = options.sources.length > 0 ? [...new Set(options.sources)] : undefined;
  const sourceRoots = options.roots.length > 0
    ? { claude: options.roots }
    : undefined;
  const report = await scanAllSources({
    sources,
    sourceRoots,
    sinceMs: options.sinceMs,
    untilMs: options.untilMs,
    skill: options.skill,
  });
  console.log(options.json ? JSON.stringify(report, null, 2) : renderHuman(report));
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`agent-skill-usage: ${message}`);
  process.exitCode = 1;
});
