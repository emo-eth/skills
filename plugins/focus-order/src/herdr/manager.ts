import readline from "node:readline";

import { focusAgent, listAgents } from "./client.ts";
import {
  addOrMoveToEnd,
  addOrMoveWorktreeToEnd,
  agentLabel,
  identityFor,
  identityKey,
  moveRank,
  moveWorktreeRank,
  orderedAgents,
  rankOf,
  snoozeAgent,
  storedWorktreeLabel,
  unsetRank,
  worktreeFor,
  worktreeKey,
  worktreeRankOf,
} from "../shared/identity.ts";
import { loadState, saveState } from "../shared/store.ts";
import type {
  AgentSnapshot,
  FocusOrderState,
  WorktreeIdentity,
} from "../shared/types.ts";
const RESET = "\u001b[0m";
const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const CLEAR = "\u001b[2J\u001b[H";

type Section = "agents" | "worktrees";
type Selection = {
  section: Section;
  key?: string;
};
type WorktreeRow = {
  identity: WorktreeIdentity;
  label: string;
  agent?: AgentSnapshot;
};

async function main(): Promise<void> {
  let state = loadState();
  let agents = await listAgents();
  let selection: Selection = { section: "agents" };
  let status = "Ready";
  selection = preserveSelection(state, agents, selection);

  const render = (): void => {
    process.stdout.write(CLEAR + renderScreen(state, agents, selection, status));
  };

  const reload = async (): Promise<void> => {
    agents = await listAgents();
    selection = preserveSelection(state, agents, selection);
    status = `Loaded ${agents.length} agent pane(s)`;
    render();
  };

  const update = (next: FocusOrderState, message: string): void => {
    state = next;
    saveState(state);
    selection = preserveSelection(state, agents, selection);
    status = message;
    render();
  };

  const handle = async (input: string): Promise<boolean> => {
    if (input === "q" || input === "Q" || input === "\u0003") return false;
    if (input === "\t") {
      selection = { section: selection.section === "agents" ? "worktrees" : "agents" };
      selection = preserveSelection(state, agents, selection);
      render();
      return true;
    }
    if (input === "m" || input === "M") {
      update(
        { ...state, mode: state.mode === "focus" ? "modal" : "focus" },
        `Mode: ${state.mode === "focus" ? "modal" : "focus"}`,
      );
      return true;
    }
    if (input === "e" || input === "E") {
      update({ ...state, enabled: !state.enabled }, `Guard ${state.enabled ? "disabled" : "enabled"}`);
      return true;
    }
    if (input === "l" || input === "L") {
      await reload();
      return true;
    }
    if (input === "?" || input === "h" || input === "H") {
      status = "Tab lists; arrows select; u/d rank; r add; x unset; s snooze; f focus; m mode; e guard; q close. Worktrees give unranked agents a fallback rank; ranked agents always win.";
      render();
      return true;
    }
    if (input === "\u001b[A" || input === "k") {
      moveSelection(-1);
      render();
      return true;
    }
    if (input === "\u001b[B" || input === "j") {
      moveSelection(1);
      render();
      return true;
    }
    if (input === "u" || input === "U") {
      await moveSelected(-1, update);
      return true;
    }
    if (input === "d" || input === "D") {
      await moveSelected(1, update);
      return true;
    }
    if (input === "r" || input === "R") {
      await rankSelected(update);
      return true;
    }
    if (input === "x" || input === "X") {
      unsetSelected(update);
      return true;
    }
    if (input === "s" || input === "S") {
      snoozeSelected();
      return true;
    }
    if (input === "f" || input === "F") {
      await focusSelected();
      return true;
    }
    status = `Unknown command: ${JSON.stringify(input)}`;
    render();
    return true;
  };

  const moveSelection = (delta: -1 | 1): void => {
    const rows = selection.section === "agents"
      ? orderedAgents(state, agents).map((agent) => identityKey(identityFor(agent)))
      : worktreeRows(state, agents).map((row) => worktreeKey(row.identity));
    if (rows.length === 0) return;
    const current = selection.key ? rows.indexOf(selection.key) : 0;
    const next = Math.max(0, Math.min(rows.length - 1, current + delta));
    selection = { ...selection, key: rows[next] };
  };

  const moveSelected = async (
    delta: -1 | 1,
    apply: (state: FocusOrderState, message: string) => void,
  ): Promise<void> => {
    if (selection.section === "agents") {
      const agent = selectedAgent(state, agents, selection);
      if (!agent) return;
      apply(moveRank(state, agent, delta), `${agentLabel(agent)} moved ${delta < 0 ? "up" : "down"}`);
      return;
    }
    const row = selectedWorktree(state, agents, selection);
    if (!row?.agent) {
      status = "Select a live worktree to move it";
      render();
      return;
    }
    apply(
      moveWorktreeRank(state, row.agent, delta),
      `${row.label} moved ${delta < 0 ? "up" : "down"}`,
    );
  };

  const rankSelected = async (
    apply: (state: FocusOrderState, message: string) => void,
  ): Promise<void> => {
    if (selection.section === "agents") {
      const agent = selectedAgent(state, agents, selection);
      if (!agent) return;
      apply(addOrMoveToEnd(state, agent), `${agentLabel(agent)} ranked at the end`);
      return;
    }
    const row = selectedWorktree(state, agents, selection);
    if (!row?.agent) {
      status = "Select a live worktree to rank it";
      render();
      return;
    }
    apply(addOrMoveWorktreeToEnd(state, row.agent), `${row.label} ranked at the end`);
  };

  const unsetSelected = (apply: (state: FocusOrderState, message: string) => void): void => {
    if (selection.section === "agents") {
      const agent = selectedAgent(state, agents, selection);
      if (!agent) return;
      apply(unsetRank(state, agent), `${agentLabel(agent)} is unranked`);
      return;
    }
    const row = selectedWorktree(state, agents, selection);
    if (!row) return;
    const key = worktreeKey(row.identity);
    apply(
      {
        ...state,
        ordered_worktrees: state.ordered_worktrees.filter(
          (stored) => worktreeKey(stored.identity) !== key,
        ),
      },
      `${row.label} is unranked`,
    );
  };

  const snoozeSelected = (): void => {
    const agent = selectedAgent(state, agents, selection);
    if (!agent) {
      status = "Snooze applies to agents, not worktrees";
      render();
      return;
    }
    update(snoozeAgent(state, agent), `${agentLabel(agent)} snoozed until it becomes working`);
  };

  const focusSelected = async (): Promise<void> => {
    const agent = selectedAgent(state, agents, selection);
    if (!agent) {
      status = "Focus applies to agents, not worktrees";
      render();
      return;
    }
    await focusAgent(agent.pane_id);
    status = `Focused ${agentLabel(agent)}; urgent status is unchanged`;
    render();
  };

  render();
  await runInputLoop(handle);
}

function renderScreen(
  state: FocusOrderState,
  agents: AgentSnapshot[],
  selection: Selection,
  status: string,
  height?: number,
): string {
  const total = height ?? process.stdout.rows ?? 24;
  const chrome = 8; // title, subtitle, blank, agents hdr, blank, worktrees hdr, status, help
  const available = Math.max(4, total - chrome);
  const agentsActive = selection.section === "agents";
  const agentBudget = agentsActive ? Math.ceil(available * 0.55) : Math.floor(available * 0.45);
  const wtBudget = Math.max(2, available - agentBudget);

  const rows: string[] = [];
  rows.push(`${BOLD}Focus Order${RESET}  guard=${state.enabled ? `${GREEN}on${RESET}` : `${RED}off${RESET}`} mode=${state.mode}`);
  rows.push(`${DIM}Order: rank first, then scheduler order. Worktrees = fallback rank for unranked agents.${RESET}`);
  rows.push("");

  rows.push(`${BOLD}Agents${RESET}${agentsActive ? " [active]" : ""}`);
  const ordered = orderedAgents(state, agents);
  const agentKeys = ordered.map((agent) => identityKey(identityFor(agent)));
  const agentSel = agentsActive ? selection.key ?? agentKeys[0] : undefined;
  if (ordered.length === 0) rows.push("  (none reported by Herdr)");
  else rows.push(...windowRows(
    ordered.map((agent) => agentRow(state, agent)),
    agentKeys,
    agentSel,
    agentBudget,
  ));

  rows.push("");
  rows.push(`${BOLD}Worktrees${RESET}${agentsActive ? "" : " [active]"}`);
  const worktrees = worktreeRows(state, agents);
  const wtKeys = worktrees.map((row) => worktreeKey(row.identity));
  const wtSel = !agentsActive ? selection.key ?? wtKeys[0] : undefined;
  if (worktrees.length === 0) rows.push("  (none reported by Herdr)");
  else rows.push(...windowRows(
    worktrees.map((row) => worktreeRow(state, row)),
    wtKeys,
    wtSel,
    wtBudget,
  ));

  rows.push("");
  rows.push(`${DIM}${status}${RESET}`);
  rows.push(`${DIM}q close  ? help${RESET}`);
  return `${rows.join("\n")}\n`;
}

/** Keep the selected row visible inside a fixed-height window; report overflow. */
function windowRows(
  lines: string[],
  keys: string[],
  selected: string | undefined,
  viewport: number,
): string[] {
  const selIdx = selected !== undefined && keys.includes(selected)
    ? keys.indexOf(selected)
    : 0;
  const start = Math.max(0, Math.min(selIdx - Math.floor(viewport / 2), Math.max(0, lines.length - viewport)));
  const end = Math.min(lines.length, start + viewport);
  const out: string[] = [];
  if (start > 0) out.push(`${DIM}  (${start} more above)${RESET}`);
  for (let i = start; i < end; i += 1) {
    const selectedRow = i === selIdx;
    out.push(selectedRow ? `\u001b[7m> ${lines[i]}\u001b[0m` : `  ${lines[i]}`);
  }
  if (end < lines.length) out.push(`${DIM}  (${lines.length - end} more below)${RESET}`);
  return out;
}

/** Least->most granular: agent, status, workspace, worktree, tab, pane. */
function agentRow(state: FocusOrderState, agent: AgentSnapshot): string {
  const rank = rankOf(state, agent);
  const worktreeRank = worktreeRankOf(state, agent);
  const effective = rank === undefined && worktreeRank !== undefined
    ? `wt:${worktreeRank}`
    : rank === undefined ? "-" : String(rank);
  const urgent = agent.agent_status === "idle"
    || agent.agent_status === "blocked"
    || agent.agent_status === "done";
  const place = agent.workspace_label ?? agent.workspace_id;
  const wt = agent.worktree_label ?? agent.worktree_path;
  const pane = agent.pane_id;
  const parts = [place];
  if (wt && wt !== place) parts.push(wt);
  parts.push(pane);
  return `${effective.padStart(4, " ")} ${urgent ? "!" : " "} ${agentLabel(agent)} [${agent.agent_status}] ${parts.join(" \u00b7 ")}`;
}

/** Least->most granular: label, path, owning agent status. */
function worktreeRow(state: FocusOrderState, row: WorktreeRow): string {
  const rank = state.ordered_worktrees.findIndex(
    (stored) => worktreeKey(stored.identity) === worktreeKey(row.identity),
  );
  const label = row.label;
  const path = row.identity.value.startsWith("workspace:") ? "" : row.identity.value;
  const status = row.agent ? ` [${row.agent.agent_status}]` : "";
  return `${(rank === -1 ? "-" : String(rank + 1)).padStart(4, " ")} ${label}${path && path !== label ? ` \u00b7 ${path}` : ""}${status}`;
}

function worktreeRows(state: FocusOrderState, agents: AgentSnapshot[]): WorktreeRow[] {
  const rows = new Map<string, WorktreeRow>();
  for (const stored of state.ordered_worktrees) {
    rows.set(worktreeKey(stored.identity), {
      identity: stored.identity,
      label: storedWorktreeLabel(stored),
    });
  }
  for (const agent of agents) {
    const identity = worktreeFor(agent);
    const key = worktreeKey(identity);
    const current = rows.get(key);
    rows.set(key, current ?? { identity, label: agent.worktree_label ?? agent.workspace_id, agent });
    if (current && !current.agent) current.agent = agent;
  }
  const rankByKey = new Map(state.ordered_worktrees.map((stored, index) => [worktreeKey(stored.identity), index]));
  return [...rows.values()].sort((left, right) => {
    const leftRank = rankByKey.get(worktreeKey(left.identity));
    const rightRank = rankByKey.get(worktreeKey(right.identity));
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
    if (leftRank !== undefined) return -1;
    if (rightRank !== undefined) return 1;
    return left.label.localeCompare(right.label);
  });
}

function selectedAgent(
  state: FocusOrderState,
  agents: AgentSnapshot[],
  selection: Selection,
): AgentSnapshot | undefined {
  if (selection.section !== "agents") return undefined;
  const ordered = orderedAgents(state, agents);
  return ordered.find((agent) => identityKey(identityFor(agent)) === selection.key) ?? ordered[0];
}

function selectedWorktree(
  state: FocusOrderState,
  agents: AgentSnapshot[],
  selection: Selection,
): WorktreeRow | undefined {
  if (selection.section !== "worktrees") return undefined;
  const rows = worktreeRows(state, agents);
  return rows.find((row) => worktreeKey(row.identity) === selection.key) ?? rows[0];
}

function preserveSelection(
  state: FocusOrderState,
  agents: AgentSnapshot[],
  selection: Selection,
): Selection {
  const rows = selection.section === "agents"
    ? orderedAgents(state, agents).map((agent) => identityKey(identityFor(agent)))
    : worktreeRows(state, agents).map((row) => worktreeKey(row.identity));
  return {
    section: selection.section,
    key: selection.key && rows.includes(selection.key) ? selection.key : rows[0],
  };
}

async function runInputLoop(handle: (input: string) => Promise<boolean>): Promise<void> {
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    try {
      for await (const chunk of process.stdin) {
        if (!(await handle(String(chunk)))) break;
      }
    } finally {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    return;
  }

  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for await (const line of input) {
      if (!(await handle(line.trim()))) break;
    }
  } finally {
    input.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`focus-order manager stopped: ${message}`);
  process.exitCode = 1;
});
