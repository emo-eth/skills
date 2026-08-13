import { runSnapshot } from "./enforce.ts";
import { loadState, saveState } from "../shared/store.ts";

async function main(): Promise<void> {
  const state = loadState();
  const mode = state.mode === "focus" ? "modal" : "focus";
  saveState({ ...state, mode });
  console.log(`focus-order mode: ${mode}`);
  await runSnapshot();
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`focus-order mode toggle failed: ${message}`);
  process.exitCode = 1;
});
