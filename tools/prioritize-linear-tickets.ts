#!/usr/bin/env -S node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
// Standalone top-k ticket prioritizer. Presents two tickets at a time and
// records human comparisons; runs the pure core to binary-insert each
// candidate into a best -> worst frontier and trims to k.
//
// It is intentionally not a generic prioritization runtime: source parsing,
// the interactive loop, and state persistence live here; the selection
// algorithm lives in prioritize-core.ts (shared, dependency-free).

import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  findTopKOrNextComparison,
  pairKey,
  readCachedComparison,
  type ComparisonCache,
  type ComparisonResult,
  type Ticket,
} from "./prioritize-core.ts";

const STATE_VERSION = 1;
const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const useColor = Boolean(
  process.stdout.isTTY && process.env.NO_COLOR === undefined,
);

const DEFAULT_STATE_FILE = ".prioritize-state.json";
const DEFAULT_OUTPUT_FILE = "top-k.json";

type Arguments = {
  input: string | undefined;
  top: number;
  state: string;
  output: string | undefined;
  reset: boolean;
  help: boolean;
};

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

type ReviewState = {
  version: number;
  snapshot: string;
  top: number;
  // Paired outcome cache, canonical pair-key -> "left"|"right"|"tie",
  // stored in canonical orientation (id-smaller ticket is the "left" side).
  comparisons: ComparisonCache;
  updatedAt: string;
};

function paint(value: string, color: string): string {
  return useColor ? `${color}${value}${RESET}` : value;
}

function clearScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write("\u001b[2J\u001b[3J\u001b[H");
  }
}

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
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.help && !options.input) {
    throw new Error("Missing required option: --input <path|->");
  }
  return options;
}

function printHelp(): void {
  console.log(`Usage: tools/prioritize-linear-tickets.ts --input <path|-> --top <k> [options]
  (or: node --experimental-strip-types tools/prioritize-linear-tickets.ts ...)

Find the top k most important tickets from exported Linear (or generic)
JSON using human pairwise comparisons, without ranking everything.

Controls in a terminal:
  L or Left   the LEFT ticket is more important
  R or Right  the RIGHT ticket is more important
  T           the two tickets are equally important
  Q or Ctrl-C pause and save progress

Options:
  -i, --input <path|->   JSON file to read, or '-' for stdin
  -k, --top <k>          number of top tickets to select (default 10)
  --state <path>         resume/persist state file (default .prioritize-state.json)
  -o, --output <path>    write the resulting top-k JSON here on completion
  --reset                discard saved comparisons and start again
  -h, --help             show this help

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
      typeof state.snapshot !== "string" ||
      typeof state.top !== "number" ||
      !state.comparisons ||
      typeof state.comparisons !== "object"
    ) {
      throw new Error("the state file has an unsupported format");
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
): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  const temporaryFile = `${stateFile}.${process.pid}.tmp`;
  const state: ReviewState = {
    version: STATE_VERSION,
    snapshot,
    top,
    comparisons,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryFile, stateFile);
}

async function removeState(stateFile: string): Promise<void> {
  await rm(stateFile, { force: true });
}

// Scripted (non-TTY) answers for tests and piping. Read lazily from the stdin
// stream so a human run or --help never blocks on a stream read.
let scriptedInput: string[] | undefined;

async function readScriptedAnswers(): Promise<string[]> {
  if (scriptedInput !== undefined) return scriptedInput;
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const chunks: Buffer[] = [];
  process.stdin.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  process.stdin.on("error", reject);
  process.stdin.resume();
  const content = await promise;
  scriptedInput = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return scriptedInput;
}

async function nextScriptedAnswer(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const answers = await readScriptedAnswers();
  return answers.shift();
}

async function readLine(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const answer = await nextScriptedAnswer();
    return answer ?? "";
  }
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await reader.question(prompt);
  } finally {
    reader.close();
  }
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
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const answer = await nextScriptedAnswer();
    return answer ? normalizeChoice(answer) ?? "pause" : "pause";
  }

  if (typeof process.stdin.setRawMode !== "function") {
    return readLine("Which is more important? [L/R/T/q]: ").then(
      (answer) => normalizeChoice(answer) ?? "pause",
    );
  }

  process.stdin.resume();
  process.stdin.setRawMode(true);
  return new Promise<ComparisonResult | "pause">((resolve) => {
    const finish = (result: ComparisonResult | "pause"): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
      resolve(result);
    };

    const onData = (chunk: Buffer | string): void => {
      const input = chunk.toString();
      if (input.includes("\u0003")) return finish("pause");
      if (input.includes("\u001b[C") || input.includes("\u001bOC")) {
        return finish("right");
      }
      if (input.includes("\u001b[D") || input.includes("\u001bOD")) {
        return finish("left");
      }
      const result = normalizeChoice(input);
      if (result) finish(result);
    };

    process.stdin.on("data", onData);
  });
}

function renderPair(
  left: Ticket,
  right: Ticket,
  decided: number,
): void {
  clearScreen();
  const line = "-".repeat(72);
  console.log(
    `Top-k prioritization  |  ${paint("L", BOLD)} LEFT vs ${paint("R", BOLD)} RIGHT  |  DECIDED ${decided}`,
  );
  console.log(line);
  console.log(`${paint("LEFT (L) - candidate", BOLD)}`);
  console.log(`${paint("TITLE", BOLD)}: ${left.title}`);
  console.log(`${paint("ID", BOLD)}: ${left.id}`);
  const leftDescription = compact(ticketField(left, "description"));
  if (leftDescription) console.log(`${paint("DESCRIPTION", BOLD)}: ${leftDescription}`);
  console.log(line);
  console.log(`${paint("RIGHT (R) - in top list", BOLD)}`);
  console.log(`${paint("TITLE", BOLD)}: ${right.title}`);
  console.log(`${paint("ID", BOLD)}: ${right.id}`);
  const rightDescription = compact(ticketField(right, "description"));
  if (rightDescription) console.log(`${paint("DESCRIPTION", BOLD)}: ${rightDescription}`);
  console.log(line);
  console.log("L / Left = LEFT more important    R / Right = RIGHT more important    T = tie    Q = pause");
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
    tickets.push({
      id,
      title,
      description,
      ...(source.state !== undefined ? { state: source.state } : {}),
      ...(source.priority !== undefined ? { priority: source.priority } : {}),
      ...(source.url ? { url: String(source.url) } : {}),
    });
  }
  return tickets;
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.input) throw new Error("Missing required option: --input <path|->");

  // State-file default lives next to the input fixture when the input is a path
  // naming a JSON file in the current directory; otherwise use the default.
  const stateFile = args.state;

  const tickets = await loadTickets(args.input);
  if (args.reset) await removeState(stateFile);

  const snapshot = snapshotFor(tickets, args.top);
  const saved = await readState(stateFile);
  if (saved && saved.snapshot !== snapshot) {
    throw new Error(
      "The ticket list or --top changed since the saved session. Inspect it, then run --reset.",
    );
  }
  if (saved && saved.top !== args.top) {
    throw new Error(
      `Saved session used --top ${saved.top}; current is ${args.top}. Run --reset to start again.`,
    );
  }

  const comparisons: ComparisonCache = saved?.comparisons ?? {};
  console.log(
    `Prioritizing ${tickets.length} tickets, top ${args.top}. Input: ${args.input}.`,
  );
  if (saved) console.log(`Resuming from ${stateFile} (${Object.keys(comparisons).length} comparisons saved).`);

  // Prime the state file so a paused session is findable.
  await writeState(stateFile, snapshot, args.top, comparisons);

  let decided = 0;
  let ranked: Ticket[] | undefined;

  // Iterative driver: ask exactly one comparison per pass, then rerun the core.
  for (let guard = 0; guard < tickets.length * tickets.length; guard += 1) {
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

    renderPair(left, right, Object.keys(comparisons).length);
    const choice = await chooseComparison();
    if (choice === "pause") {
      await writeState(stateFile, snapshot, args.top, comparisons);
      console.log("Paused. Comparisons are saved; rerun to resume.");
      return;
    }
    comparisons[key] = writeComparisonValue(
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
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nPrioritization stopped: ${message}`);
  process.exitCode = 1;
});