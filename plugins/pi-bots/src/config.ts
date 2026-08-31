import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { BOTS_CONFIG_VERSION } from "./types.ts";
import type {
  BotContextMode,
  BotDefinition,
  BotMemoryScope,
  BotRoster,
  BotScope,
  BotThinking,
  ConfigCandidate,
} from "./types.ts";

const CONFIG_FILENAMES = ["BOTS.yml", "BOTS.yaml"];

const TOP_LEVEL_FIELDS: Record<string, true> = {
  version: true,
  instructions: true,
  defaults: true,
  bots: true,
};
const BOT_FIELDS: Record<string, true> = {
  name: true,
  title: true,
  description: true,
  domains: true,
  instructions: true,
  model: true,
  fallbackModels: true,
  thinking: true,
  tools: true,
  skills: true,
  delegates: true,
  memory: true,
  context: true,
  timeoutMs: true,
  maxSubagentDepth: true,
  enabled: true,
};
const DEFAULT_FIELDS: Record<string, true> = {
  title: true,
  description: true,
  instructions: true,
  model: true,
  fallbackModels: true,
  thinking: true,
  tools: true,
  skills: true,
  delegates: true,
  memory: true,
  context: true,
  timeoutMs: true,
  maxSubagentDepth: true,
  enabled: true,
};

const MEMORY_SCOPES: readonly BotMemoryScope[] = ["user", "project", "off"];
const CONTEXT_MODES: readonly BotContextMode[] = ["fresh", "fork"];
const THINKING_LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const DOMAIN_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_NAME_LENGTH = 64;
const MAX_DOMAIN_LENGTH = 128;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 3_600_000;
const MAX_SUBAGENT_DEPTH = 8;

export interface RawBotDefinition {
  name: string;
  title?: string;
  description?: string;
  domains: string[];
  instructions?: string;
  model?: string;
  fallbackModels?: string[];
  thinking?: BotThinking;
  tools?: string[];
  skills?: string[];
  delegates?: string[];
  memory?: BotMemoryScope;
  context?: BotContextMode;
  timeoutMs?: number;
  maxSubagentDepth?: number;
  enabled?: boolean;
}

export type BotDefaults = Omit<RawBotDefinition, "name" | "domains">;

export interface ParsedBotsConfig {
  version: 1;
  sharedInstructions?: string;
  defaults?: BotDefaults;
  bots: RawBotDefinition[];
}

export interface DiscoverOptions {
  agentDir?: string;
  projectRoot?: string;
}

interface ResolvedDefaults extends BotDefaults {
  fallbackModels: string[];
  delegates: string[];
  memory: BotMemoryScope;
  context: BotContextMode;
  timeoutMs: number;
  maxSubagentDepth: number;
  enabled: boolean;
}

interface BotSource {
  raw: RawBotDefinition;
  scope: BotScope;
  configPath: string;
}

const BUILTIN_DEFAULTS: ResolvedDefaults = {
  fallbackModels: [],
  delegates: [],
  memory: "project",
  context: "fresh",
  timeoutMs: 900_000,
  maxSubagentDepth: 3,
  enabled: true,
};

export class BotConfigError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${path}: ${message}`);
    this.name = "BotConfigError";
    this.path = path;
  }
}

export function normalizeBotName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function runtimeBotName(name: string): string {
  return `bot.${normalizeBotName(name)}`;
}

export function defaultAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return path.join(homedir(), ".pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/")) return path.join(homedir(), configured.slice(2));
  return path.resolve(configured);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireMapping(value: unknown, source: string, where: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new BotConfigError(`"${where}" must be a mapping`, source);
  }
  return value;
}

function rejectUnknownFields(
  record: Record<string, unknown>,
  allowed: Record<string, true>,
  source: string,
  where: string,
): void {
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(allowed, key)) {
      throw new BotConfigError(`"${where}" has unknown field "${key}"`, source);
    }
  }
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  source: string,
  where: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new BotConfigError(`"${where}.${key}" must be a non-empty string`, source);
  }
  return value.trim();
}

function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  source: string,
  where: string,
): string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new BotConfigError(`"${where}.${key}" must be an array of strings`, source);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new BotConfigError(`"${where}.${key}[${index}]" must be a non-empty string`, source);
    }
    return entry.trim();
  });
}

function optionalEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  source: string,
  where: string,
): T | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new BotConfigError(
      `"${where}.${key}" must be one of ${allowed.join(", ")}`,
      source,
    );
  }
  return value as T;
}

function optionalThinking(
  record: Record<string, unknown>,
  source: string,
  where: string,
): BotThinking | undefined {
  const value = record.thinking;
  if (value === undefined) return undefined;
  if (value === false) return false;
  if (typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value)) {
    return value as BotThinking;
  }
  throw new BotConfigError(
    `"${where}.thinking" must be false or one of ${THINKING_LEVELS.join(", ")}`,
    source,
  );
}

function optionalInteger(
  record: Record<string, unknown>,
  key: string,
  source: string,
  where: string,
  min: number,
  max: number,
): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BotConfigError(`"${where}.${key}" must be an integer`, source);
  }
  if (value < min || value > max) {
    throw new BotConfigError(`"${where}.${key}" must be between ${min} and ${max}`, source);
  }
  return value;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  source: string,
  where: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new BotConfigError(`"${where}.${key}" must be a boolean`, source);
  }
  return value;
}

function optionalDelegates(
  record: Record<string, unknown>,
  source: string,
  where: string,
): string[] | undefined {
  const value = optionalStringArray(record, "delegates", source, where);
  if (value === undefined) return undefined;
  const seen = new Set<string>();
  for (const delegate of value) {
    const normalized = normalizeBotName(delegate);
    if (!normalized) {
      throw new BotConfigError(
        `"${where}.delegates" entry "${delegate}" is not a valid bot name`,
        source,
      );
    }
    if (seen.has(normalized)) {
      throw new BotConfigError(`"${where}.delegates" repeats bot "${normalized}"`, source);
    }
    seen.add(normalized);
  }
  return value;
}

function parseOptionalFields(
  record: Record<string, unknown>,
  source: string,
  where: string,
): BotDefaults {
  const fields: BotDefaults = {};
  const title = optionalString(record, "title", source, where);
  if (title !== undefined) fields.title = title;
  const description = optionalString(record, "description", source, where);
  if (description !== undefined) fields.description = description;
  const instructions = optionalString(record, "instructions", source, where);
  if (instructions !== undefined) fields.instructions = instructions;
  const model = optionalString(record, "model", source, where);
  if (model !== undefined) fields.model = model;
  const fallbackModels = optionalStringArray(record, "fallbackModels", source, where);
  if (fallbackModels !== undefined) fields.fallbackModels = fallbackModels;
  const thinking = optionalThinking(record, source, where);
  if (thinking !== undefined) fields.thinking = thinking;
  const tools = optionalStringArray(record, "tools", source, where);
  if (tools !== undefined) fields.tools = tools;
  const skills = optionalStringArray(record, "skills", source, where);
  if (skills !== undefined) fields.skills = skills;
  const delegates = optionalDelegates(record, source, where);
  if (delegates !== undefined) fields.delegates = delegates;
  const memory = optionalEnum(record, "memory", MEMORY_SCOPES, source, where);
  if (memory !== undefined) fields.memory = memory;
  const context = optionalEnum(record, "context", CONTEXT_MODES, source, where);
  if (context !== undefined) fields.context = context;
  const timeoutMs = optionalInteger(
    record,
    "timeoutMs",
    source,
    where,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  if (timeoutMs !== undefined) fields.timeoutMs = timeoutMs;
  const maxSubagentDepth = optionalInteger(
    record,
    "maxSubagentDepth",
    source,
    where,
    0,
    MAX_SUBAGENT_DEPTH,
  );
  if (maxSubagentDepth !== undefined) fields.maxSubagentDepth = maxSubagentDepth;
  const enabled = optionalBoolean(record, "enabled", source, where);
  if (enabled !== undefined) fields.enabled = enabled;
  return fields;
}

function requireBotName(
  record: Record<string, unknown>,
  source: string,
  where: string,
): string {
  const value = record.name;
  if (typeof value !== "string" || !value.trim()) {
    throw new BotConfigError(`"${where}" requires a non-empty string "name"`, source);
  }
  const trimmed = value.trim();
  const normalized = normalizeBotName(trimmed);
  if (!normalized) {
    throw new BotConfigError(`"${where}" name "${trimmed}" normalizes to an empty slug`, source);
  }
  if (normalized.length > MAX_NAME_LENGTH) {
    throw new BotConfigError(
      `"${where}" name "${trimmed}" exceeds ${MAX_NAME_LENGTH} characters`,
      source,
    );
  }
  return trimmed;
}

function requireDomains(
  record: Record<string, unknown>,
  source: string,
  where: string,
): string[] {
  const value = record.domains;
  if (!Array.isArray(value) || value.length === 0) {
    throw new BotConfigError(`"${where}" requires a non-empty "domains" array`, source);
  }
  const domains: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new BotConfigError(`"${where}.domains" entries must be non-empty strings`, source);
    }
    const domain = entry.trim().toLowerCase();
    if (domain.length > MAX_DOMAIN_LENGTH || !DOMAIN_PATTERN.test(domain)) {
      throw new BotConfigError(
        `"${where}.domains" entry "${entry}" must match ${DOMAIN_PATTERN}`,
        source,
      );
    }
    if (domains.includes(domain)) {
      throw new BotConfigError(`"${where}.domains" repeats domain "${domain}"`, source);
    }
    domains.push(domain);
  }
  return domains;
}

function parseBots(value: unknown, source: string): RawBotDefinition[] {
  if (!Array.isArray(value)) {
    throw new BotConfigError(`"bots" must be an array`, source);
  }
  const bots: RawBotDefinition[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const where = `bots[${index}]`;
    const record = requireMapping(entry, source, where);
    rejectUnknownFields(record, BOT_FIELDS, source, where);
    const name = requireBotName(record, source, where);
    const normalized = normalizeBotName(name);
    if (seen.has(normalized)) {
      throw new BotConfigError(`"${where}" duplicates bot name "${normalized}"`, source);
    }
    seen.add(normalized);
    bots.push({
      name,
      domains: requireDomains(record, source, where),
      ...parseOptionalFields(record, source, where),
    });
  });
  return bots;
}

function parseDefaults(value: unknown, source: string): BotDefaults {
  const record = requireMapping(value, source, "defaults");
  rejectUnknownFields(record, DEFAULT_FIELDS, source, "defaults");
  return parseOptionalFields(record, source, "defaults");
}

export function parseBotsConfig(content: string, source: string): ParsedBotsConfig {
  let document: unknown;
  try {
    document = parseYaml(content);
  } catch (error) {
    throw new BotConfigError(
      `invalid YAML (${error instanceof Error ? error.message : String(error)})`,
      source,
    );
  }
  const root = requireMapping(document, source, "config");
  rejectUnknownFields(root, TOP_LEVEL_FIELDS, source, "config");
  if (root.version !== BOTS_CONFIG_VERSION) {
    throw new BotConfigError(`"version" must be ${BOTS_CONFIG_VERSION}`, source);
  }
  const sharedInstructions = optionalString(root, "instructions", source, "config");
  const defaults = root.defaults === undefined ? undefined : parseDefaults(root.defaults, source);
  const bots = root.bots === undefined ? [] : parseBots(root.bots, source);
  const parsed: ParsedBotsConfig = { version: 1, bots };
  if (sharedInstructions !== undefined) parsed.sharedInstructions = sharedInstructions;
  if (defaults !== undefined) parsed.defaults = defaults;
  return parsed;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function findProjectRoot(cwd: string): Promise<string> {
  const start = path.resolve(cwd);
  let dir = start;
  const fsRoot = path.parse(dir).root;
  for (;;) {
    if (await pathExists(path.join(dir, ".git"))) return dir;
    if (dir === fsRoot) return start;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}
async function directoryExists(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function findNearestGitRoot(cwd: string): Promise<string | undefined> {
  let dir = path.resolve(cwd);
  const fsRoot = path.parse(dir).root;
  for (;;) {
    if (await pathExists(path.join(dir, ".git"))) return dir;
    if (dir === fsRoot) return undefined;
    dir = path.dirname(dir);
  }
}

async function readAgentProjectRootResolution(
  projectRoot: string,
): Promise<"nearest" | "git-root" | undefined> {
  const settingsPath = path.join(projectRoot, ".pi", "settings.json");
  let content: string;
  try {
    content = await readFile(settingsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let settings: unknown;
  try {
    settings = JSON.parse(content);
  } catch (error) {
    throw new BotConfigError(
      `invalid JSON (${error instanceof Error ? error.message : String(error)})`,
      settingsPath,
    );
  }
  if (!isPlainObject(settings) || !isPlainObject(settings.subagents)) return undefined;
  const value = settings.subagents.projectRootResolution;
  if (value === undefined || value === "nearest" || value === "git-root") return value;
  throw new BotConfigError(
    `"subagents.projectRootResolution" must be nearest or git-root`,
    settingsPath,
  );
}

async function findAgentProjectRoot(cwd: string, fallback: string): Promise<string> {
  const candidates: string[] = [];
  let dir = path.resolve(cwd);
  const fsRoot = path.parse(dir).root;
  for (;;) {
    if (await directoryExists(path.join(dir, ".pi")) || await directoryExists(path.join(dir, ".agents"))) {
      candidates.push(dir);
    }
    if (dir === fsRoot) break;
    dir = path.dirname(dir);
  }
  const nearest = candidates[0];
  if (nearest === undefined) return fallback;
  let policyRoot: string | undefined;
  let policyIndex = -1;
  for (const [index, candidate] of candidates.entries()) {
    const mode = await readAgentProjectRootResolution(candidate);
    if (mode === "nearest") return nearest;
    if (mode === "git-root") {
      policyRoot = candidate;
      policyIndex = index;
      break;
    }
  }
  if (policyRoot === undefined) return nearest;
  const gitRoot = await findNearestGitRoot(cwd);
  const gitCandidate = gitRoot === undefined
    ? undefined
    : candidates.slice(policyIndex).find((candidate) => path.resolve(candidate) === path.resolve(gitRoot));
  if (gitCandidate !== undefined) return gitCandidate;
  return await pathExists(path.join(policyRoot, ".git")) ? policyRoot : nearest;
}


async function firstConfigFile(directory: string): Promise<string | undefined> {
  for (const filename of CONFIG_FILENAMES) {
    const candidate = path.join(directory, filename);
    if (await pathExists(candidate)) return candidate;
  }
  return undefined;
}

async function readCandidate(
  configPath: string,
  scope: BotScope,
  precedence: number,
): Promise<ConfigCandidate | undefined> {
  let content: string;
  try {
    content = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new BotConfigError(
      `unreadable (${error instanceof Error ? error.message : String(error)})`,
      configPath,
    );
  }
  return { path: configPath, content, scope, precedence };
}

export async function collectBotConfigCandidates(
  cwd: string,
  options: DiscoverOptions = {},
): Promise<ConfigCandidate[]> {
  const agentDir = path.resolve(options.agentDir ?? defaultAgentDir());
  const projectRoot = path.resolve(options.projectRoot ?? (await findProjectRoot(cwd)));
  const candidates: ConfigCandidate[] = [];

  const userPath = await firstConfigFile(agentDir);
  if (userPath) {
    const candidate = await readCandidate(userPath, "user", 0);
    if (candidate) candidates.push(candidate);
  }

  const start = path.resolve(cwd);
  const fsRoot = path.parse(start).root;
  const projectDirs: string[] = [];
  let dir = start;
  for (;;) {
    projectDirs.unshift(dir);
    if (dir === projectRoot || dir === fsRoot) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const [index, projectDir] of projectDirs.entries()) {
    const configPath = await firstConfigFile(path.join(projectDir, ".pi"));
    if (!configPath) continue;
    const candidate = await readCandidate(configPath, "project", index + 1);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function resolveDefaults(documents: ParsedBotsConfig[]): ResolvedDefaults {
  const defaults: ResolvedDefaults = { ...BUILTIN_DEFAULTS };
  for (const document of documents) {
    if (document.defaults) Object.assign(defaults, document.defaults);
  }
  return defaults;
}

function buildBotDefinition(source: BotSource, defaults: ResolvedDefaults): BotDefinition {
  const raw = source.raw;
  const name = normalizeBotName(raw.name);
  const delegates: string[] = [];
  for (const delegate of raw.delegates ?? defaults.delegates) {
    const normalized = normalizeBotName(delegate);
    if (normalized && !delegates.includes(normalized)) delegates.push(normalized);
  }
  const definition: BotDefinition = {
    name,
    runtimeName: `bot.${name}`,
    title: raw.title ?? defaults.title ?? raw.name,
    description: raw.description ?? defaults.description ?? "",
    domains: raw.domains,
    instructions: raw.instructions ?? defaults.instructions,
    model: raw.model ?? defaults.model,
    fallbackModels: raw.fallbackModels ?? defaults.fallbackModels,
    thinking: raw.thinking ?? defaults.thinking,
    tools: raw.tools ?? defaults.tools,
    skills: raw.skills ?? defaults.skills,
    delegates,
    memory: raw.memory ?? defaults.memory,
    context: raw.context ?? defaults.context,
    timeoutMs: raw.timeoutMs ?? defaults.timeoutMs,
    maxSubagentDepth: raw.maxSubagentDepth ?? defaults.maxSubagentDepth,
    enabled: raw.enabled ?? defaults.enabled,
    scope: source.scope,
    configPath: source.configPath,
  };
  return definition;
}

function collectDomainOwners(bots: BotDefinition[]): Record<string, string> {
  const owners = new Map<string, string>();
  for (const bot of bots) {
    for (const domain of bot.domains) {
      const existing = owners.get(domain);
      if (existing !== undefined) {
        throw new BotConfigError(
          `domain "${domain}" is owned by both "${existing}" and "${bot.name}"`,
          bot.configPath,
        );
      }
      owners.set(domain, bot.name);
    }
  }
  return Object.fromEntries(owners);
}

function validateDelegates(allBots: BotDefinition[], enabledBots: BotDefinition[]): void {
  const enabled = new Set(enabledBots.map((bot) => bot.name));
  const defined = new Set(allBots.map((bot) => bot.name));
  for (const bot of enabledBots) {
    for (const delegate of bot.delegates) {
      if (delegate === bot.name) {
        throw new BotConfigError(`bot "${bot.name}" may not delegate to itself`, bot.configPath);
      }
      if (enabled.has(delegate)) continue;
      const reason = defined.has(delegate) ? "is disabled" : "is not defined";
      throw new BotConfigError(
        `bot "${bot.name}" delegates to "${delegate}", which ${reason}`,
        bot.configPath,
      );
    }
  }
}

export function buildBotRoster(
  candidates: ConfigCandidate[],
  agentDir: string,
  projectRoot: string,
  agentProjectRoot: string = projectRoot,
): BotRoster {
  const ordered = [...candidates].sort((left, right) => left.precedence - right.precedence);
  const documents = ordered.map((candidate) => ({
    scope: candidate.scope,
    configPath: candidate.path,
    parsed: parseBotsConfig(candidate.content, candidate.path),
  }));
  const defaults = resolveDefaults(documents.map((document) => document.parsed));
  const botsByName = new Map<string, BotSource>();
  let sharedInstructions: string | undefined;
  for (const document of documents) {
    if (document.parsed.sharedInstructions !== undefined) {
      sharedInstructions = document.parsed.sharedInstructions;
    }
    for (const raw of document.parsed.bots) {
      botsByName.set(normalizeBotName(raw.name), {
        raw,
        scope: document.scope,
        configPath: document.configPath,
      });
    }
  }
  const bots = [...botsByName.values()].map((source) => buildBotDefinition(source, defaults));
  const enabledBots = bots.filter((bot) => bot.enabled);
  validateDelegates(bots, enabledBots);
  const roster: BotRoster = {
    version: 1,
    bots,
    domainOwners: collectDomainOwners(enabledBots),
    sources: ordered.map((candidate) => candidate.path),
    projectRoot,
    agentDir,
    agentProjectRoot,
  };
  if (sharedInstructions !== undefined) roster.sharedInstructions = sharedInstructions;
  return roster;
}

export async function discoverBotRoster(
  cwd: string,
  agentDir?: string,
  options: DiscoverOptions = {},
): Promise<BotRoster> {
  const resolvedAgentDir = path.resolve(agentDir ?? defaultAgentDir());
  const resolvedCwd = path.resolve(cwd);
  const projectRoot = path.resolve(
    options.projectRoot ?? (await findProjectRoot(resolvedCwd)),
  );
  const agentProjectRoot = await findAgentProjectRoot(resolvedCwd, projectRoot);
  const candidates = await collectBotConfigCandidates(resolvedCwd, {
    agentDir: resolvedAgentDir,
    projectRoot,
  });
  return buildBotRoster(candidates, resolvedAgentDir, projectRoot, agentProjectRoot);
}
