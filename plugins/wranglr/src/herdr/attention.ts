import readline from "node:readline";

import { closePopup, focusAgent, listAgents } from "./client.ts";
import {
  agentLabel,
  clearResolvedSnoozes,
  rankOf,
  snoozeAgent,
  urgentAgents,
  worktreeRankOf,
} from "../shared/identity.ts";
import { claimOwner, releaseOwner } from "../shared/modal-lock.ts";
import { loadState, saveState } from "../shared/store.ts";
import type { AgentSnapshot, WranglrState } from "../shared/types.ts";

const RESET = "\u001b[0m";
const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";
const CLEAR = "\u001b[2J\u001b[H";

async function main(): Promise<void> {
  const owner = claimOwner();
  if (!owner) {
    console.error(
      "wranglr attention popup is already owned by a live process; refusing to open a duplicate",
    );
    process.exitCode = 1;
    return;
  }

  let state = loadState();
  let agents: AgentSnapshot[] = [];
  let status = "Waiting for an explicit action";
  let selected = 0;
  let poller: NodeJS.Timeout | undefined;

  try {
    const closeAndExit = async (): Promise<boolean> => {
      try {
        await closePopup();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("popup_not_open")) {
          status = `Failed to close popup: ${message}`;
          render(state, urgentAgents(state, agents), selected, status);
        }
      }
      return false;
    };

    const refresh = async (): Promise<void> => {
      agents = await listAgents();
      const normalized = clearResolvedSnoozes(state, agents);
      if (normalized !== state) {
        state = normalized;
        saveState(state);
      }
      selected = Math.max(
        0,
        Math.min(selected, Math.max(urgentAgents(state, agents).length - 1, 0)),
      );
      render(state, urgentAgents(state, agents), selected, status);
    };

    const handle = async (input: string): Promise<boolean> => {
      const urgent = urgentAgents(state, agents);
      if (input === "\u001b[A" || input === "k") {
        selected = Math.max(0, selected - 1);
        render(state, urgentAgents(state, agents), selected, status);
        return true;
      }
      if (input === "q" || input === "Q" || input === "\u0003" || input === "\u001b") {
        status = "Use s to snooze, u to disable the guard, or m to switch to focus mode";
        render(state, urgentAgents(state, agents), selected, status);
        return true;
      }
      if (input === "\u001b[B" || input === "j") {
        selected = Math.min(Math.max(urgent.length - 1, 0), selected + 1);
        render(state, urgentAgents(state, agents), selected, status);
        return true;
      }
      if (input === "s" || input === "S") {
        const target = urgent[selected];
        if (!target) {
          status = "No urgent agent is selected";
          render(state, urgentAgents(state, agents), selected, status);
          return true;
        }
        state = snoozeAgent(state, target);
        saveState(state);
        status = `${agentLabel(target)} snoozed until it becomes working`;
        return closeAndExit();
      }
      if (input === "f" || input === "F" || input === "\r" || input === "\n") {
        const target = urgent[selected];
        if (target) {
          await focusAgent(target.pane_id);
          status = `${agentLabel(target)} focused; urgent state remains unresolved`;
          render(state, urgentAgents(state, agents), selected, status);
        }
        return true;
      }
      if (input === "u" || input === "U") {
        state = { ...state, enabled: false };
        saveState(state);
        status = "Guard disabled; the modal will close";
        return closeAndExit();
      }
      if (input === "m" || input === "M") {
        state = { ...state, mode: "focus" };
        saveState(state);
        status = "Switched to focus mode; the modal will close";
        return closeAndExit();
      }
      status = `Unknown command: ${JSON.stringify(input)}`;
      render(state, urgentAgents(state, agents), selected, status);
      return true;
    };

    poller = setInterval(() => {
      void refresh().catch((error: unknown) => {
        status = `Refresh failed: ${error instanceof Error ? error.message : String(error)}`;
        render(state, urgentAgents(state, agents), selected, status);
      });
    }, 500);

    await refresh();
    await runInputLoop(handle);
  } finally {
    if (poller) clearInterval(poller);
    releaseOwner(owner);
  }
}

function render(
  state: WranglrState,
  urgent: AgentSnapshot[],
  selected: number,
  status: string,
): void {
  const rows: string[] = [];
  rows.push(`${BOLD}Attention required${RESET}  mode=${state.mode} guard=${state.enabled ? "on" : "off"}`);
  rows.push(`${DIM}This is a separate modal. Focusing an agent does not resolve its urgent state.${RESET}`);
  rows.push("");
  if (urgent.length === 0) {
    rows.push("No unsnoozed idle, blocked, or done agents.");
  } else {
    rows.push(`${BOLD}Urgent agents${RESET}`);
    urgent.forEach((agent, index) => {
      const rank = rankOf(state, agent);
      const worktreeRank = worktreeRankOf(state, agent);
      const priority = rank === undefined && worktreeRank !== undefined
        ? `worktree ${worktreeRank}`
        : rank === undefined ? "unranked" : `agent ${rank}`;
      rows.push(`${index === selected ? ">" : " "} ${agentLabel(agent)} [${agent.agent_status}; ${priority}]`);
    });
  }
  rows.push("");
  rows.push(`${DIM}Enter/f focus  s snooze  u disable guard  m use focus mode  q keep open${RESET}`);
  rows.push(`${DIM}${status}${RESET}`);
  process.stdout.write(CLEAR + `${rows.join("\n")}\n`);
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
  console.error(`wranglr attention stopped: ${message}`);
  process.exitCode = 1;
});
