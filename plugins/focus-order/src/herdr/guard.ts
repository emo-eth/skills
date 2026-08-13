import { runSnapshot } from "./enforce.ts";

async function main(): Promise<void> {
  await runSnapshot();
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`focus-order guard stopped: ${message}`);
  process.exitCode = 1;
});
