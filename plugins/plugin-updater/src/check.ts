import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { collectOutcomes, formatReport, resolveHerdrBinary, runCommand } from "./core.ts";

async function main(): Promise<void> {
  const herdrBinary = resolveHerdrBinary();
  const { outcomes, localCount } = await collectOutcomes(runCommand, herdrBinary);
  console.log(formatReport(outcomes, localCount));

  const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (stateDir) {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "last-check.json"),
      JSON.stringify(
        { checked_at: new Date().toISOString(), outcomes },
        null,
        2,
      ),
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
