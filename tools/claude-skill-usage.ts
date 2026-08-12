#!/usr/bin/env -S node --experimental-strip-types --disable-warning=ExperimentalWarning

import {
  defaultUsageRoots,
  scanUsage,
  type UsageReport,
} from "./claude-skill-usage-core.ts";

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
  sinceMs?: number;
  untilMs?: number;
  skill?: string;
  json: boolean;
  help: boolean;
};

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = {
    roots: [],
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--root": {
        options.roots.push(requireValue(argv, index, argument));
        index += 1;
        break;
      }
      case "--since": {
        const value = requireValue(argv, index, argument);
        options.sinceMs = parseTimestamp(value, argument);
        index += 1;
        break;
      }
      case "--until": {
        const value = requireValue(argv, index, argument);
        options.untilMs = parseTimestamp(value, argument);
        index += 1;
        break;
      }
      case "--skill": {
        options.skill = requireValue(argv, index, argument);
        index += 1;
        break;
      }
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
  console.log(`Usage: claude-skill-usage [options]

Report reconstructed Claude Code tokens grouped by active skill.

Options:
  --root DIR       Claude projects directory or JSONL file (repeatable)
  --since VALUE    Include events on or after an ISO date or Unix timestamp
  --until VALUE    Include events before an ISO date or Unix timestamp
  --skill NAME     Show only one active skill
  --json           Emit the report as JSON
  -h, --help       Show this help

Defaults:
  CLAUDE_CONFIG_DIR when set, otherwise ~/.claude/projects and
  ~/.config/claude/projects.

Token total = input + cache reads + cache creation + output.
Requests without an active skill are grouped under (none).
`);
}

function renderHuman(report: UsageReport): string {
  const lines = [
    "Claude token usage by skill",
    `Files: ${formatNumber(report.files)}  Requests: ${formatNumber(report.requests)}  Tokens: ${formatNumber(report.tokens.total)}`,
    "",
  ];

  if (report.bySkill.length === 0) {
    lines.push("No matching usage events.");
  } else {
    const skillWidth = Math.max(6, ...report.bySkill.map((summary) => summary.skill.length));
    lines.push(
      [
        "Skill".padEnd(skillWidth),
        "Requests".padStart(10),
        "Total".padStart(15),
        "Input".padStart(13),
        "CacheRead".padStart(13),
        "CacheCreate".padStart(13),
        "Output".padStart(13),
        "Share".padStart(8),
      ].join("  "),
    );
    for (const summary of report.bySkill) {
      lines.push(
        [
          summary.skill.padEnd(skillWidth),
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
  }

  if (report.warnings.length > 0) {
    lines.push("", `Warnings: ${report.warnings.length}`);
    for (const warning of report.warnings.slice(0, 10)) lines.push(`- ${warning}`);
    if (report.warnings.length > 10) {
      lines.push(`- ${report.warnings.length - 10} more warning(s)`);
    }
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const report = await scanUsage({
    roots: options.roots.length > 0 ? options.roots : defaultUsageRoots(),
    sinceMs: options.sinceMs,
    untilMs: options.untilMs,
    skill: options.skill,
  });
  console.log(options.json ? JSON.stringify(report, null, 2) : renderHuman(report));
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`claude-skill-usage: ${message}`);
  process.exitCode = 1;
});
