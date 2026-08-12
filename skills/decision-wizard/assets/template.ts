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
const { dirname } = require("node:path");
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

const REVIEW_TITLE = "Review items";
const STATE_FILE = process.env.REVIEW_STATE_FILE ?? ".review-state/items.json";
const RESULT_FILE =
  process.env.REVIEW_RESULT_FILE ?? ".review-state/items.result.json";
const POSITIVE_LABEL = "keep";
const NEGATIVE_LABEL = "remove";

async function loadItems(): Promise<ReviewItem[]> {
  return [
    {
      id: "example-item",
      title: "Example item",
      description: "Replace this card with an item from the real source.",
      details: [["Origin", "Replace with provenance"]],
    },
  ];
}

function printActionPlan(outcome: ReviewOutcome): void {
  console.log("\nAction plan:");
  for (const item of outcome.rejected) {
    console.log(`- write the ${NEGATIVE_LABEL} decision for ${item.id}`);
  }
  for (const item of outcome.approved) {
    console.log(`- write the ${POSITIVE_LABEL} decision for ${item.id}`);
  }
}

async function applyOutcome(outcome: ReviewOutcome): Promise<void> {
  await mkdir(dirname(RESULT_FILE), { recursive: true });
  await writeFile(
    RESULT_FILE,
    `${JSON.stringify(
      {
        approved: outcome.approved.map((item) => item.id),
        rejected: outcome.rejected.map((item) => item.id),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`Wrote the result to ${RESULT_FILE}`);
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printHelp(REVIEW_TITLE, STATE_FILE);
    return;
  }

  const items = await loadItems();
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
    console.log("\nDry run only. No action was applied.");
    return;
  }

  printActionPlan(outcome);
  if (!(await confirmExact("Type APPLY to continue: ", "APPLY"))) {
    console.log("Action skipped. The saved review can resume later.");
    return;
  }

  await applyOutcome(outcome);
  await review.clearState();
  console.log("Action complete. The saved review was removed.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nDecision wizard stopped: ${message}`);
  process.exitCode = 1;
});