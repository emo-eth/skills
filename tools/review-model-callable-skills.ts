#!/usr/bin/env -S node --experimental-strip-types --disable-warning=ExperimentalWarning
//
// A decision wizard - presents a custom list one item at a time and applies a
// task-specific action after the human decides every card.
//
// Everything above the "CUSTOMIZE" marker is the review library. Keep it the
// same in every generated decision wizard. Author the source and action below.
//
// The shape follows the self-contained template pattern used by the wizard
// skill. It is intentionally not a generic runtime: each generated CLI owns
// its list source and its action.

const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} = require("node:fs/promises");
const { dirname, join, relative } = require("node:path");
const { spawnSync } = require("node:child_process");
const { createInterface } = require("node:readline/promises");

const STATE_VERSION = 1;
const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const useColor = Boolean(
  process.stdout.isTTY && process.env.NO_COLOR === undefined,
);

type ReviewItem = {
  id: string;
  title: string;
  description: string;
  details?: Array<[string, string]>;
};

type Decision = "approve" | "reject";

type ReviewOutcome = {
  items: ReviewItem[];
  approved: ReviewItem[];
  rejected: ReviewItem[];
  decisions: Record<string, Decision>;
  snapshot: string;
};

type ReviewState = {
  version: number;
  snapshot: string;
  decisions: Record<string, Decision>;
  updatedAt: string;
};

type ReviewArguments = {
  dryRun: boolean;
  help: boolean;
  reset: boolean;
};

type ReviewOptions = {
  title: string;
  stateFile: string;
  positiveLabel: string;
  negativeLabel: string;
  items: ReviewItem[];
};

const scriptedInput: string[] | undefined = process.stdin.isTTY
  ? undefined
  : readFileSync(0, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

function paint(value: string, color: string): string {
  return useColor ? `${color}${value}${RESET}` : value;
}

function clearScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write("\u001b[2J\u001b[3J\u001b[H");
  }
}

function parseArguments(args: string[]): ReviewArguments {
  const known = new Set(["--dry-run", "--help", "--reset", "--resume"]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown option: ${unknown.join(", ")}`);
  }

  return {
    dryRun: args.includes("--dry-run"),
    help: args.includes("--help"),
    reset: args.includes("--reset"),
  };
}

function printHelp(title: string, stateFile: string): void {
  console.log(`Usage: node <this-file> [options]

${title}

Controls in a terminal:
  LEFT or r    choose the negative decision
  RIGHT or a   choose the positive decision
  q            pause and save progress

Options:
  --resume     resume saved decisions (the default)
  --reset      discard saved decisions and start again
  --dry-run    review and show the plan without applying it
  --help       show this help

State file: ${stateFile}
`);
}

function assertReviewItems(items: ReviewItem[]): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id.trim()) throw new Error("Every review item needs a non-empty id");
    if (ids.has(item.id)) throw new Error(`Duplicate review item id: ${item.id}`);
    ids.add(item.id);
  }
}

function snapshotFor(items: ReviewItem[]): string {
  const value = JSON.stringify(
    items.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      details: item.details ?? [],
    })),
  );
  return createHash("sha256").update(value).digest("hex");
}

async function readState(stateFile: string): Promise<ReviewState | undefined> {
  try {
    const content = await readFile(stateFile, "utf8");
    const state = JSON.parse(content) as ReviewState;
    if (
      state.version !== STATE_VERSION ||
      typeof state.snapshot !== "string" ||
      !state.decisions ||
      typeof state.decisions !== "object"
    ) {
      throw new Error("the state file has an unsupported format");
    }
    return state;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${stateFile}: ${message}`);
  }
}

async function writeState(
  stateFile: string,
  snapshot: string,
  decisions: Record<string, Decision>,
): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  const temporaryFile = `${stateFile}.${process.pid}.tmp`;
  const state: ReviewState = {
    version: STATE_VERSION,
    snapshot,
    decisions,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryFile, stateFile);
}

async function removeState(stateFile: string): Promise<void> {
  await rm(stateFile, { force: true });
}

async function readLine(prompt: string): Promise<string> {
  if (scriptedInput !== undefined) {
    return scriptedInput.shift() ?? "";
  }

  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await reader.question(prompt);
  } finally {
    reader.close();
  }
}

function nextScriptedAnswer(): string | undefined {
  return scriptedInput?.shift();
}

function normalizeDecision(value: string): Decision | "pause" | undefined {
  const answer = value.trim().toLowerCase();
  if (["a", "approve", "approved", "right", "->"].includes(answer)) {
    return "approve";
  }
  if (["r", "reject", "rejected", "left", "<-"].includes(answer)) {
    return "reject";
  }
  if (["q", "quit", "pause", "ctrl-c"].includes(answer)) return "pause";
  return undefined;
}

async function chooseDecision(): Promise<Decision | "pause"> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const answer = nextScriptedAnswer();
    return answer ? normalizeDecision(answer) ?? "pause" : "pause";
  }

  if (typeof process.stdin.setRawMode !== "function") {
    const answer = await readLine("Decision [a/r/q]: ");
    return normalizeDecision(answer) ?? "pause";
  }

  process.stdin.resume();
  process.stdin.setRawMode(true);
  return new Promise<Decision | "pause">((resolve) => {
    const finish = (decision: Decision | "pause"): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
      resolve(decision);
    };

    const onData = (chunk: Buffer | string): void => {
      const input = chunk.toString();
      if (input.includes("\u0003")) return finish("pause");
      if (input.includes("\u001b[C") || input.includes("\u001bOC")) {
        return finish("approve");
      }
      if (input.includes("\u001b[D") || input.includes("\u001bOD")) {
        return finish("reject");
      }
      const decision = normalizeDecision(input);
      if (decision) finish(decision);
    };

    process.stdin.on("data", onData);
  });
}

function renderCard(
  title: string,
  positiveLabel: string,
  negativeLabel: string,
  item: ReviewItem,
  index: number,
  total: number,
  decided: number,
): void {
  clearScreen();
  console.log("-".repeat(72));
  console.log(
    `${title}  |  CARD ${index + 1} OF ${total}  |  DECIDED ${decided}`,
  );
  console.log("-".repeat(72));
  console.log(`${paint("TITLE", BOLD)}: ${item.title}`);
  console.log(`${paint("ID", BOLD)}: ${item.id}`);
  console.log(`${paint("DESCRIPTION", BOLD)}: ${item.description}`);
  for (const [label, value] of item.details ?? []) {
    console.log(`${paint(label.toUpperCase(), BOLD)}: ${value}`);
  }
  console.log("-".repeat(72));
  console.log(
    `LEFT / r = ${negativeLabel}    RIGHT / a = ${positiveLabel}    q = pause`,
  );
}

function printSummary(
  title: string,
  positiveLabel: string,
  negativeLabel: string,
  outcome: ReviewOutcome,
): void {
  console.log(`\n${title} - COMPLETE`);
  console.log(`${positiveLabel}: ${outcome.approved.length}`);
  console.log(`${negativeLabel}: ${outcome.rejected.length}`);
  if (outcome.approved.length > 0) {
    console.log(`\n${positiveLabel}:`);
    for (const item of outcome.approved) console.log(`- ${item.id}`);
  }
  if (outcome.rejected.length > 0) {
    console.log(`\n${negativeLabel}:`);
    for (const item of outcome.rejected) console.log(`- ${item.id}`);
  }
}

async function confirmExact(prompt: string, expected: string): Promise<boolean> {
  const answer = await readLine(prompt);
  return answer.trim() === expected;
}

function runCommand(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

class Review {
  private readonly options: ReviewOptions;
  private readonly snapshot: string;

  constructor(options: ReviewOptions) {
    assertReviewItems(options.items);
    this.options = options;
    this.snapshot = snapshotFor(options.items);
  }

  async run(args: ReviewArguments): Promise<ReviewOutcome | undefined> {
    if (args.reset) await removeState(this.options.stateFile);

    const saved = await readState(this.options.stateFile);
    if (saved && saved.snapshot !== this.snapshot) {
      throw new Error(
        `The review list changed since the saved session. Inspect it, then run --reset.`,
      );
    }

    if (this.options.items.length === 0) {
      await removeState(this.options.stateFile);
      console.log("No items to review.");
      return undefined;
    }

    const decisions: Record<string, Decision> = saved?.decisions ?? {};
    await writeState(this.options.stateFile, this.snapshot, decisions);

    for (let index = 0; index < this.options.items.length; index += 1) {
      const item = this.options.items[index];
      if (decisions[item.id]) continue;

      renderCard(
        this.options.title,
        this.options.positiveLabel,
        this.options.negativeLabel,
        item,
        index,
        this.options.items.length,
        Object.keys(decisions).length,
      );
      const decision = await chooseDecision();
      if (decision === "pause") {
        await writeState(this.options.stateFile, this.snapshot, decisions);
        console.log("Review paused. Decisions are saved.");
        return undefined;
      }

      decisions[item.id] = decision;
      await writeState(this.options.stateFile, this.snapshot, decisions);
      console.log(
        `${decision === "approve" ? this.options.positiveLabel : this.options.negativeLabel}: ${item.id}`,
      );
    }

    const outcome: ReviewOutcome = {
      items: this.options.items,
      approved: this.options.items.filter((item) => decisions[item.id] === "approve"),
      rejected: this.options.items.filter((item) => decisions[item.id] === "reject"),
      decisions,
      snapshot: this.snapshot,
    };
    printSummary(
      this.options.title,
      this.options.positiveLabel,
      this.options.negativeLabel,
      outcome,
    );
    return outcome;
  }

  async clearState(): Promise<void> {
    await removeState(this.options.stateFile);
  }
}


// -----------------------------------------------------------------------------
// CUSTOMIZE - author this section. Keep the review library above unchanged.
// -----------------------------------------------------------------------------

const { lstat, readdir } = require("node:fs/promises");
const { homedir } = require("node:os");

type LockEntry = {
  source?: string;
  sourceType?: string;
  sourceUrl?: string;
  skillPath?: string;
  skillFolderHash?: string;
  installedAt?: string;
  updatedAt?: string;
};

type GlobalLock = {
  skills?: Record<string, LockEntry>;
};

type Frontmatter = Record<string, string | boolean>;

type SkillMetadata = {
  title: string;
  description: string;
  modelCallable: boolean;
};

const REVIEW_TITLE = "Review OMP model-callable skills";
const AUDIT_HOME = process.env.SKILL_AUDITOR_HOME ?? homedir();
const AGENTS_DIR = join(AUDIT_HOME, ".agents");
const CANONICAL_ROOT = join(AGENTS_DIR, "skills");
const SKILLS_DIR = process.env.SKILL_AUDITOR_SKILLS_DIR ?? CANONICAL_ROOT;
const LOCK_FILE =
  process.env.SKILL_AUDITOR_LOCK ??
  (process.env.XDG_STATE_HOME
    ? join(process.env.XDG_STATE_HOME, "skills", ".skill-lock.json")
    : join(AGENTS_DIR, ".skill-lock.json"));
const STATE_FILE =
  process.env.SKILL_AUDITOR_STATE ??
  join(AGENTS_DIR, "model-callable-skills-invocation-review.json");
const POSITIVE_LABEL = "keep";
const NEGATIVE_LABEL = "disable";
const locationsByName = new Map<string, string[]>();

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }
  return undefined;
}

function parseScalar(value: string): string | boolean {
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === "true") return true;
  if (trimmed.toLowerCase() === "false") return false;
  if (
    trimmed.length >= 2 &&
    trimmed.startsWith("\"") &&
    trimmed.endsWith("\"")
  ) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function parseFrontmatter(raw: string): { fields: Frontmatter; body: string } {
  const content = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { fields: {}, body: content };

  const fields: Frontmatter = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const field = lines[index].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;

    const [, key, value] = field;
    if (/^[>|][-+]?$/.test(value.trim())) {
      const block: string[] = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        if (lines[next].trim() === "" || /^\s/.test(lines[next])) {
          block.push(lines[next].trim());
          index = next;
          continue;
        }
        break;
      }
      fields[key] = value.trim().startsWith(">")
        ? block.filter(Boolean).join(" ")
        : block.join("\n");
      continue;
    }

    fields[key] = parseScalar(value);
  }

  return { fields, body: content.slice(match[0].length) };
}

function compact(value: string, maxLength = 320): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 3).trimEnd()}...`;
}

function readSkillMetadata(raw: string, skillName: string): SkillMetadata {
  const { fields, body } = parseFrontmatter(raw);
  const heading = body.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  const firstParagraph = body
    .replace(/^#.*$/gm, "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/[`*_]/g, "").trim())
    .find(Boolean);
  const description =
    typeof fields.description === "string" && fields.description.trim()
      ? fields.description
      : firstParagraph || "No description found.";
  const disabled =
    fields["disable-model-invocation"] === true ||
    fields["disable-model-invocation"] === "true";

  return {
    title: compact(heading || String(fields.name || skillName), 160),
    description: compact(description),
    modelCallable: !disabled,
  };
}

function assertSafeSkillName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`Unsafe installed skill name: ${JSON.stringify(name)}`);
  }
}

async function readGlobalLock(): Promise<GlobalLock> {
  try {
    const content = await readFile(LOCK_FILE, "utf8");
    const lock = JSON.parse(content) as GlobalLock;
    if (!lock || typeof lock !== "object") {
      throw new Error("the lock file is not an object");
    }
    return lock;
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return { skills: {} };
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${LOCK_FILE}: ${message}`);
  }
}

function disableModelInvocation(raw: string): string {
  const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
  const content = bom ? raw.slice(1) : raw;
  const match = content.match(
    /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/,
  );
  if (!match) {
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    return `${bom}---${newline}disable-model-invocation: true${newline}---${newline}${content}`;
  }

  const [, opening, block, closing] = match;
  const newline = opening.endsWith("\r\n") ? "\r\n" : "\n";
  let found = false;
  const lines = block.split(/\r?\n/).map((line) => {
    if (!/^disable-model-invocation\s*:/.test(line)) return line;
    found = true;
    const prefix =
      line.match(/^(disable-model-invocation\s*:\s*)/)?.[1] ??
      "disable-model-invocation: ";
    return `${prefix}true`;
  });
  if (!found) lines.push("disable-model-invocation: true");

  return `${bom}${opening}${lines.join(newline)}${closing}${content.slice(match[0].length)}`;
}

let temporaryFileNumber = 0;

async function writeTextAtomically(
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${temporaryFileNumber++}.tmp`;
  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

type ContentFile = {
  relativePath: string;
  content: Buffer;
};

async function collectContentFiles(
  basePath: string,
  currentPath: string,
  files: ContentFile[],
): Promise<void> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const filePath = join(currentPath, entry.name);
    if (entry.isDirectory()) {
      await collectContentFiles(basePath, filePath, files);
    } else if (entry.isFile()) {
      files.push({
        relativePath: relative(basePath, filePath).split("\\").join("/"),
        content: await readFile(filePath),
      });
    }
  }
}

async function computeContentHash(skillPath: string): Promise<string> {
  const files: ContentFile[] = [];
  await collectContentFiles(skillPath, skillPath, files);
  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return hash.digest("hex");
}

type GitTreeEntry = {
  name: string;
  mode: string;
  hash: Buffer;
};

async function computeGitTreeHash(skillPath: string): Promise<string> {
  const entries: GitTreeEntry[] = [];
  const children = await readdir(skillPath, { withFileTypes: true });

  for (const child of children) {
    if (child.name === ".git" || child.name === "node_modules") continue;
    const childPath = join(skillPath, child.name);
    if (child.isDirectory()) {
      entries.push({
        name: child.name,
        mode: "40000",
        hash: Buffer.from(await computeGitTreeHash(childPath), "hex"),
      });
    } else if (child.isFile()) {
      const content = await readFile(childPath);
      const mode = (await lstat(childPath)).mode & 0o111 ? "100755" : "100644";
      const blobPayload = Buffer.concat([
        Buffer.from(`blob ${content.length}\0`),
        content,
      ]);
      entries.push({
        name: child.name,
        mode,
        hash: createHash("sha1").update(blobPayload).digest(),
      });
    }
  }

  entries.sort((left, right) => {
    const leftName = `${left.name}${left.mode === "40000" ? "/" : ""}`;
    const rightName = `${right.name}${right.mode === "40000" ? "/" : ""}`;
    return Buffer.from(leftName).compare(Buffer.from(rightName));
  });

  const treePayload = Buffer.concat(
    entries.map((entry) =>
      Buffer.concat([
        Buffer.from(`${entry.mode} ${entry.name}\0`),
        entry.hash,
      ]),
    ),
  );
  return createHash("sha1")
    .update(
      Buffer.concat([Buffer.from(`tree ${treePayload.length}\0`), treePayload]),
    )
    .digest("hex");
}

async function computeSkillFolderHash(
  skillPath: string,
  previousHash?: string,
): Promise<string> {
  return /^[0-9a-f]{40}$/i.test(previousHash ?? "")
    ? computeGitTreeHash(skillPath)
    : computeContentHash(skillPath);
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

type LockUpdate = {
  before: string | undefined;
  changed: boolean;
  updatedNames: string[];
};

async function updateLockHashes(names: string[]): Promise<LockUpdate> {
  const before = await readOptionalFile(LOCK_FILE);
  const lock = await readGlobalLock();
  const updatedNames: string[] = [];
  const updatedAt = new Date().toISOString();

  for (const name of names) {
    const entry = lock.skills?.[name];
    if (!entry) continue;
    const skillPath = locationsByName.get(name)?.[0];
    if (!skillPath) {
      throw new Error(`Could not find the installed path for ${name}`);
    }
    entry.skillFolderHash = await computeSkillFolderHash(
      skillPath,
      entry.skillFolderHash,
    );
    entry.updatedAt = updatedAt;
    updatedNames.push(name);
  }

  if (updatedNames.length === 0) {
    return { before, changed: false, updatedNames };
  }

  const after = JSON.stringify(lock, null, 2);
  if (after !== before) await writeTextAtomically(LOCK_FILE, after);
  return { before, changed: after !== before, updatedNames };
}

async function verifyLockHashes(names: string[]): Promise<void> {
  const lock = await readGlobalLock();
  const failures: string[] = [];
  for (const name of names) {
    const entry = lock.skills?.[name];
    const skillPath = locationsByName.get(name)?.[0];
    if (!entry || !skillPath) continue;
    const expected = await computeSkillFolderHash(
      skillPath,
      entry.skillFolderHash,
    );
    if (entry.skillFolderHash !== expected) {
      failures.push(
        `${name}: expected ${expected}, found ${entry.skillFolderHash}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(`Global skill lock hashes are stale: ${failures.join(", ")}`);
  }
}

async function verifyDisabled(names: string[]): Promise<void> {
  const failures: string[] = [];
  for (const name of names) {
    for (const path of locationsByName.get(name) ?? []) {
      try {
        const raw = await readFile(join(path, "SKILL.md"), "utf8");
        if (readSkillMetadata(raw, name).modelCallable) {
          failures.push(`${name} at ${path}`);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${name} at ${path}: ${message}`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Model invocation is still enabled for: ${failures.join(", ")}`,
    );
  }
}

async function installedSkillLocations(): Promise<Map<string, string[]>> {
  const locations = new Map<string, string[]>();
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    },
  );
  for (const entry of entries) {
    if (
      entry.name.startsWith(".") ||
      (!entry.isDirectory() && !entry.isSymbolicLink())
    ) {
      continue;
    }
    locations.set(entry.name, [join(SKILLS_DIR, entry.name)]);
  }
  return locations;
}

async function loadItems(): Promise<ReviewItem[]> {
  const [locations, lock] = await Promise.all([
    installedSkillLocations(),
    readGlobalLock(),
  ]);
  locationsByName.clear();
  const items: ReviewItem[] = [];

  for (const name of [...locations.keys()].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  )) {
    assertSafeSkillName(name);
    const skillPath = locations.get(name)?.[0];
    if (!skillPath) continue;

    let raw: string;
    try {
      raw = await readFile(join(skillPath, "SKILL.md"), "utf8");
    } catch (error: unknown) {
      if (errorCode(error) === "ENOENT") continue;
      throw error;
    }

    const metadata = readSkillMetadata(raw, name);
    if (!metadata.modelCallable) continue;

    locationsByName.set(name, [skillPath]);
    const lockEntry = lock.skills?.[name];
    const source =
      lockEntry?.sourceUrl ||
      lockEntry?.source ||
      "Unknown: no global lock entry";
    items.push({
      id: name,
      title: metadata.title,
      description: metadata.description,
      details: [
        ["Name", name],
        ["Source", source],
        ["Source type", lockEntry?.sourceType || "unknown"],
        ["Source path", lockEntry?.skillPath || "not in global lock"],
        ["Installed path", skillPath],
        ["Model invocation", "currently allowed directly in OMP"],
      ],
    });
  }

  return items;
}

async function printActionPlan(outcome: ReviewOutcome): Promise<void> {
  if (outcome.rejected.length === 0) {
    console.log("\nNo skills were selected for disabling. No changes are needed.");
    return;
  }

  const names = outcome.rejected.map((item) => item.id);
  const lock = await readGlobalLock();
  const lockedNames = names.filter((name) => Boolean(lock.skills?.[name]));
  const untrackedNames = names.filter((name) => !lock.skills?.[name]);
  console.log(
    `\nPlan: disable model invocation for ${names.length} skill(s)`,
  );
  for (const name of names) console.log(`- ${name}`);
  console.log(
    "\nEach selected SKILL.md will retain the skill and gain " +
      "disable-model-invocation: true.",
  );
  if (lockedNames.length > 0) {
    console.log(
      `The global skill lock will update skillFolderHash and updatedAt for ` +
        `${lockedNames.length} selected skill(s).`,
    );
  }
  if (untrackedNames.length > 0) {
    console.log(
      `No global lock entry exists for: ${untrackedNames.join(", ")}.`,
    );
  }
}

async function applyOutcome(outcome: ReviewOutcome): Promise<string[]> {
  const names = outcome.rejected.map((item) => item.id);
  const changes: Array<{ path: string; before: string; after: string }> = [];
  let lockUpdate: LockUpdate = {
    before: undefined,
    changed: false,
    updatedNames: [],
  };

  for (const name of names) {
    assertSafeSkillName(name);
    const paths = locationsByName.get(name) ?? [];
    if (paths.length === 0) {
      throw new Error(`Could not find the installed path for ${name}`);
    }
    for (const path of paths) {
      const filePath = join(path, "SKILL.md");
      const before = await readFile(filePath, "utf8");
      changes.push({
        path: filePath,
        before,
        after: disableModelInvocation(before),
      });
    }
  }

  try {
    for (const change of changes) {
      if (change.before !== change.after) {
        await writeTextAtomically(change.path, change.after);
      }
    }
    await verifyDisabled(names);
    lockUpdate = await updateLockHashes(names);
    await verifyLockHashes(lockUpdate.updatedNames);
    return lockUpdate.updatedNames;
  } catch (error: unknown) {
    const rollbackFailures: string[] = [];
    if (lockUpdate.changed) {
      try {
        if (lockUpdate.before === undefined) {
          await rm(LOCK_FILE, { force: true });
        } else {
          await writeTextAtomically(LOCK_FILE, lockUpdate.before);
        }
      } catch (rollbackError: unknown) {
        const message =
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError);
        rollbackFailures.push(`${LOCK_FILE}: ${message}`);
      }
    }
    for (const change of [...changes].reverse()) {
      if (change.before === change.after) continue;
      try {
        await writeTextAtomically(change.path, change.before);
      } catch (rollbackError: unknown) {
        const message =
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError);
        rollbackFailures.push(`${change.path}: ${message}`);
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    if (rollbackFailures.length > 0) {
      throw new Error(
        `${message}. Rollback failed for: ${rollbackFailures.join(", ")}`,
      );
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printHelp(REVIEW_TITLE, STATE_FILE);
    return;
  }

  const items = await loadItems();
  console.log(`Found ${items.length} OMP model-callable skill(s).`);
  const review = new Review({
    title: REVIEW_TITLE,
    stateFile: STATE_FILE,
    positiveLabel: POSITIVE_LABEL,
    negativeLabel: NEGATIVE_LABEL,
    items,
  });
  const outcome = await review.run(args);
  if (!outcome) return;

  if (args.dryRun) {
    console.log("\nDry run only. No skill file or lock entry was changed.");
    return;
  }

  await printActionPlan(outcome);
  if (outcome.rejected.length === 0) {
    await review.clearState();
    return;
  }
  if (!(await confirmExact("Type DISABLE to continue: ", "DISABLE"))) {
    console.log("Disabling skipped. The saved review can resume later.");
    return;
  }

  const updatedLockNames = await applyOutcome(outcome);
  await review.clearState();
  console.log(
    "Complete. Selected skills remain installed with model invocation disabled.",
  );
  if (updatedLockNames.length > 0) {
    console.log(
      `Updated global skill lock entries: ${updatedLockNames.join(", ")}.`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nSkill review stopped: ${message}`);
  process.exitCode = 1;
});
