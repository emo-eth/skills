#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const VERSION = 1;
const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const useColor = Boolean(
  process.stdout.isTTY && process.env.NO_COLOR === undefined,
);

const home = process.env.SKILL_AUDITOR_HOME || homedir();
const agentsDir = join(home, ".agents");
const skillsDir =
  process.env.SKILL_AUDITOR_SKILLS_DIR || join(agentsDir, "skills");
const lockPath =
  process.env.SKILL_AUDITOR_LOCK ||
  (process.env.XDG_STATE_HOME
    ? join(process.env.XDG_STATE_HOME, "skills", ".skill-lock.json")
    : join(agentsDir, ".skill-lock.json"));
const sessionPath =
  process.env.SKILL_AUDITOR_SESSION ||
  join(agentsDir, "skill-auditor-session.json");
const options = parseArguments(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}
const scriptedAnswers = process.stdin.isTTY
  ? undefined
  : readFileSync(0, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

function parseArguments(args) {
  const known = new Set(["--dry-run", "--help", "--reset", "--resume"]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown option: ${unknown.join(", ")}`);
  }
  return {
    dryRun: args.includes("--dry-run"),
    help: args.includes("--help"),
    reset: args.includes("--reset"),
    resume: args.includes("--resume"),
  };
}

function printHelp() {
  console.log(`Usage: node tools/skill-auditor.mjs [options]

Review globally installed skills one at a time.

Controls in a terminal:
  LEFT or r    reject the current skill
  RIGHT or a   approve the current skill
  q            pause and save progress

Options:
  --resume     resume the saved audit (the default)
  --reset      discard saved decisions and start again
  --dry-run    show the cleanup command without changing installed skills
  --help       show this help

The app reads the global skills CLI lock and canonical directory:
  ${lockPath}
  ${skillsDir}
`);
}

function paint(value, color) {
  return useColor ? `${color}${value}${RESET}` : value;
}

function assertSafeSkillName(name) {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new Error(`Unsafe skill name in the global lock: ${JSON.stringify(name)}`);
  }
}

async function readLock() {
  try {
    const raw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(raw);
    if (!lock || typeof lock !== "object" || !lock.skills) {
      throw new Error("the lock does not contain a skills object");
    }
    for (const name of Object.keys(lock.skills)) {
      assertSafeSkillName(name);
    }
    return lock;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { version: 3, skills: {} };
    }
    throw new Error(`Could not read ${lockPath}: ${error.message}`);
  }
}

async function directoryNames(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const names = [];
  for (const entry of entries) {
    if (entry.name === "." || entry.name === "..") continue;
    if (entry.isDirectory()) {
      names.push(entry.name);
      continue;
    }
    if (entry.isSymbolicLink()) {
      try {
        if ((await stat(join(directory, entry.name))).isDirectory()) {
          names.push(entry.name);
        }
      } catch {
        // A broken symlink is not an installed skill.
      }
    }
  }
  return names;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"')
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function parseSkillDocument(raw, fallbackName) {
  const content = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const fields = {};
  let body = content;

  if (frontmatterMatch) {
    const lines = frontmatterMatch[1].split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match) continue;

      const [, key, value] = match;
      if (/^[>|][-+]?$/.test(value.trim())) {
        const block = [];
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
      } else {
        fields[key] = parseScalar(value);
      }
    }
    body = content.slice(frontmatterMatch[0].length);
  }

  const heading = body.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  const description = String(fields.description || "").trim();
  const fallbackDescription = body
    .replace(/^#.*$/gm, "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim())
    .find(Boolean);

  return {
    title: heading || String(fields.name || fallbackName),
    description:
      description || fallbackDescription || "No description found.",
  };
}

function shortText(value, length = 320) {
  const singleLine = String(value).replace(/\s+/g, " ").trim();
  if (singleLine.length <= length) return singleLine;
  return `${singleLine.slice(0, length - 3).trimEnd()}...`;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function loadCards(lock) {
  const names = new Set(Object.keys(lock.skills || {}));
  for (const name of await directoryNames(skillsDir)) names.add(name);

  const cards = [];
  for (const name of [...names].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  )) {
    assertSafeSkillName(name);
    const skillPath = join(skillsDir, name, "SKILL.md");
    let raw = "";
    try {
      raw = await readFile(skillPath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const metadata = parseSkillDocument(raw, name);
    const lockEntry = lock.skills?.[name];
    const source = lockEntry?.sourceUrl || lockEntry?.source;
    cards.push({
      name,
      title: shortText(metadata.title, 140),
      description: shortText(metadata.description),
      source: source || "Unknown: not present in the global lock",
      sourceType: lockEntry?.sourceType || "unknown",
      skillPath,
      sourcePath: lockEntry?.skillPath || "",
      contentHash: hash(raw),
    });
  }
  return cards;
}

function snapshotFor(cards) {
  return hash(
    JSON.stringify(
      cards.map((card) => ({
        name: card.name,
        source: card.source,
        sourceType: card.sourceType,
        sourcePath: card.sourcePath,
        contentHash: card.contentHash,
      })),
    ),
  );
}

async function readSession() {
  try {
    const raw = await readFile(sessionPath, "utf8");
    const session = JSON.parse(raw);
    if (
      !session ||
      session.version !== VERSION ||
      typeof session.snapshot !== "string" ||
      !session.decisions ||
      typeof session.decisions !== "object"
    ) {
      throw new Error("the saved session has an unsupported format");
    }
    return session;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw new Error(`Could not read ${sessionPath}: ${error.message}`);
  }
}

async function writeSession(snapshot, decisions) {
  await mkdir(dirname(sessionPath), { recursive: true });
  const temporaryPath = `${sessionPath}.${process.pid}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(
      {
        version: VERSION,
        snapshot,
        decisions,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await rename(temporaryPath, sessionPath);
}

async function removeSession() {
  await rm(sessionPath, { force: true });
}

function clearCard() {
  if (process.stdout.isTTY) process.stdout.write("\u001b[2J\u001b[H");
}

function renderCard(card, index, total, decisionCount) {
  const line = "-".repeat(72);
  clearCard();
  console.log(line);
  console.log(`CARD ${index + 1} OF ${total}  |  DECIDED ${decisionCount}`);
  console.log(line);
  console.log(`${paint("TITLE", BOLD)}: ${card.title}`);
  console.log(`${paint("NAME", BOLD)}: ${card.name}`);
  console.log(`${paint("DESCRIPTION", BOLD)}: ${card.description}`);
  console.log(`${paint("ORIGIN", BOLD)}: ${card.source}`);
  console.log(`${paint("SOURCE TYPE", BOLD)}: ${card.sourceType}`);
  if (card.sourcePath) console.log(`${paint("SOURCE PATH", BOLD)}: ${card.sourcePath}`);
  console.log(line);
  console.log("LEFT / r = reject    RIGHT / a = approve    q = pause");
}

function nextScriptedAnswer() {
  return scriptedAnswers?.shift();
}

function normalizeDecision(value) {
  const answer = value.trim().toLowerCase();
  if (["a", "approve", "approved", "y", "yes", "right", "->"].includes(answer)) {
    return "approve";
  }
  if (["r", "reject", "rejected", "n", "no", "left", "<-"].includes(answer)) {
    return "reject";
  }
  if (["q", "quit", "pause", "\u0003"].includes(answer)) return "pause";
  return undefined;
}

async function chooseDecision() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const answer = nextScriptedAnswer();
    return answer ? normalizeDecision(answer) || "pause" : "pause";
  }

  if (typeof process.stdin.setRawMode !== "function") {
    const answer = await askLine("Decision [a/r/q]: ");
    return normalizeDecision(answer) || "pause";
  }

  process.stdin.resume();
  process.stdin.setRawMode(true);
  return new Promise((resolve) => {
    const finish = (decision) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
      resolve(decision);
    };
    const onData = (chunk) => {
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

async function askLine(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return nextScriptedAnswer() || "";
  }
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await reader.question(prompt);
  } finally {
    reader.close();
  }
}

function printSummary(cards, decisions) {
  const approved = cards.filter((card) => decisions[card.name] === "approve");
  const rejected = cards.filter((card) => decisions[card.name] === "reject");
  console.log("\nAUDIT SUMMARY");
  console.log(`Approved: ${approved.length}`);
  console.log(`Rejected: ${rejected.length}`);
  if (rejected.length > 0) {
    console.log("\nSkills to remove:");
    for (const card of rejected) console.log(`- ${card.name}`);
  }
  return { approved, rejected };
}

function removalCommand(names) {
  // Without -a, the skills CLI targets every configured agent.
  return ["npx", "skills", "remove", "-g", ...names, "-y"];
}

function displayCommand(command) {
  return command
    .map((part) => (part === "*" ? "'*'" : /[^A-Za-z0-9_./:-]/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

async function cleanup(rejected, snapshot) {
  const command = removalCommand(rejected.map((card) => card.name));
  console.log(`\nCleanup command: ${displayCommand(command)}`);
  const confirmation = await askLine("Type CLEANUP to remove rejected skills: ");
  if (confirmation.trim() !== "CLEANUP") {
    console.log("Cleanup skipped. Your decisions are saved; run again to resume.");
    return false;
  }

  const currentCards = await loadCards(await readLock());
  if (snapshotFor(currentCards) !== snapshot) {
    throw new Error(
      "The installed skills changed during the audit. No cleanup was run; restart with --reset.",
    );
  }

  const npx = process.env.SKILL_AUDITOR_NPX || "npx";
  const childEnvironment = {
    ...process.env,
    HOME: home,
  };
  const result = spawnSync(npx, command.slice(1), {
    env: childEnvironment,
    stdio: "inherit",
  });
  if (result.error) throw new Error(`Could not run ${npx}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${npx} skills remove exited with status ${result.status}`);
  }

  const remainingLock = await readLock();
  const remaining = rejected
    .map((card) => card.name)
    .filter((name) => Object.hasOwn(remainingLock.skills, name));
  if (remaining.length > 0) {
    throw new Error(
      `Cleanup did not remove these lock entries: ${remaining.join(", ")}`,
    );
  }

  await removeSession();
  console.log("Cleanup complete. Rejected skills and their global lock entries were removed.");
  return true;
}

async function main() {
  if (options.reset) await removeSession();

  const lock = await readLock();
  const cards = await loadCards(lock);
  if (cards.length === 0) {
    console.log(`No installed skills found in ${skillsDir}.`);
    return;
  }

  const snapshot = snapshotFor(cards);
  let session = await readSession();
  if (session && session.snapshot !== snapshot) {
    throw new Error(
      "The installed skills changed since the saved audit. Restart with --reset.",
    );
  }
  if (options.resume && !session) {
    console.log("No saved audit found. Starting a new audit.");
  }

  const decisions = session?.decisions || {};
  await writeSession(snapshot, decisions);

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    if (decisions[card.name]) continue;

    renderCard(card, index, cards.length, Object.keys(decisions).length);
    const decision = await chooseDecision();
    if (decision === "pause") {
      await writeSession(snapshot, decisions);
      console.log("Audit paused. Decisions are saved.");
      return;
    }
    decisions[card.name] = decision;
    await writeSession(snapshot, decisions);
    console.log(`${decision === "approve" ? "Approved" : "Rejected"}: ${card.name}`);
  }

  const { rejected } = printSummary(cards, decisions);
  if (rejected.length === 0) {
    await removeSession();
    console.log("Nothing to clean up. All skills were approved.");
    return;
  }
  if (options.dryRun) {
    console.log("Dry run only. No installed skill or lock entry was changed.");
    return;
  }
  await cleanup(rejected, snapshot);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
