import { pathToFileURL } from "node:url";

import { closePopup, focusTab, listAgents, openPopup } from "./client.ts";
import { chooseTarget } from "./guard-policy.ts";
import {
  clearResolvedSnoozes,
  urgentAgents,
} from "../shared/identity.ts";
import { popupOpen } from "../shared/modal-lock.ts";
import { loadState, saveState } from "../shared/store.ts";
import type { AgentSnapshot, FocusOrderState } from "../shared/types.ts";

const MODAL_WIDTH = "90%";
const MODAL_HEIGHT = 20;

/** One full snapshot: load state, list agents, clear snoozes, save, then enforce. */
export async function runSnapshot(): Promise<void> {
  const state = loadState();
  const agents = await listAgents();
  const normalized = clearResolvedSnoozes(state, agents);
  if (normalized !== state) saveState(normalized);
  await enforce(normalized, agents);
}

/** Decide whether to open, close, or keep the attention popup, then act on focus mode. */
export async function enforce(state: FocusOrderState, agents: AgentSnapshot[]): Promise<void> {
  const urgent = state.enabled ? urgentAgents(state, agents) : [];

  let attentionOpen = popupOpen();
  if (attentionOpen) {
    const shouldKeepOpen = state.enabled && state.mode === "modal" && urgent.length > 0;
    if (!shouldKeepOpen) {
      await closeAttentionPopup();
      attentionOpen = false;
    }
  }

  if (state.enabled && state.mode === "modal" && urgent.length > 0 && !attentionOpen) {
    await openModal();
    return;
  }

  if (!state.enabled || state.mode !== "focus") return;

  const focused = agents.find((agent) => agent.focused);
  const focusedTabId = focused?.tab_id;
  const decision = chooseTarget(state, agents, focused);
  if (!decision.target || !decision.reason || decision.reason === "current_target") return;
  if (focusedTabId !== decision.target.tab_id) {
    await focusTab(decision.target.tab_id);
  }
}

async function openModal(): Promise<void> {
  try {
    await openPopup({
      entrypoint: "attention",
      width: MODAL_WIDTH,
      height: MODAL_HEIGHT,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`focus-order attention popup failed to open: ${message}`);
  }
}

async function closeAttentionPopup(): Promise<void> {
  try {
    await closePopup();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("popup_not_open")) throw error;
  }
}

const isMainEntry = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainEntry) {
  void runSnapshot().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`focus-order enforce failed: ${message}`);
    process.exitCode = 1;
  });
}
