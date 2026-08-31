import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  appendContainedFile,
  createContainedFileExclusive,
  readContainedFileBounded,
  readContainedFileTail,
  replaceContainedFile,
  withContainedFileLock,
} from "./safe-fs.ts";
import {
  BOTS_CONFIG_VERSION,
  type BotDefinition,
  type BotRoster,
  type BotStateSnapshot,
  type DomainRecordInput,
  type MemoryRecordInput,
} from "./types.ts";

export interface BotStateStoreOptions {
  clock?: () => Date;
  newId?: () => string;
}

export interface BotStateRecordResult {
  id: string;
  recordedAt: string;
}

const DOMAIN_FILE_LIMIT_BYTES = 32 * 1024;
const PERSISTED_STATE_LIMIT_BYTES = 32 * 1024;
const SNAPSHOT_TOTAL_LIMIT_BYTES = 128 * 1024;
const RECORD_LIMIT_BYTES = 8 * 1024;
const FRONTMATTER_PROBE_BYTES = 4096;

interface DomainFrontmatter {
  version: string;
  domain: string;
  owner: string;
}

interface BoundedRead {
  content: string;
  truncated: boolean;
}

function findEnabledBot(roster: BotRoster, runtimeName: string | undefined): BotDefinition | undefined {
  if (runtimeName === undefined) return undefined;
  return roster.bots.find((bot) => bot.enabled && bot.runtimeName === runtimeName);
}

function findBotByName(roster: BotRoster, name: string | undefined): BotDefinition | undefined {
  if (name === undefined) return undefined;
  return roster.bots.find((bot) => bot.name === name);
}

function domainStateRoot(bot: BotDefinition, roster: BotRoster): string {
  return bot.scope === "project" ? roster.projectRoot : roster.agentDir;
}

function memoryStateRoot(bot: BotDefinition, roster: BotRoster): string {
  return bot.memory === "project" ? roster.projectRoot : roster.agentDir;
}


function domainFilePath(bot: BotDefinition, roster: BotRoster, domain: string): string {
  return bot.scope === "project"
    ? join(roster.projectRoot, ".pi", "team-context", `${domain}.md`)
    : join(roster.agentDir, "team-context", `${domain}.md`);
}

function memoryFilePath(bot: BotDefinition, roster: BotRoster): string {
  return bot.memory === "project"
    ? join(roster.projectRoot, ".pi", "agent-memory", "pi-bots", bot.name, "MEMORY.md")
    : join(roster.agentDir, "agent-memory", "pi-bots", bot.name, "MEMORY.md");
}

async function readBounded(root: string, path: string, limitBytes: number): Promise<BoundedRead | undefined> {
  return readContainedFileBounded(root, path, limitBytes);
}

function parseDomainFrontmatter(head: string): DomainFrontmatter | undefined {
  const lines = head.split("\n");
  if (lines[0]?.trim() !== "---") return undefined;
  const fields: Partial<Record<keyof DomainFrontmatter, string>> = {};
  let closing: number | undefined;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "---") {
      closing = index;
      break;
    }
    const separator = line.indexOf(":");
    if (separator <= 0 || line.trim() === "") return undefined;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "" || value === "" || key in fields) return undefined;
    if (key !== "version" && key !== "domain" && key !== "owner") return undefined;
    fields[key] = value;
  }
  const { version, domain, owner } = fields;
  if (closing === undefined || version === undefined || domain === undefined || owner === undefined) {
    return undefined;
  }
  return { version, domain, owner };
}

async function appendDomainRecord(
  bot: BotDefinition,
  roster: BotRoster,
  domain: string,
  entry: string,
): Promise<void> {
  const root = domainStateRoot(bot, roster);
  const path = domainFilePath(bot, roster, domain);
  const expected: DomainFrontmatter = {
    version: String(BOTS_CONFIG_VERSION),
    domain,
    owner: bot.name,
  };
  const header = `---\nversion: ${expected.version}\ndomain: ${expected.domain}\nowner: ${expected.owner}\n---\n\n`;
  await withContainedFileLock(root, path, async () => {
    let existing = await readBounded(root, path, FRONTMATTER_PROBE_BYTES);
    if (existing === undefined) {
      try {
        await createContainedFileExclusive(root, path, `${header}${entry}`);
        await compactDomainFile(root, path, header);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        existing = await readBounded(root, path, FRONTMATTER_PROBE_BYTES);
      }
    }
    const parsed = existing === undefined ? undefined : parseDomainFrontmatter(existing.content);
    if (parsed === undefined) {
      throw new Error(`bot-state: ${path} lacks version ${expected.version} domain frontmatter`);
    }
    if (parsed.version !== expected.version || parsed.domain !== expected.domain) {
      throw new Error(
        `bot-state: ${path} frontmatter (version=${parsed.version}, domain=${parsed.domain}, owner=${parsed.owner}) ` +
          `does not match expected (version=${expected.version}, domain=${expected.domain}, owner=${expected.owner})`,
      );
    }
    if (parsed.owner !== expected.owner) {
      const current = await readContainedFileBounded(root, path, PERSISTED_STATE_LIMIT_BYTES);
      if (current === undefined || current.truncated) {
        throw new Error(`bot-state: cannot transfer ownership of oversized domain file ${path}`);
      }
      const closing = current.content.indexOf("\n---\n", 4);
      if (closing < 0) throw new Error(`bot-state: ${path} lacks version ${expected.version} domain frontmatter`);
      const body = current.content.slice(closing + 5).replace(/^\n*/, "");
      await replaceContainedFile(root, path, `${header}${body}`);
    }
    await appendContainedFile(root, path, `\n${entry}`);
    await compactDomainFile(root, path, header);
  });
}

async function compactDomainFile(root: string, path: string, header: string): Promise<void> {
  const budget = PERSISTED_STATE_LIMIT_BYTES - Buffer.byteLength(header, "utf8");
  const tail = await readContainedFileTail(root, path, budget);
  if (!tail?.truncated) return;
  await replaceContainedFile(root, path, `${header}${newestCompleteEntries(tail.content, "## ")}`);
}

function newestCompleteEntries(content: string, prefix: string): string {
  if (content.startsWith(prefix)) return content;
  const marker = content.indexOf(`\n${prefix}`);
  if (marker < 0) throw new Error(`bot-state: persisted entry exceeds the ${PERSISTED_STATE_LIMIT_BYTES}-byte state limit`);
  return content.slice(marker + 1);
}

function clampUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return value;
  const clipped = buffer.subarray(0, maxBytes).toString("utf8");
  const endsSplit = clipped.endsWith("\uFFFD") && !value.endsWith("\uFFFD");
  return endsSplit ? clipped.slice(0, -1) : clipped;
}
function normalizedStateText(value: string, label: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) throw new Error(`bot-state: ${label} must not be empty`);
  return normalized;
}

function formatDomainRecord(record: DomainRecordInput, recordedAt: string, id: string): string {
  const header = `## ${recordedAt} ${record.kind} ${id}\n`;
  const evidence = record.evidence;
  if (evidence === undefined) {
    const summaryBudget = RECORD_LIMIT_BYTES - Buffer.byteLength(header, "utf8") - 1;
    return `${header}${clampUtf8(record.summary, summaryBudget)}\n`;
  }
  const overhead = Buffer.byteLength(`${header}\nEvidence: \n`, "utf8");
  const contentBudget = Math.max(RECORD_LIMIT_BYTES - overhead, 0);
  const summaryBytes = Buffer.byteLength(record.summary, "utf8");
  const evidenceBytes = Buffer.byteLength(evidence, "utf8");
  const half = Math.floor(contentBudget / 2);
  const summaryBudget = Math.min(summaryBytes, Math.max(half, contentBudget - evidenceBytes));
  const evidenceBudget = Math.min(evidenceBytes, contentBudget - summaryBudget);
  return `${header}${clampUtf8(record.summary, summaryBudget)}\nEvidence: ${clampUtf8(evidence, evidenceBudget)}\n`;
}


async function readDomainEntries(
  roster: BotRoster,
  totalLimitBytes: number,
  onlyDomain?: string,
): Promise<BotStateSnapshot["domains"]> {
  const domains = onlyDomain === undefined ? Object.keys(roster.domainOwners).sort() : [onlyDomain];
  let budget = totalLimitBytes;
  const entries: BotStateSnapshot["domains"] = [];
  for (const domain of domains) {
    const ownerBot = findBotByName(roster, roster.domainOwners[domain]);
    if (ownerBot === undefined) continue;
    const path = domainFilePath(ownerBot, roster, domain);
    const read = await readBounded(domainStateRoot(ownerBot, roster), path, Math.min(DOMAIN_FILE_LIMIT_BYTES, Math.max(budget, 0)));
    const content = read?.content ?? "";
    budget -= Buffer.byteLength(content, "utf8");
    entries.push({ domain, owner: ownerBot.name, path, content, truncated: read?.truncated ?? false });
  }
  return entries;
}

async function appendMemoryRecord(root: string, path: string, entry: string): Promise<void> {
  await withContainedFileLock(root, path, async () => {
    await appendContainedFile(root, path, entry);
    const tail = await readContainedFileTail(root, path, PERSISTED_STATE_LIMIT_BYTES);
    if (!tail?.truncated) return;
    await replaceContainedFile(root, path, newestCompleteEntries(tail.content, "- "));
  });
}

export class BotStateStore {
  readonly #roster: BotRoster;
  readonly #clock: () => Date;
  readonly #newId: () => string;

  constructor(roster: BotRoster, options: BotStateStoreOptions = {}) {
    this.#roster = roster;
    this.#clock = options.clock ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
  }

  #requireBot(runtimeName: string | undefined): BotDefinition {
    const bot = findEnabledBot(this.#roster, runtimeName);
    if (bot === undefined) {
      throw new Error(`bot-state: no enabled bot for runtime name ${JSON.stringify(runtimeName ?? null)}`);
    }
    return bot;
  }


  async snapshot(runtimeName?: string, domain?: string): Promise<BotStateSnapshot> {
    const bot = findEnabledBot(this.#roster, runtimeName);
    let memory: string | undefined;
    let domainBudget = SNAPSHOT_TOTAL_LIMIT_BYTES;
    if (bot !== undefined && bot.memory !== "off") {
      memory = (await readBounded(memoryStateRoot(bot, this.#roster), memoryFilePath(bot, this.#roster), DOMAIN_FILE_LIMIT_BYTES))?.content;
      domainBudget -= Buffer.byteLength(memory ?? "", "utf8");
    }
    const domains = await readDomainEntries(this.#roster, domainBudget, domain);
    return { bot, memory, domains };
  }

  async recordDomain(
    runtimeName: string | undefined,
    record: DomainRecordInput,
  ): Promise<BotStateRecordResult> {
    const bot = this.#requireBot(runtimeName);
    if (record.domain === "" || /[/\\]/.test(record.domain)) {
      throw new Error(`bot-state: unsafe domain name ${JSON.stringify(record.domain)}`);
    }
    const owner = this.#roster.domainOwners[record.domain];
    if (owner !== bot.name) {
      throw new Error(
        `bot-state: bot ${bot.name} may not record domain ${record.domain} owned by ${owner ?? "nobody"}`,
      );
    }
    if (record.kind !== "observation" && record.kind !== "inference" && record.kind !== "verified") {
      throw new Error("bot-state: domain record kind must be observation, inference, or verified");
    }
    if (record.kind === "verified" && (record.evidence === undefined || record.evidence.trim() === "")) {
      throw new Error(`bot-state: verified domain record for ${record.domain} requires evidence`);
    }
    const summary = normalizedStateText(record.summary, "domain record summary");
    const evidence = record.evidence === undefined ? undefined : normalizedStateText(record.evidence, "domain record evidence");
    const id = this.#newId();
    const recordedAt = this.#clock().toISOString();
    const entry = formatDomainRecord({ ...record, summary, evidence }, recordedAt, id);
    await appendDomainRecord(bot, this.#roster, record.domain, entry);
    return { id, recordedAt };
  }

  async remember(
    runtimeName: string | undefined,
    record: MemoryRecordInput,
  ): Promise<BotStateRecordResult> {
    const bot = this.#requireBot(runtimeName);
    if (bot.memory === "off") {
      throw new Error(`bot-state: bot ${bot.name} has private memory off`);
    }
    const id = this.#newId();
    const recordedAt = this.#clock().toISOString();
    const path = memoryFilePath(bot, this.#roster);
    const prefix = `- ${recordedAt} ${id} `;
    const summary = clampUtf8(normalizedStateText(record.summary, "private memory summary"), RECORD_LIMIT_BYTES - Buffer.byteLength(prefix, "utf8") - 1);
    await appendMemoryRecord(memoryStateRoot(bot, this.#roster), path, `${prefix}${summary}\n`);
    return { id, recordedAt };
  }
}
