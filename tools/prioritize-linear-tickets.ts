#!/usr/bin/env -S node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
// Standalone top-k ticket prioritizer. Presents two tickets at a time and
// records human comparisons; runs the pure core to binary-insert each
// candidate into a best -> worst frontier and trims to k.
//
// It is intentionally not a generic prioritization runtime: source parsing,
// the interactive loop, and state persistence live here; the selection
// algorithm lives in prioritize-core.ts (shared, dependency-free).

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findTopKOrNextComparison,
  pairKey,
  readCachedComparison,
  type ComparisonCache,
  type ComparisonResult,
  type Ticket,
} from "./prioritize-core.ts";
import {
  fetchAssignedNotCompleted,
  fetchProjectsIssues,
  markIssueCanceled,
  markIssueDone,
  resolveRankStorage,
  setPriority,
  writeRelativeRank,
} from "./linear-client.ts";
import {
  assignRankWeights,
  comparisonsFromRanks,
  mergeComparisonCaches,
  overlappingComparisons,
  projectSetLabel,
  sameProjectSet,
  stripRankComment,
  ticketRank,
} from "./linear-ranks.ts";
import { clearScreen, confirmExact, paint, rawChoice } from "./prompt.ts";

const STATE_VERSION = 2;
const BOLD = "\u001b[1m";

const DEFAULT_STATE_FILE = ".prioritize-state.json";
const DEFAULT_OUTPUT_FILE = "top-k.json";
const PRIORITY_LABELS: Record<number, string> = {
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

type Arguments = {
  input: string | undefined;
  top: number;
  state: string;
  output: string | undefined;
  priorityTarget: number;
  priorityExplicit: boolean;
  team: string | undefined;
  projects: string[];
  bin: boolean;
  rebin: boolean;
  dryRun: boolean;
  reset: boolean;
  help: boolean;
};

// Ordered most -> least important. Index doubles as the binary-search range.
// Triage targets the no-priority pool and bins into the 4 meaningful tiers.
const TRIAGE_BINS = [
  { p: 1, label: "Urgent" },
  { p: 2, label: "High" },
  { p: 3, label: "Medium" },
  { p: 4, label: "Low" },
] as const;

type InputTicket = {
  id?: string;
  identifier?: string;
  title?: string;
  name?: string;
  description?: string;
  state?: string | { name?: string };
  priority?: string | number | null;
  url?: string;
  [key: string]: unknown;
};

type ApplyingCheckpoint = {
  source: "linear";
  team: string | undefined;
  project?: string | undefined;
  projects?: string[];
  updates?: Record<string, number>;
  ranks?: Record<string, number>;
  rankSlot?: "field" | "comment";
  rankFieldId?: string;
  rankFieldName?: string;
};

type ReviewState = {
  version: number;
  mode: "top-k";
  snapshot: string;
  top: number;
  comparisons: ComparisonCache;
  applying?: ApplyingCheckpoint;
  updatedAt: string;
};

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }
  return undefined;
}

function parseArguments(args: string[]): Arguments {
  const options: Arguments = {
    input: undefined,
    top: 10,
    state: DEFAULT_STATE_FILE,
    output: undefined,
    priorityTarget: 2,
    priorityExplicit: false,
    team: undefined,
    projects: [],
    bin: false,
    rebin: false,
    dryRun: false,
    reset: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--reset") {
      options.reset = true;
      continue;
    }
    if (arg === "--input" || arg === "-i") {
      options.input = args[++index];
      if (options.input === undefined) throw new Error("--input needs a path or '-' for stdin");
      continue;
    }
    if (arg === "--top" || arg === "-k") {
      const value = args[++index];
      const parsed = Number(value);
      if (value === undefined || !Number.isInteger(parsed) || parsed < 1) {
        throw new Error("--top needs a positive integer");
      }
      options.top = parsed;
      continue;
    }
    if (arg === "--state") {
      options.state = args[++index];
      if (!options.state) throw new Error("--state needs a path");
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      options.output = args[++index];
      if (!options.output) throw new Error("--output needs a path");
      continue;
    }
    if (arg === "--priority" || arg === "-p") {
      const value = args[++index];
      const parsed = Number(value);
      if (value === undefined || !Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
        throw new Error("--priority needs an integer 1..4 (1=Urgent, 4=Low)");
      }
      options.priorityTarget = parsed;
      options.priorityExplicit = true;
      continue;
    }
    if (arg === "--team") {
      options.team = args[++index];
      if (!options.team) throw new Error("--team needs a team key");
      continue;
    }
    if (arg === "--project") {
      const value = args[++index];
      if (!value) throw new Error("--project needs a project name, UUID, or slug");
      options.projects.push(value);
      continue;
    }
    if (arg === "--bin") {
      options.bin = true;
      continue;
    }
    if (arg === "--rebin") {
      options.bin = true;
      options.rebin = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function printHelp(): void {
  console.log(`Usage: tools/prioritize-linear-tickets.ts -k <k> [options]
  (or: node --experimental-strip-types tools/prioritize-linear-tickets.ts ...)

Find the top k most important tickets assigned to you in Linear (or all open
project issues across all assignees when --project is given) using human pairwise
comparisons, without ranking everything. Repeat --project to rank more than one
project as one pile. Uses the installed \`linear\` CLI for auth.
Pass -i to rank a local JSON export instead.
Controls in a terminal:
  L or Left   the LEFT ticket is more important
  R or Right  the RIGHT ticket is more important
  T           the two tickets are equally important
  Q or Ctrl-C pause and save progress

Options:
  -k, --top <k>             top tickets to select; relative rank is written on APPLY
      --priority <1-4>      also write this Linear priority bucket on APPLY
                            (1=Urgent, 4=Low). Omitted: APPLY writes relative
                            ranks only, not Urgent/High/Medium/Low
      --team <key>          only rank issues in this team (e.g. NAT); default all
      --project <target>    rank all open issues in this project (any assignee,
                            any priority; name, UUID, or slug). Repeat to rank
                            several projects together
      --bin                 triage your no-priority tickets into Urgent/High/
                            Medium/Low by binary-searching the tiers
                            (~2 comparisons each); moves them out of no-priority
      --rebin               like --bin, but include tickets that already have a
                            priority so you can bucket the whole set again
      --dry-run             rank and show the plan but do NOT write to Linear
  -i, --input <path|->      instead of Linear, rank a local JSON file ('-' = stdin)
  -o, --output <path>       also write the resulting top-k JSON here
      --state <path>        resume/persist state file (default ${DEFAULT_STATE_FILE})
      --reset               discard saved comparisons and start again
  -h, --help                show this help

State file: ${DEFAULT_STATE_FILE}
`);
}

function compact(value: string, maxLength = 400): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 3).trimEnd()}...`;
}

function ticketField(ticket: Ticket, key: string): string {
  const value = ticket[key];
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function readSourceJSON(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  return parsed;
}

function normalizeTickets(data: unknown): InputTicket[] {
  if (Array.isArray(data)) return data as InputTicket[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.tickets)) return obj.tickets as InputTicket[];
    const issues = obj.data as { issues?: { nodes?: unknown[] } } | undefined;
    const nodes = issues?.issues?.nodes;
    if (Array.isArray(nodes)) return nodes as InputTicket[];
  }
  throw new Error(
    "Could not find a ticket list in the input. Expected an array, { tickets: [...] }, or a Linear issues query result.",
  );
}

function snapshotFor(tickets: Ticket[], top: number): string {
  const value = JSON.stringify({
    top,
    tickets: tickets.map((t) => ({
      id: t.id,
      title: t.title,
      description: ticketField(t, "description"),
    })),
  });
  return createHash("sha256").update(value).digest("hex");
}
async function readState(stateFile: string): Promise<ReviewState | undefined> {
  try {
    const content = await readFile(stateFile, "utf8");
    const state = JSON.parse(content) as ReviewState;
    if (
      state.version !== STATE_VERSION ||
      state.mode !== "top-k" ||
      typeof state.snapshot !== "string" ||
      typeof state.top !== "number" ||
      !state.comparisons ||
      typeof state.comparisons !== "object"
    ) {
      throw new Error(
        `the state file has an unsupported format; run again with --reset to discard ${stateFile}`,
      );
    }
    return state;
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return undefined;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${stateFile}: ${message}`);
  }
}
async function writeState(
  stateFile: string,
  snapshot: string,
  top: number,
  comparisons: ComparisonCache,
  applying?: ApplyingCheckpoint,
): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  const temporaryFile = `${stateFile}.${process.pid}.tmp`;
  const state: ReviewState = {
    version: STATE_VERSION,
    mode: "top-k",
    snapshot,
    top,
    comparisons,
    applying,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryFile, stateFile);
}

async function removeState(stateFile: string): Promise<void> {
  await rm(stateFile, { force: true });
}

function normalizeChoice(value: string): ComparisonResult | "pause" | undefined {
  const answer = value.trim().toLowerCase();
  if (["l", "left", "[d", "[b"].includes(answer)) return "left";
  if (["r", "right", "[c", "[f"].includes(answer)) return "right";
  if (["t", "tie", "equal"].includes(answer)) return "tie";
  if (["q", "quit", "pause", "ctrl-c"].includes(answer)) return "pause";
  return undefined;
}

async function chooseComparison(): Promise<ComparisonResult | "pause"> {
  const result = await rawChoice(
    "Which is more important? [L/R/T/q]: ",
    normalizeChoice,
  );
  return result as ComparisonResult | "pause";
}

function renderPair(
  left: Ticket,
  right: Ticket,
  decided: number,
  ticketsTotal: number,
  top: number,
  maxComparisons: number,
  candidateIndex?: number,
): void {
  clearScreen();
  const line = "-".repeat(72);
  const remaining = Math.max(0, maxComparisons - decided);
  const percent = candidateIndex !== undefined && ticketsTotal > 0
    ? Math.round((candidateIndex / ticketsTotal) * 100)
    : 0;
  const progress = candidateIndex !== undefined
    ? `[Ticket ${candidateIndex} of ${ticketsTotal} (${percent}%)]  |  `
    : "";
  console.log(
    `TOP-K  |  ${progress}${paint("L", BOLD)} LEFT vs ${paint("R", BOLD)} RIGHT  |  TOP ${top} of ${ticketsTotal} tickets  |  ${decided} compared, ~${remaining} left (worst-case)`,
  );
  console.log(line);
  console.log(`${paint("LEFT (L) - candidate", BOLD)}`);
  console.log(`${paint("TITLE", BOLD)}: ${left.title}`);
  console.log(`${paint("ID", BOLD)}: ${left.id}`);
  const leftDescription = compact(stripRankComment(ticketField(left, "description")));
  if (leftDescription) console.log(`${paint("DESCRIPTION", BOLD)}: ${leftDescription}`);
  console.log(line);
  console.log(`${paint("RIGHT (R) - in top list", BOLD)}`);
  console.log(`${paint("TITLE", BOLD)}: ${right.title}`);
  console.log(`${paint("ID", BOLD)}: ${right.id}`);
  const rightDescription = compact(stripRankComment(ticketField(right, "description")));
  if (rightDescription) console.log(`${paint("DESCRIPTION", BOLD)}: ${rightDescription}`);
  console.log(line);
  console.log("[L] Left  [R] Right  [T] Tie  [Q] Pause/Quit");
}

function renderFinal(
  ranked: Ticket[],
  comparisonCount: number,
  top: number,
): void {
  console.log(`\nTOP ${Math.min(top, ranked.length)} SELECTED - ${ranked.length} ticket${ranked.length === 1 ? "" : "s"} - ${comparisonCount} comparison${comparisonCount === 1 ? "" : "s"} used`);
  for (let index = 0; index < ranked.length; index += 1) {
    console.log(`${paint(String(index + 1), BOLD)}. ${ranked[index].title}  [${ranked[index].id}]`);
  }
}

function writeComparisonValue(
  cache: ComparisonCache,
  key: string,
  leftId: string,
  rightId: string,
  chosen: ComparisonResult,
): ComparisonCache {
  // Store in canonical orientation: id-smaller ticket is the "left" side.
  let canonical: ComparisonResult;
  if (leftId < rightId) {
    canonical = chosen;
  } else {
    canonical = chosen === "left" ? "right" : chosen === "right" ? "left" : "tie";
  }
  return { ...cache, [key]: canonical };
}

async function readStreamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
  stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  stream.on("error", reject);
  stream.resume();
  return promise;
}

async function loadTickets(inputPath: string): Promise<Ticket[]> {
  const raw =
    inputPath === "-" ? await readStreamToString(process.stdin) : await readFile(inputPath, "utf8");
  const data = readSourceJSON(raw);
  const sources = normalizeTickets(data);
  if (sources.length === 0) {
    throw new Error("The input contains no tickets.");
  }
  const tickets: Ticket[] = [];
  for (const source of sources) {
    const id =
      (source.id !== undefined && String(source.id)) ||
      (source.identifier !== undefined && String(source.identifier));
    if (!id || !id.trim()) {
      throw new Error("Every ticket needs a stable id or identifier.");
    }
    const rawTitle = source.title ?? source.name ?? "Untitled ticket";
    const title = typeof rawTitle === "string" ? rawTitle : String(rawTitle);
    const description = typeof source.description === "string" ? source.description : "";
    const relativeRank = ticketRank({ id, title, description, ...source });
    tickets.push({
      id,
      title,
      description,
      ...(relativeRank !== undefined ? { relativeRank } : {}),
      ...(source.state !== undefined ? { state: source.state } : {}),
      ...(source.priority !== undefined ? { priority: source.priority } : {}),
      ...(source.url ? { url: String(source.url) } : {}),
    });
  }
  return tickets;
}

type BinState = {
  version: number;
  mode: "bin";
  snapshot: string;
  tiers: Record<string, number | undefined>;
  canceled?: string[];
  done?: string[];
  pendingCanceled?: string[];
  pendingDone?: string[];
  applying?: ApplyingCheckpoint;
  updatedAt: string;
};

const BIN_STATE_VERSION = 2;

async function readsBinState(stateFile: string): Promise<BinState | undefined> {
  try {
    const content = await readFile(stateFile, "utf8");
    const state = JSON.parse(content) as BinState;
    if (
      state.version !== BIN_STATE_VERSION ||
      state.mode !== "bin" ||
      typeof state.snapshot !== "string" ||
      !state.tiers ||
      typeof state.tiers !== "object"
    ) {
      throw new Error(
        `the state file has an unsupported format; run again with --reset to discard ${stateFile}`,
      );
    }
    return state;
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return undefined;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${stateFile}: ${message}`);
  }
}

async function writeBinState(
  stateFile: string,
  snapshot: string,
  tiers: Record<string, number | undefined>,
  applying?: ApplyingCheckpoint,
  canceled?: string[],
  done?: string[],
  pendingCanceled?: string[],
  pendingDone?: string[],
): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  const temporaryFile = `${stateFile}.${process.pid}.tmp`;
  const state: BinState = {
    version: BIN_STATE_VERSION,
    mode: "bin",
    snapshot,
    tiers,
    canceled,
    done,
    pendingCanceled,
    pendingDone,
    applying,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryFile, stateFile);
}

function checkpointProjects(applying: ApplyingCheckpoint): string[] {
  if (applying.projects && applying.projects.length > 0) return applying.projects;
  if (applying.project) return [applying.project];
  return [];
}

function applyingSourceMismatch(
  applying: ApplyingCheckpoint,
  usingLinear: boolean,
  team: string | undefined,
  projects: string[],
): string | undefined {
  if (!usingLinear || applying.source !== "linear") {
    return "the saved application checkpoint was created from Linear; rerun against Linear or use --reset";
  }
  if ((applying.team ?? undefined) !== (team ?? undefined)) {
    return `the saved application checkpoint used team ${applying.team ?? "all teams"} but this run uses ${team ?? "all teams"}; rerun with the same team or use --reset`;
  }
  const savedProjects = checkpointProjects(applying);
  if (!sameProjectSet(savedProjects, projects)) {
    return `the saved application checkpoint used project ${projectSetLabel(savedProjects)} but this run uses ${projectSetLabel(projects)}; rerun with the same project or use --reset`;
  }
  return undefined;
}

function checkpointIdsMissing(
  applying: ApplyingCheckpoint,
  tickets: Ticket[],
): string[] {
  const known = new Set(tickets.map((ticket) => ticket.id));
  return [
    ...Object.keys(applying.updates ?? {}),
    ...Object.keys(applying.ranks ?? {}),
  ].filter((id, index, all) => all.indexOf(id) === index && !known.has(id));
}

function currentPriorityMap(tickets: Ticket[]): Map<string, number | undefined> {
  return new Map(
    tickets.map((ticket) => [
      ticket.id,
      ticket.priority === undefined || ticket.priority === null
        ? undefined
        : Number(ticket.priority),
    ]),
  );
}

function rankStorageFromCheckpoint(applying: ApplyingCheckpoint) {
  if (applying.rankSlot === "field" && applying.rankFieldId) {
    return {
      kind: "field" as const,
      field: { id: applying.rankFieldId, name: applying.rankFieldName ?? "Relative Rank" },
    };
  }
  return { kind: "comment" as const };
}

async function applyCheckpoint(
  stateFile: string,
  applying: ApplyingCheckpoint,
  tickets: Ticket[],
  persist: (applying: ApplyingCheckpoint) => Promise<void>,
): Promise<void> {
  const remainingRanks: Record<string, number> = { ...(applying.ranks ?? {}) };
  const remainingUpdates: Record<string, number> = { ...(applying.updates ?? {}) };
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const storage = rankStorageFromCheckpoint(applying);

  for (const [id, weight] of Object.entries(applying.ranks ?? {})) {
    const ticket = byId.get(id);
    if (ticket && ticketRank(ticket) === weight) {
      delete remainingRanks[id];
      await persist({ ...applying, ranks: remainingRanks, updates: remainingUpdates });
      console.log(`${id} already has relative rank ${weight}; skipping.`);
      continue;
    }
    try {
      const written = await writeRelativeRank({
        issueId: id,
        weight,
        storage,
        currentDescription: typeof ticket?.description === "string" ? ticket.description : "",
      });
      if (ticket) {
        ticket.description = written.description ?? ticket.description;
        ticket.relativeRank = written.relativeRank;
      }
    } catch (error) {
      await persist({ ...applying, ranks: remainingRanks, updates: remainingUpdates });
      throw error;
    }
    delete remainingRanks[id];
    await persist({ ...applying, ranks: remainingRanks, updates: remainingUpdates });
    console.log(`Remembered ${id} relative rank ${weight}`);
  }

  const currentPriorities = currentPriorityMap(tickets);
  for (const [id, target] of Object.entries(applying.updates ?? {})) {
    if (currentPriorities.get(id) === target) {
      delete remainingUpdates[id];
      await persist({ ...applying, ranks: remainingRanks, updates: remainingUpdates });
      console.log(`${id} is already at priority ${target}; skipping.`);
      continue;
    }
    try {
      await setPriority(id, target);
    } catch (error) {
      await persist({ ...applying, ranks: remainingRanks, updates: remainingUpdates });
      throw error;
    }
    delete remainingUpdates[id];
    await persist({ ...applying, ranks: remainingRanks, updates: remainingUpdates });
    console.log(`Updated ${id} -> ${PRIORITY_LABELS[target] ?? target}`);
  }
  await removeState(stateFile);
  const rankCount = Object.keys(applying.ranks ?? {}).length;
  const planned = Object.keys(applying.updates ?? {}).length;
  const parts: string[] = [];
  if (rankCount > 0) parts.push(`${rankCount} relative rank(s) saved`);
  if (planned > 0) parts.push(`${planned} ticket(s) set to their planned priority`);
  console.log(`Done. ${parts.join("; ") || "nothing to write"}.`);
}

export type TriageChoice = "yes" | "no" | "delete" | "done" | "pause";

export function normalizeTriageChoice(value: string): TriageChoice | undefined {
  const answer = value.trim().toLowerCase();
  if (["y", "yes", "right", "j"].includes(answer)) return "yes";
  if (["n", "no", "left", "k"].includes(answer)) return "no";
  if (["d", "del", "delete", "cancel"].includes(answer)) return "delete";
  if (["c", "done", "complete", "x"].includes(answer)) return "done";
  if (["q", "quit", "pause", "ctrl-c"].includes(answer)) return "pause";
  return undefined;
}

export async function chooseTriageChoice(prompt: string): Promise<TriageChoice> {
  const result = await rawChoice(prompt, normalizeTriageChoice);
  if (result === undefined) return "pause";
  return result as TriageChoice;
}

export function formatProgress(index: number, total: number): string {
  const percent = total > 0 ? Math.round(((index + 1) / total) * 100) : 100;
  return `[Ticket ${index + 1} of ${total} (${percent}%)]`;
}

export function renderBinCard(
  ticket: Ticket,
  index: number,
  total: number,
  tierLabel?: string,
): void {
  clearScreen();
  const line = "-".repeat(72);
  const progress = formatProgress(index, total);
  const tierQuestion = tierLabel
    ? `  |  Is this ticket at least ${paint(tierLabel, BOLD)} priority?`
    : "";
  console.log(`TRIAGE  |  ${progress}${tierQuestion}`);
  console.log(line);
  console.log(`${paint("TITLE", BOLD)}: ${ticket.title}`);
  console.log(`${paint("ID", BOLD)}: ${ticket.id}`);
  const state = compact(ticketField(ticket, "state"));
  if (state) console.log(`${paint("STATE", BOLD)}: ${state}`);
  const description = compact(stripRankComment(ticketField(ticket, "description")));
  if (description) console.log(`${paint("DESCRIPTION", BOLD)}: ${description}`);
  console.log(line);
  console.log("[Y] Yes  [N] No  [D] Delete/Cancel  [C] Mark Done  [Q] Pause/Quit");
}

export type BinTicketResult =
  | { action: "binned"; index: number; p: number | undefined; label: string }
  | { action: "delete"; index: -2; p: undefined; label: "deleted" }
  | { action: "done"; index: -3; p: undefined; label: "done" }
  | { action: "pause"; index: -1; p: undefined; label: "paused" };

/**
 * Binary-search a ticket into one of the 4 priority tiers by asking whether it
 * is at least as important as the midpoint tier. Cost ~ceil(log2(4)) = 2
 * comparisons per ticket.
 */
export async function binForTicket(
  ticket: Ticket,
  index = 0,
  total = 1,
): Promise<BinTicketResult> {
  let lo = 0;
  let hi = TRIAGE_BINS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    renderBinCard(ticket, index, total, TRIAGE_BINS[mid].label);
    const answer = await chooseTriageChoice("Choice [Y/N/D/C/Q]: ");
    if (answer === "pause") return { action: "pause", index: -1, p: undefined, label: "paused" };
    if (answer === "delete") return { action: "delete", index: -2, p: undefined, label: "deleted" };
    if (answer === "done") return { action: "done", index: -3, p: undefined, label: "done" };
    if (answer === "yes") {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  const bin = TRIAGE_BINS[lo];
  return { action: "binned", index: lo, p: bin.p, label: bin.label };
}

async function runBin(args: Arguments): Promise<void> {
  const stateFile = args.state;
  const usingLinear = args.input === undefined;
  const rawTickets = usingLinear
    ? (args.projects.length > 0
        ? await fetchProjectsIssues({ projects: args.projects, team: args.team })
        : await fetchAssignedNotCompleted({ team: args.team }))
    : await loadTickets(args.input);
  // --bin: only tickets with no priority. --rebin: every fetched ticket,
  // including ones already in Urgent/High/Medium/Low.
  const tickets = args.rebin
    ? rawTickets
    : rawTickets.filter(
        (t) => t.priority === undefined || t.priority === null || Number(t.priority) === 0,
      );
  if (args.reset) await removeState(stateFile);

  let snapshot = snapshotFor(tickets, args.top);
  const saved = await readsBinState(stateFile);
  if (saved?.applying) {
    const mismatch = applyingSourceMismatch(saved.applying, usingLinear, args.team, args.projects);
    if (mismatch) throw new Error(mismatch);
    const missing = checkpointIdsMissing(saved.applying, rawTickets);
    if (missing.length > 0) {
      throw new Error(
        `the saved application checkpoint references tickets no longer present: ${missing.join(", ")}. Inspect Linear, then run --reset.`,
      );
    }
    console.log("Resuming an interrupted Linear write.");
    await applyCheckpoint(stateFile, saved.applying, rawTickets, (applying) =>
      writeBinState(
        stateFile,
        snapshot,
        saved.tiers,
        applying,
        saved.canceled,
        saved.done,
        saved.pendingCanceled,
        saved.pendingDone,
      ),
    );
    return;
  }

  const canceled = new Set<string>(saved?.canceled ?? []);
  const done = new Set<string>(saved?.done ?? []);
  const pendingCanceled = new Set<string>(saved?.pendingCanceled ?? []);
  const pendingDone = new Set<string>(saved?.pendingDone ?? []);
  const tiers: Record<string, number | undefined> = {};

  if (saved) {
    const currentTicketIds = new Set(tickets.map((t) => t.id));
    for (const [id, tier] of Object.entries(saved.tiers)) {
      if (currentTicketIds.has(id)) {
        tiers[id] = tier;
      }
    }
    if (saved.snapshot !== snapshot) {
      console.log("Ticket list changed since last time; overlapping tiers are kept.");
    }
  }

  if (usingLinear && !args.dryRun) {
    if (pendingCanceled.size > 0 || pendingDone.size > 0) {
      console.log("Applying pending triage actions from saved dry-run session...");
      for (const id of pendingCanceled) {
        await markIssueCanceled(id);
        canceled.add(id);
        console.log(`Ticket ${id} marked canceled in Linear.`);
      }
      pendingCanceled.clear();
      for (const id of pendingDone) {
        await markIssueDone(id);
        done.add(id);
        console.log(`Ticket ${id} marked Done in Linear.`);
      }
      pendingDone.clear();
    }
  }

  // Update working snapshot for remaining tickets
  const remainingTickets = tickets.filter(
    (t) =>
      !canceled.has(t.id) &&
      !done.has(t.id) &&
      !pendingCanceled.has(t.id) &&
      !pendingDone.has(t.id),
  );
  snapshot = snapshotFor(remainingTickets, args.top);

  const filterParts: string[] = [];
  if (args.team) filterParts.push(`team ${args.team}`);
  if (args.projects.length > 0) filterParts.push(`project ${projectSetLabel(args.projects)}`);
  const sourceLabel = usingLinear
    ? `Linear (${filterParts.length > 0 ? filterParts.join(", ") : "all teams"})`
    : `file ${args.input}`;
  console.log(
    `${args.rebin ? "Re-binning" : "Binning"} ${tickets.length} ticket(s). Source: ${sourceLabel}.`,
  );
  if (saved) console.log(`Resuming (${Object.keys(tiers).length} binned).`);
  await writeBinState(
    stateFile,
    snapshot,
    tiers,
    undefined,
    [...canceled],
    [...done],
    [...pendingCanceled],
    [...pendingDone],
  );

  let triaged = 0;
  for (let index = 0; index < tickets.length; index += 1) {
    const ticket = tickets[index];
    if (
      tiers[ticket.id] !== undefined ||
      canceled.has(ticket.id) ||
      done.has(ticket.id) ||
      pendingCanceled.has(ticket.id) ||
      pendingDone.has(ticket.id)
    ) {
      continue;
    }
    const result = await binForTicket(ticket, index, tickets.length);
    if (result.action === "pause") {
      await writeBinState(
        stateFile,
        snapshot,
        tiers,
        undefined,
        [...canceled],
        [...done],
        [...pendingCanceled],
        [...pendingDone],
      );
      console.log("Paused. Progress is saved; rerun to resume.");
      return;
    }
    if (result.action === "delete") {
      delete tiers[ticket.id];
      if (usingLinear && !args.dryRun) {
        await markIssueCanceled(ticket.id);
        canceled.add(ticket.id);
        console.log(`Ticket ${ticket.id} deleted/canceled.`);
      } else {
        pendingCanceled.add(ticket.id);
        if (args.dryRun) {
          console.log(`[dry-run] Would mark ticket ${ticket.id} canceled in Linear.`);
        } else {
          console.log(`Ticket ${ticket.id} deleted/canceled from triage.`);
        }
      }
      const remaining = tickets.filter(
        (t) =>
          !canceled.has(t.id) &&
          !done.has(t.id) &&
          !pendingCanceled.has(t.id) &&
          !pendingDone.has(t.id),
      );
      snapshot = snapshotFor(remaining, args.top);
      await writeBinState(
        stateFile,
        snapshot,
        tiers,
        undefined,
        [...canceled],
        [...done],
        [...pendingCanceled],
        [...pendingDone],
      );
      continue;
    }
    if (result.action === "done") {
      delete tiers[ticket.id];
      if (usingLinear && !args.dryRun) {
        await markIssueDone(ticket.id);
        done.add(ticket.id);
        console.log(`Ticket ${ticket.id} marked Done.`);
      } else {
        pendingDone.add(ticket.id);
        if (args.dryRun) {
          console.log(`[dry-run] Would mark ticket ${ticket.id} Done in Linear.`);
        } else {
          console.log(`Ticket ${ticket.id} marked Done from triage.`);
        }
      }
      const remaining = tickets.filter(
        (t) =>
          !canceled.has(t.id) &&
          !done.has(t.id) &&
          !pendingCanceled.has(t.id) &&
          !pendingDone.has(t.id),
      );
      snapshot = snapshotFor(remaining, args.top);
      await writeBinState(
        stateFile,
        snapshot,
        tiers,
        undefined,
        [...canceled],
        [...done],
        [...pendingCanceled],
        [...pendingDone],
      );
      continue;
    }
    triaged += 1;
    tiers[ticket.id] = result.index;
    await writeBinState(
      stateFile,
      snapshot,
      tiers,
      undefined,
      [...canceled],
      [...done],
      [...pendingCanceled],
      [...pendingDone],
    );
  }

  const activeTickets = tickets.filter(
    (t) =>
      !canceled.has(t.id) &&
      !done.has(t.id) &&
      !pendingCanceled.has(t.id) &&
      !pendingDone.has(t.id),
  );

  // Group by bin for the plan.
  const byTier = new Map<number | undefined, Ticket[]>();
  for (const ticket of activeTickets) {
    const index = tiers[ticket.id];
    const key = index === undefined ? undefined : TRIAGE_BINS[index]?.p;
    const list = byTier.get(key) ?? [];
    list.push(ticket);
    byTier.set(key, list);
  }

  console.log("\n--- Completed ---");
  for (const [p, group] of byTier.entries()) {
    const label = p === undefined ? "unchanged" : (PRIORITY_LABELS[p] ?? `priority ${p}`);
    console.log(`\n${label} (${group.length}):`);
    for (const t of group) console.log(`- ${t.id}  ${t.title}`);
  }
  if (done.size > 0) {
    console.log(`\nMarked Done (${done.size}):`);
    for (const id of done) console.log(`- ${id}`);
  }
  if (pendingDone.size > 0) {
    console.log(`\nPending Mark Done (${pendingDone.size}):`);
    for (const id of pendingDone) console.log(`- ${id}`);
  }
  if (canceled.size > 0) {
    console.log(`\nDeleted/Canceled (${canceled.size}):`);
    for (const id of canceled) console.log(`- ${id}`);
  }
  if (pendingCanceled.size > 0) {
    console.log(`\nPending Delete/Cancel (${pendingCanceled.size}):`);
    for (const id of pendingCanceled) console.log(`- ${id}`);
  }
  console.log(`\n${triaged} ticket(s) triaged into a priority tier.`);

  if (!usingLinear) {
    if (args.output) {
      await mkdir(dirname(args.output), { recursive: true });
      await writeFile(
        args.output,
        `${JSON.stringify(
          {
            tickets: activeTickets.map((ticket) => ({
              ...ticket,
              priority:
                tiers[ticket.id] === undefined
                  ? ticket.priority
                  : TRIAGE_BINS[tiers[ticket.id]!]?.p,
            })),
            canceled: [...canceled, ...pendingCanceled],
            done: [...done, ...pendingDone],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
    return;
  }

  if (args.dryRun) {
    console.log("\nDry run only. No Linear changes made.");
    return;
  }

  // Write the meaningful tiers (1..4). No-priority (0) is left as-is.
  const toWrite = activeTickets.filter((t) => {
    const p = tiers[t.id] === undefined ? undefined : TRIAGE_BINS[tiers[t.id]!]?.p;
    return p !== undefined && p >= 1 && p <= 4;
  });
  if (toWrite.length === 0) {
    console.log("Nothing to update (no tickets in an explicit tier).");
    await removeState(stateFile);
    return;
  }
  console.log(`\nPlan: set ${toWrite.length} ticket(s) to their binned priority.`);
  for (const t of toWrite) {
    const p = TRIAGE_BINS[tiers[t.id]!]!.p;
    console.log(`- ${t.id} -> ${PRIORITY_LABELS[p] ?? p} (${t.title})`);
  }
  if (!(await confirmExact("Type APPLY to write binned priorities to Linear: ", "APPLY"))) {
    console.log("Skipped. Saved state remains; rerun to resume.");
    return;
  }
  const updates: Record<string, number> = {};
  for (const t of toWrite) {
    updates[t.id] = TRIAGE_BINS[tiers[t.id]!]!.p;
  }
  const applying: ApplyingCheckpoint = {
    source: "linear",
    team: args.team,
    project: args.projects.length === 1 ? args.projects[0] : undefined,
    projects: args.projects.length > 0 ? args.projects : undefined,
    updates,
  };
  await writeBinState(
    stateFile,
    snapshot,
    tiers,
    applying,
    [...canceled],
    [...done],
    [...pendingCanceled],
    [...pendingDone],
  );
  await applyCheckpoint(stateFile, applying, rawTickets, (applying) =>
    writeBinState(
      stateFile,
      snapshot,
      tiers,
      applying,
      [...canceled],
      [...done],
      [...pendingCanceled],
      [...pendingDone],
    ),
  );
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.bin) {
    await runBin(args);
    return;
  }

  const stateFile = args.state;
  const usingLinear = args.input === undefined;

  let tickets = usingLinear
    ? (args.projects.length > 0
        ? await fetchProjectsIssues({ projects: args.projects, team: args.team })
        : await fetchAssignedNotCompleted({ team: args.team }))
    : await loadTickets(args.input);
  if (usingLinear && args.projects.length === 0) {
    // Assigned-to-me ranking only: existing Urgent tickets already occupy
    // "do now". --project ranking includes every open issue at any priority.
    const excludedUrgent = tickets.filter((t) => String(t.priority) === "1");
    if (excludedUrgent.length > 0) {
      console.log(
        `Skipping ${excludedUrgent.length} already-Urgent ticket(s): ${excludedUrgent.map((t) => t.id).join(", ")}`,
      );
    }
    tickets = tickets.filter((t) => String(t.priority) !== "1");
  }
  if (args.reset) await removeState(stateFile);

  const snapshot = snapshotFor(tickets, args.top);
  const saved = await readState(stateFile);
  if (saved?.applying) {
    const mismatch = applyingSourceMismatch(saved.applying, usingLinear, args.team, args.projects);
    if (mismatch) throw new Error(mismatch);
    const missing = checkpointIdsMissing(saved.applying, tickets);
    if (missing.length > 0) {
      throw new Error(
        `the saved application checkpoint references tickets no longer present: ${missing.join(", ")}. Inspect Linear, then run --reset.`,
      );
    }
    console.log("Resuming an interrupted priority application.");
    await applyCheckpoint(stateFile, saved.applying, tickets, (applying) =>
      writeState(stateFile, saved.snapshot, saved.top, saved.comparisons, applying),
    );
    return;
  }
  if (saved && saved.snapshot !== snapshot) {
    console.log("Ticket list changed since last time; overlapping comparisons are kept.");
  }

  const localComparisons = overlappingComparisons(
    saved?.comparisons ?? {},
    tickets.map((ticket) => ticket.id),
  );
  const fromLinear = args.reset ? {} : comparisonsFromRanks(tickets);
  let comparisons: ComparisonCache = mergeComparisonCaches(fromLinear, localComparisons);
  const filterParts: string[] = [];
  if (args.team) filterParts.push(`team ${args.team}`);
  if (args.projects.length > 0) filterParts.push(`project ${projectSetLabel(args.projects)}`);
  const sourceLabel = usingLinear
    ? `Linear (${filterParts.length > 0 ? filterParts.join(", ") : "all teams"})`
    : `file ${args.input}`;
  console.log(`Prioritizing ${tickets.length} tickets, top ${args.top}. Source: ${sourceLabel}.`);
  if (saved || Object.keys(fromLinear).length > 0) {
    console.log(
      `Continuing (${Object.keys(localComparisons).length} saved comparison(s), ${Object.keys(fromLinear).length} from remembered ranks).`,
    );
  }

  // Prime the state file so a paused session is findable.
  await writeState(stateFile, snapshot, args.top, comparisons);

  let decided = 0;
  let ranked: Ticket[] | undefined;
  // Bottom-up probing worst case: a candidate can be quizzed against every
  // slot in the frontier (rejects typically cost 1). Upper bound ~ n * k.
  const maxComparisons = tickets.length * args.top;

  // Iterative driver: ask exactly one comparison per pass, then rerun the core.
  for (let guard = 0; guard <= tickets.length * tickets.length; guard += 1) {
    const result = findTopKOrNextComparison(tickets, args.top, comparisons);
    if (result.complete) {
      ranked = result.ranked;
      break;
    }

    const { left, right, key } = result.comparison;
    const prior = readCachedComparison(comparisons, left, right);
    if (prior !== undefined) {
      throw new Error(`Internal error: core requested a cached comparison (${key}).`);
    }

    const candidateIndex = tickets.indexOf(left) + 1;
    renderPair(
      left,
      right,
      decided,
      tickets.length,
      args.top,
      maxComparisons,
      candidateIndex,
    );
    const choice = await chooseComparison();
    if (choice === "pause") {
      await writeState(stateFile, snapshot, args.top, comparisons);
      console.log("Paused. Comparisons are saved; rerun to resume.");
      return;
    }
    comparisons = writeComparisonValue(
      comparisons,
      key,
      left.id,
      right.id,
      choice,
    );
    decided += 1;
    await writeState(stateFile, snapshot, args.top, comparisons);
    console.log(`${left.id} vs ${right.id}: ${choice}`);
  }

  if (ranked === undefined) {
    throw new Error("Could not reach a top-k result; the comparison loop did not terminate.");
  }

  // Ensure newline after the last comparison log line before the final render.
  console.log("");
  renderFinal(ranked, decided, args.top);

  if (!usingLinear) {
    if (!args.output) return;
    const resultPayload = {
      top: args.top,
      selected: ranked.map((ticket, index) => ({
        rank: index + 1,
        id: ticket.id,
        title: ticket.title,
      })),
      comparisonCount: decided,
      input: args.input,
    };
    await writeFile(args.output, `${JSON.stringify(resultPayload, null, 2)}\n`, "utf8");
    console.log(`\nWrote ${args.output}`);
    return;
  }

  if (args.output) {
    const resultPayload = {
      top: args.top,
      selected: ranked.map((ticket, index) => ({
        rank: index + 1,
        id: ticket.id,
        title: ticket.title,
      })),
      comparisonCount: decided,
      input: "linear",
    };
    await writeFile(args.output, `${JSON.stringify(resultPayload, null, 2)}\n`, "utf8");
    console.log(`\nWrote ${args.output}`);
  }

  const hasJudgment = decided > 0 || Object.keys(comparisons).length > 0;
  const ranks = hasJudgment ? assignRankWeights(ranked, tickets) : {};
  if (args.dryRun) {
    if (hasJudgment) {
      console.log(`\nDry run: would remember ${Object.keys(ranks).length} relative rank(s) on Linear.`);
    }
    if (args.priorityExplicit) {
      const priorityLabel = PRIORITY_LABELS[args.priorityTarget] ?? String(args.priorityTarget);
      console.log(
        `Dry run: would also set ${ranked.length} ticket(s) to priority ${priorityLabel} (${args.priorityTarget}).`,
      );
    } else {
      console.log("Dry run only. No Linear issues were updated.");
    }
    return;
  }

  if (!hasJudgment && !args.priorityExplicit) {
    console.log("\nNothing to write to Linear (no comparisons and no priority requested).");
    return;
  }

  if (hasJudgment) {
    console.log(`\nPlan: remember relative rank for ${Object.keys(ranks).length} ticket(s) on Linear.`);
    for (const ticket of ranked) {
      console.log(`- ${ticket.id}  ${ticket.title}  rank ${ranks[ticket.id]}`);
    }
  }
  if (args.priorityExplicit) {
    const priorityLabel = PRIORITY_LABELS[args.priorityTarget] ?? String(args.priorityTarget);
    console.log(
      `Also set ${ranked.length} ticket(s) to priority ${priorityLabel} (${args.priorityTarget}).`,
    );
  } else {
    console.log("Relative rank stays separate from Urgent/High/Medium/Low.");
  }

  const confirm = args.priorityExplicit
    ? "Type APPLY to write relative ranks and Linear priority: "
    : "Type APPLY to write relative ranks to Linear: ";
  if (!(await confirmExact(confirm, "APPLY"))) {
    console.log("Skipped. Saved state remains; rerun to resume from your comparisons.");
    return;
  }

  const storage = await resolveRankStorage();
  const updates: Record<string, number> = {};
  if (args.priorityExplicit) {
    for (const ticket of ranked) {
      updates[ticket.id] = args.priorityTarget;
    }
  }
  const applying: ApplyingCheckpoint = {
    source: "linear",
    team: args.team,
    project: args.projects.length === 1 ? args.projects[0] : undefined,
    projects: args.projects.length > 0 ? args.projects : undefined,
    ranks: hasJudgment ? ranks : undefined,
    updates: args.priorityExplicit ? updates : undefined,
    rankSlot: storage.kind,
    rankFieldId: storage.kind === "field" ? storage.field.id : undefined,
    rankFieldName: storage.kind === "field" ? storage.field.name : undefined,
  };
  await writeState(stateFile, snapshot, args.top, comparisons, applying);
  await applyCheckpoint(stateFile, applying, tickets, (applying) =>
    writeState(stateFile, snapshot, args.top, comparisons, applying),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nPrioritization stopped: ${message}`);
    process.exitCode = 1;
  });
}