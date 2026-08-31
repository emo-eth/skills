import { createHash, randomUUID } from "node:crypto";
import { lstat, readlink, realpath, rename, rm, symlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildRuntimeAgentDefinition } from "./runtime.ts";
import {
  ensureContainedDirectory,
  replaceContainedFile,
  readContainedFileBounded,
  withContainedFileLock,
} from "./safe-fs.ts";
import type { BotRoster, RuntimeAgentDefinition } from "./types.ts";

export const GENERATED_AGENT_DIRECTORY = "pi-bots.generated";
export const PI_BOTS_HOST_PATH = fileURLToPath(new URL("./host.ts", import.meta.url));

export type MaterializedBotAgents = {
  directory: string;
  files: string[];
  roster: BotRoster;
};

export class MaterializedBotRosterChangedError extends Error {
  constructor() {
    super("pi-bots: generated roster changed before bot launch");
  }
}

export async function materializeBotAgents(
  roster: BotRoster,
  refresh?: () => Promise<BotRoster>,
): Promise<MaterializedBotAgents> {
  const root = roster.agentProjectRoot ?? roster.projectRoot;
  const parent = path.join(root, ".pi", "agents");
  const generations = path.join(root, ".pi", "pi-bots-generations");
  const transactions = path.join(root, ".pi", "pi-bots-transactions");
  const directory = path.join(parent, GENERATED_AGENT_DIRECTORY);
  const extensionPath = path.join(directory, "pi-bots-extension.ts");
  await ensureContainedDirectory(root, parent);
  await ensureContainedDirectory(root, generations);
  await ensureContainedDirectory(root, transactions);
  await replaceContainedFile(root, path.join(generations, ".gitignore"), "*\n");
  await replaceContainedFile(root, path.join(transactions, ".gitignore"), "*\n");
  let publishedRoster = roster;
  await withContainedFileLock(root, rosterRunGuard(directory), () =>
    withContainedFileLock(root, directory, async () => {
    const activeRoster = refresh === undefined ? roster : await refresh();
    if (
      (activeRoster.agentProjectRoot ?? activeRoster.projectRoot) !== root ||
      activeRoster.agentDir !== roster.agentDir
    ) {
      throw new MaterializedBotRosterChangedError();
    }
    publishedRoster = activeRoster;
    const nonce = `${process.pid}.${randomUUID()}`;
    const generation = path.join(generations, nonce);
    const nextLink = path.join(transactions, `${nonce}.link`);
    const legacyBackup = path.join(transactions, `${nonce}.backup`);
    const previous = await inspectGeneratedDestination(root, directory, generations);
    await ensureContainedDirectory(root, generation);
    let committed = false;
    let movedLegacy = false;
    const fingerprint = rosterFingerprint(activeRoster);
    try {
      await replaceContainedFile(root, path.join(generation, ".gitignore"), "*.md\npi-bots-extension.ts\n");
      await replaceContainedFile(
        root,
        path.join(generation, "pi-bots-extension.ts"),
        renderChildExtension(activeRoster.agentDir),
      );
      await replaceContainedFile(root, path.join(generation, ".roster-fingerprint"), `${fingerprint}\n`);
      for (const bot of activeRoster.bots) {
        if (!bot.enabled) continue;
        const definition: RuntimeAgentDefinition = {
          ...buildRuntimeAgentDefinition(bot, activeRoster),
          subagentOnlyExtensions: [extensionPath],
        };
        await replaceContainedFile(
          root,
          path.join(generation, `${bot.runtimeName}.md`),
          renderAgentMarkdown(bot.runtimeName, definition),
        );
      }
      if (refresh !== undefined) {
        const confirmed = await refresh();
        if (rosterFingerprint(confirmed) !== fingerprint) {
          throw new MaterializedBotRosterChangedError();
        }
      }
      await symlink(path.relative(path.dirname(nextLink), generation), nextLink, "dir");
      if (previous.kind === "directory") {
        await rename(directory, legacyBackup);
        movedLegacy = true;
      }
      try {
        await rename(nextLink, directory);
        committed = true;
      } catch (error) {
        if (movedLegacy) await rename(legacyBackup, directory);
        throw error;
      }
    } finally {
      await rm(nextLink, { force: true });
      if (!committed) await rm(generation, { recursive: true, force: true });
    }
    if (movedLegacy) await rm(legacyBackup, { recursive: true, force: true }).catch(() => undefined);
    if (previous.kind === "generation") {
      await rm(previous.path, { recursive: true, force: true }).catch(() => undefined);
    }
    }),
  );
  const files = publishedRoster.bots
    .filter((bot) => bot.enabled)
    .map((bot) => path.join(directory, `${bot.runtimeName}.md`));
  return { directory, files, roster: publishedRoster };
}

export async function isMaterializedBotRosterCurrent(roster: BotRoster): Promise<boolean> {
  const root = roster.agentProjectRoot ?? roster.projectRoot;
  const directory = path.join(root, ".pi", "agents", GENERATED_AGENT_DIRECTORY);
  const generations = path.join(root, ".pi", "pi-bots-generations");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const current = await inspectGeneratedDestination(root, directory, generations);
      if (current.kind !== "generation") return false;
      const fingerprintPath = path.join(current.path, ".roster-fingerprint");
      const fingerprint = await readContainedFileBounded(current.path, fingerprintPath, 256);
      if (fingerprint !== undefined) {
        return fingerprint.content.trim() === rosterFingerprint(roster);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return false;
}

function rosterFingerprint(roster: BotRoster): string {
  return createHash("sha256").update(JSON.stringify({
    version: roster.version,
    bots: roster.bots,
    domainOwners: roster.domainOwners,
    sharedInstructions: roster.sharedInstructions,
    sources: roster.sources,
    projectRoot: roster.projectRoot,
    agentDir: roster.agentDir,
    agentProjectRoot: roster.agentProjectRoot,
  })).digest("hex");
}

export async function withMaterializedBotRosterLease<T>(
  roster: BotRoster,
  run: () => Promise<T>,
): Promise<T> {
  const root = roster.agentProjectRoot ?? roster.projectRoot;
  const directory = path.join(root, ".pi", "agents", GENERATED_AGENT_DIRECTORY);
  return withContainedFileLock(root, rosterRunGuard(directory), async () => {
    if (!await isMaterializedBotRosterCurrent(roster)) {
      throw new MaterializedBotRosterChangedError();
    }
    return run();
  });
}

export async function withMaterializedBotRosterMutation<T>(
  roster: BotRoster,
  run: () => Promise<T>,
): Promise<T> {
  const root = roster.agentProjectRoot ?? roster.projectRoot;
  const directory = path.join(root, ".pi", "agents", GENERATED_AGENT_DIRECTORY);
  return withContainedFileLock(root, directory, async () => {
    if (!await isMaterializedBotRosterCurrent(roster)) {
      throw new MaterializedBotRosterChangedError();
    }
    return run();
  });
}

function rosterRunGuard(directory: string): string {
  return `${directory}.run-guard`;
}

type GeneratedDestination =
  | { kind: "absent" }
  | { kind: "directory" }
  | { kind: "generation"; path: string };

async function inspectGeneratedDestination(
  root: string,
  directory: string,
  generations: string,
): Promise<GeneratedDestination> {
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    throw error;
  }
  if (info.isDirectory()) {
    await ensureContainedDirectory(root, directory);
    return { kind: "directory" };
  }
  if (!info.isSymbolicLink()) {
    throw new Error(`pi-bots: unsafe generated agent destination ${directory}`);
  }
  const target = path.resolve(path.dirname(directory), await readlink(directory));
  if (path.dirname(target) !== path.resolve(generations)) {
    throw new Error(`pi-bots: unsafe generated agent symlink ${directory}`);
  }
  const targetInfo = await lstat(target);
  if (!targetInfo.isDirectory()) {
    throw new Error(`pi-bots: unsafe generated agent symlink ${directory}`);
  }
  const resolvedGenerations = await ensureContainedDirectory(root, generations);
  const resolvedTarget = await realpath(target);
  if (path.dirname(resolvedTarget) !== resolvedGenerations) {
    throw new Error(`pi-bots: unsafe generated agent symlink ${directory}`);
  }
  return { kind: "generation", path: resolvedTarget };
}

export function renderChildExtension(agentDir: string): string {
  return [
    `import { installPiBots } from ${JSON.stringify(PI_BOTS_HOST_PATH)};`,
    `export default function register(pi: unknown): void {`,
    `  installPiBots(pi, { agentDir: ${JSON.stringify(agentDir)} });`,
    `}`,
    "",
  ].join("\n");
}

export function renderAgentMarkdown(name: string, definition: RuntimeAgentDefinition): string {
  const lines = [
    "---",
    scalar("name", name),
    scalar("description", definition.description),
  ];
  appendList(lines, "tools", definition.tools);
  appendBoolean(lines, "allowNestedSubagents", definition.allowNestedSubagents);
  appendList(lines, "subagentOnlyExtensions", definition.subagentOnlyExtensions);
  appendList(lines, "mutationTools", definition.mutationTools);
  appendScalar(lines, "model", definition.model);
  appendList(lines, "fallbackModels", definition.fallbackModels);
  if (definition.thinking !== undefined) lines.push(scalar("thinking", String(definition.thinking)));
  appendScalar(lines, "systemPromptMode", definition.systemPromptMode);
  appendBoolean(lines, "inheritProjectContext", definition.inheritProjectContext);
  appendBoolean(lines, "inheritGlobalContext", definition.inheritGlobalContext);
  appendScalar(lines, "defaultContext", definition.defaultContext);
  appendBoolean(lines, "async", definition.defaultAsync);
  appendNumber(lines, "timeoutMs", definition.defaultTimeoutMs);
  appendScalar(lines, "acceptanceRole", definition.acceptanceRole);
  appendList(lines, "skills", definition.skills);
  appendNumber(lines, "maxSubagentDepth", definition.maxSubagentDepth);
  appendBoolean(lines, "completionGuard", definition.completionGuard);
  lines.push("---", "", definition.systemPrompt.trim(), "");
  return lines.join("\n");
}

function scalar(key: string, value: string): string {
  return `${key}: ${JSON.stringify(value)}`;
}

function appendScalar(lines: string[], key: string, value: string | undefined): void {
  if (value !== undefined) lines.push(scalar(key, value));
}

function appendList(lines: string[], key: string, values: readonly string[] | undefined): void {
  if (values !== undefined && values.length > 0) lines.push(scalar(key, values.join(", ")));
}

function appendBoolean(lines: string[], key: string, value: boolean | undefined): void {
  if (value !== undefined) lines.push(`${key}: ${value ? "true" : "false"}`);
}

function appendNumber(lines: string[], key: string, value: number | undefined): void {
  if (value !== undefined) lines.push(`${key}: ${value}`);
}
