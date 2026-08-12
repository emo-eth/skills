#!/usr/bin/env -S node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
// Star review for the user's own assigned Linear tickets.
//
// Shows one assigned ticket at a time. The user can star it (do this now),
// flag it for deletion (it's dumb and bad), skip it, or go BACK to the
// previous ticket to fix a misclick. On completion the starred tickets get
// the highest Linear priority (Urgent) and any flagged tickets can be
// deleted, each behind its own confirmation word.

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Ticket } from "./prioritize-core.ts";
import { deleteIssues, fetchAssignedNotCompleted, setPriority } from "./linear-client.ts";
import { clearScreen, confirmExact, paint, rawChoice } from "./prompt.ts";

const STATE_VERSION = 1;
const BOLD = "\u001b[1m";
const DEFAULT_STATE_FILE = ".star-state.json";
const PRIORITY_LABELS: Record<number, string> = {
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

type StarDecision = "star" | "delete" | "none";
type StarAction = StarDecision | "back" | "pause";

type Arguments = {
  team: string | undefined;
  state: string;
  priority: number;
  dryRun: boolean;
  reset: boolean;
  help: boolean;
};

type ReviewState = {
  version: number;
  snapshot: string;
  decisions: Record<string, StarDecision>;
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
    team: undefined,
    state: DEFAULT_STATE_FILE,
    priority: 1,
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
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--team") {
      options.team = args[++index];
      if (!options.team) throw new Error("--team needs a team key");
      continue;
    }
    if (arg === "--state") {
      options.state = args[++index];
      if (!options.state) throw new Error("--state needs a path");
      continue;
    }
    if (arg === "--priority" || arg === "-p") {
      const value = args[++index];
      const parsed = Number(value);
      if (value === undefined || !Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
        throw new Error("--priority needs an integer 1..4 (1=Urgent, 4=Low)");
      }
      options.priority = parsed;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function printHelp(): void {
  console.log(`Usage: tools/star-linear-tickets.ts [options]

Review the tickets assigned to you and mark each as STAR (do now), FLAG FOR
DELETION (remove it), or skip. Use BACK to revisit the previous ticket. On
completion the starred tickets are set to the highest Linear priority (Urgent)
and flagged tickets can be deleted, each behind its own confirmation. Uses the
installed \`linear\` CLI for auth.

Controls in a terminal:
  S           STAR the ticket (will be set to Urgent)
  D           FLAG the ticket for deletion
  N or Right  leave the ticket as-is (skip)
  B or Left   go BACK to the previous ticket
  Q or Ctrl-C pause and save progress

Options:
      --team <key>       only review issues in this team (e.g. NAT); default all
  -p, --priority <1-4>   priority to set on starred tickets (default 1=Urgent)
      --state <path>     resume/persist state file (default ${DEFAULT_STATE_FILE})
      --dry-run          review and show the plan but change nothing
      --reset            discard saved progress and start again
  -h, --help             show this help
`);
}

function snapshotFor(tickets: Ticket[]): string {
  const value = JSON.stringify(tickets.map((t) => ({ id: t.id, title: t.title })));
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
    if (errorCode(error) === "ENOENT") return undefined;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${stateFile}: ${message}`);
  }
}

async function writeState(
  stateFile: string,
  snapshot: string,
  decisions: Record<string, StarDecision>,
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

function ticketField(ticket: Ticket, key: string): string {
  const value = ticket[key];
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function compact(value: string, maxLength = 400): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizeAction(value: string): StarAction | undefined {
  const answer = value.trim().toLowerCase();
  if (["s", "star"].includes(answer)) return "star";
  if (["d", "delete", "flag"].includes(answer)) return "delete";
  if (["n", "none", "next", "skip", "right"].includes(answer)) return "none";
  if (["b", "back", "left"].includes(answer)) return "back";
  if (["q", "quit", "pause", "ctrl-c"].includes(answer)) return "pause";
  return undefined;
}

async function chooseAction(): Promise<StarAction> {
  const result = await rawChoice(
    "S=star  D=flag for deletion  N/Right=skip  B/Left=back  Q=pause: ",
    normalizeAction,
  );
  if (result === undefined) return "pause";
  return result as StarAction;
}

function renderCard(
  ticket: Ticket,
  index: number,
  total: number,
  starred: number,
  flagged: number,
  decided: number,
): void {
  clearScreen();
  const line = "-".repeat(72);
  const remaining = total - decided;
  console.log(
    `STAR  |  TICKET ${index + 1} OF ${total}  |  STARRED ${starred}  FLAGGED ${flagged}  |  ${remaining} REMAINING`,
  );
  console.log(line);
  console.log(`${paint("TITLE", BOLD)}: ${ticket.title}`);
  console.log(`${paint("ID", BOLD)}: ${ticket.id}`);
  const state = compact(ticketField(ticket, "state"));
  if (state) console.log(`${paint("STATE", BOLD)}: ${state}`);
  const priority = compact(ticketField(ticket, "priority"));
  if (priority) console.log(`${paint("PRIORITY", BOLD)}: ${priority}`);
  const url = compact(ticketField(ticket, "url"), 120);
  if (url) console.log(`${paint("URL", BOLD)}: ${url}`);
  console.log(line);
  console.log("S = star (Urgent)    D = flag for deletion    N/Right = skip    B/Left = back    Q = pause");
}

function printPlan(
  starred: Ticket[],
  flagged: Ticket[],
  priorityLabel: string,
): void {
  console.log(
    `\nPlan: ${starred.length} starred -> ${priorityLabel}, ${flagged.length} flagged for deletion.`,
  );
  if (starred.length > 0) {
    console.log(`\nStarred (set to ${priorityLabel}):`);
    for (const ticket of starred) console.log(`- ${ticket.id}  ${ticket.title}`);
  }
  if (flagged.length > 0) {
    console.log(`\nFlagged for deletion:`);
    for (const ticket of flagged) console.log(`- ${ticket.id}  ${ticket.title}`);
  }
  if (starred.length === 0 && flagged.length === 0) {
    console.log("\nNothing to change. Every ticket was left as-is.");
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const stateFile = args.state;
  const tickets = await fetchAssignedNotCompleted({ team: args.team });
  if (args.reset) await removeState(stateFile);

  const snapshot = snapshotFor(tickets);
  const saved = await readState(stateFile);
  if (saved && saved.snapshot !== snapshot) {
    throw new Error(
      "The ticket list changed since the saved session. Inspect it, then run --reset.",
    );
  }

  const decisions: Record<string, StarDecision> = saved?.decisions ?? {};
  console.log(
    `Reviewing ${tickets.length} assigned ticket(s). Source: Linear (${args.team ?? "all teams"}).`,
  );
  if (saved) {
    console.log(`Resuming (${Object.keys(decisions).length} decided).`);
  }

  await writeState(stateFile, snapshot, decisions);

  // Resume at the first ticket that has no decision yet.
  let index = tickets.findIndex((t) => decisions[t.id] === undefined);
  if (index === -1) index = tickets.length;

  while (index >= 0 && index < tickets.length) {
    const ticket = tickets[index];
    const decidedCount = Object.keys(decisions).length;
    const starredCount = Object.values(decisions).filter((d) => d === "star").length;
    const flaggedCount = Object.values(decisions).filter((d) => d === "delete").length;
    renderCard(ticket, index, tickets.length, starredCount, flaggedCount, decidedCount);

    const action = await chooseAction();
    if (action === "pause") {
      await writeState(stateFile, snapshot, decisions);
      console.log("Paused. Progress is saved; rerun to resume.");
      return;
    }
    if (action === "back") {
      index = Math.max(0, index - 1);
      continue;
    }
    // A "none" (skip) on an already-decided ticket (via Back) keeps its
    // decision and just advances; otherwise record the action.
    if (action !== "none" || decisions[ticket.id] === undefined) {
      decisions[ticket.id] = action;
      await writeState(stateFile, snapshot, decisions);
    }
    // Move forward, skipping tickets that already have a decision.
    index += 1;
    while (index < tickets.length && decisions[tickets[index].id] !== undefined) {
      index += 1;
    }
  }

  const starred = tickets.filter((t) => decisions[t.id] === "star");
  const flagged = tickets.filter((t) => decisions[t.id] === "delete");
  const priorityLabel = PRIORITY_LABELS[args.priority] ?? String(args.priority);

  console.log("\n--- Completed ---");
  printPlan(starred, flagged, priorityLabel);

  if (args.dryRun) {
    console.log("\nDry run only. No Linear changes made.");
    return;
  }

  if (starred.length > 0) {
    if (
      !(await confirmExact(
        `Type APPLY to set ${starred.length} ticket(s) to ${priorityLabel}: `,
        "APPLY",
      ))
    ) {
      console.log("Priority write skipped.");
    } else {
      for (const ticket of starred) {
        await setPriority(ticket.id, args.priority);
        console.log(`Updated ${ticket.id} -> ${priorityLabel}`);
      }
    }
  }

  if (flagged.length > 0) {
    if (
      !(await confirmExact(
        `Type DELETE to permanently delete ${flagged.length} flagged ticket(s): `,
        "DELETE",
      ))
    ) {
      console.log("Deletion skipped.");
    } else {
      await deleteIssues(flagged.map((t) => t.id));
      console.log(`Deleted ${flagged.length} flagged ticket(s).`);
    }
  }

  await removeState(stateFile);
  console.log(
    `Done. ${starred.length} starred, ${flagged.length} flagged for deletion, rest left as-is.`,
  );
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nStar review stopped: ${message}`);
  process.exitCode = 1;
});