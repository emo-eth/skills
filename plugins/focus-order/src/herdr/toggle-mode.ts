import { runSnapshot } from "./enforce.ts";
import { mutateState } from "../shared/store.ts";

async function main(): Promise<void> {
  const state = await mutateState((current) => ({
    ...current,
    mode: current.mode === "focus" ? "modal" : "focus",
  }));
  console.log(`focus-order mode: ${state.mode}`);
  await runSnapshot();
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`focus-order mode toggle failed: ${message}`);
  process.exitCode = 1;
});
