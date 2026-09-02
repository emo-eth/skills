import readline from "node:readline";

import { focusTab, listAgents } from "./client.ts";
import { splitManagerInput } from "./manager-input.ts";
import {
  addOrMoveToEnd,
  addOrMoveWorktreeToEnd,
  agentLabel,
  identityFor,
  identityKey,
  moveRank,
  moveWorktreeRank,
  orderedAgents,
  snoozeAgent,
  unsetRank,
  worktreeFor,
  worktreeKey,
  storedWorktreeLabel,
} from "../shared/identity.ts";
import { loadState, saveState } from "../shared/store.ts";
import type {
  AgentSnapshot,
  FocusOrderState,
} from "../shared/types.ts";
import {
  managerViewport,
  renderManager,
  type ManagerOffsets,
  type ManagerSection,
  type ManagerSelection,
  type ManagerWorktreeRow,
} from "./manager-view.ts";
const CLEAR = "\u001b[2J\u001b[H";

type Section = ManagerSection;
type Selection = ManagerSelection;
type WorktreeRow = ManagerWorktreeRow;
async function main(): Promise<void> {
  let state = loadState();
  let agents = await listAgents();
  let selection: Selection = { section: "agents" };
  let status = "Ready";
  let helpOpen = false;
  const sectionKeys: Record<Section, string | undefined> = {
    agents: undefined,
    worktrees: undefined,
  };
  const offsets: ManagerOffsets = { agents: 0, worktrees: 0 };

  const rememberSelection = (): void => {
    sectionKeys[selection.section] = selection.key;
    ensureSelectionVisible(state, agents, selection, offsets);
  };

  const syncSelection = (): void => {
    selection = preserveSelection(state, agents, {
      section: selection.section,
      key: sectionKeys[selection.section] ?? selection.key,
    });
    rememberSelection();
  };

  syncSelection();

  const render = (): void => {
    process.stdout.write(
      CLEAR + renderManager(
        state,
        agents,
        worktreeRows(state, agents),
        selection,
        status,
        helpOpen,
        offsets,
        process.stdout.rows ?? 24,
      ),
    );
  };

  const switchSection = (section: Section): void => {
    selection = { section, key: sectionKeys[section] };
    syncSelection();
    render();
  };

  const reload = async (): Promise<void> => {
    agents = await listAgents();
    syncSelection();
    status = `Loaded ${agents.length} agent pane(s)`;
    render();
  };

  const update = (next: FocusOrderState, message: string): void => {
    state = next;
    saveState(state);
    syncSelection();
    status = message;
    render();
  };

  const handle = async (input: string): Promise<boolean> => {
    if (input === "q" || input === "Q" || input === "\u0003") return false;

    if (helpOpen) {
      if (input === "?" || input === "h" || input === "H" || input === "\u001b") {
        helpOpen = false;
        render();
      }
      return true;
    }

    if (input === "?" || input === "h" || input === "H") {
      helpOpen = true;
      render();
      return true;
    }
    if (input === "\u001b") return false;
    if (input === "\t") {
      switchSection(selection.section === "agents" ? "worktrees" : "agents");
      return true;
    }
    if (input === "1") {
      switchSection("agents");
      return true;
    }
    if (input === "2") {
      switchSection("worktrees");
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
    if (input === "\u001b[5~") {
      moveSelection(-Math.max(1, managerViewport(process.stdout.rows ?? 24) - 2));
      render();
      return true;
    }
    if (input === "\u001b[6~") {
      moveSelection(Math.max(1, managerViewport(process.stdout.rows ?? 24) - 2));
      render();
      return true;
    }
    if (input === "\u001b[H" || input === "\u001b[1~" || input === "g") {
      moveSelectionTo(0);
      render();
      return true;
    }
    if (input === "\u001b[F" || input === "\u001b[4~" || input === "G") {
      moveSelectionTo(Number.POSITIVE_INFINITY);
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

  const moveSelection = (delta: number): void => {
    const rows = selection.section === "agents"
      ? orderedAgents(state, agents).map((agent) => identityKey(identityFor(agent)))
      : worktreeRows(state, agents).map((row) => worktreeKey(row.identity));
    if (rows.length === 0) return;
    const current = Math.max(0, rows.indexOf(selection.key ?? ""));
    const next = Math.max(0, Math.min(rows.length - 1, current + delta));
    selection = { ...selection, key: rows[next] };
    rememberSelection();
  };

  const moveSelectionTo = (target: number): void => {
    const rows = selection.section === "agents"
      ? orderedAgents(state, agents).map((agent) => identityKey(identityFor(agent)))
      : worktreeRows(state, agents).map((row) => worktreeKey(row.identity));
    if (rows.length === 0) return;
    const next = target === Number.POSITIVE_INFINITY ? rows.length - 1 : Math.max(0, target);
    selection = { ...selection, key: rows[Math.min(rows.length - 1, next)] };
    rememberSelection();
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
    await focusTab(agent.tab_id);
    status = `Focused tab for ${agentLabel(agent)}; rank is unchanged`;
    render();
  };

  render();
  await runInputLoop(handle);
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

function ensureSelectionVisible(
  state: FocusOrderState,
  agents: AgentSnapshot[],
  selection: Selection,
  offsets: ManagerOffsets,
): void {
  const keys = selection.section === "agents"
    ? orderedAgents(state, agents).map((agent) => identityKey(identityFor(agent)))
    : worktreeRows(state, agents).map((row) => worktreeKey(row.identity));
  if (keys.length === 0) {
    offsets[selection.section] = 0;
    return;
  }
  const selected = Math.max(0, keys.indexOf(selection.key ?? ""));
  const viewport = managerViewport(process.stdout.rows ?? 24);
  const bodyRows = keys.length > viewport ? Math.max(1, viewport - 2) : viewport;
  const maxOffset = Math.max(0, keys.length - bodyRows);
  let offset = Math.max(0, Math.min(offsets[selection.section], maxOffset));
  if (selected < offset) offset = selected;
  if (selected >= offset + bodyRows) offset = selected - bodyRows + 1;
  offsets[selection.section] = offset;
}

async function runInputLoop(handle: (input: string) => Promise<boolean>): Promise<void> {
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    try {
      for await (const chunk of process.stdin) {
        for (const input of splitManagerInput(String(chunk))) {
          if (!(await handle(input))) return;
        }
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
