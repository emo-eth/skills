import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { firstLine, resolveHerdrBinary, runCommand } from "./core.ts";

const herdrBinary = resolveHerdrBinary();
const installArgs = process.argv.slice(2);

function log(message: string): void {
  const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!stateDir) {
    return;
  }
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(
    join(stateDir, "plugin-updater.log"),
    `${new Date().toISOString()} ${message}\n`,
  );
}

function delay(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
}

try {
  if (installArgs.length === 0) {
    throw new Error("self-update started without an install command");
  }
  // The reinstall replaces this plugin's managed checkout, so this helper is
  // detached from the popup and waits for it to exit first.
  await delay(1_000);
  log(`self-update running: ${herdrBinary} ${installArgs.join(" ")}`);
  const result = await runCommand(herdrBinary, installArgs);
  if (result.status === 0) {
    log("self-update ok");
  } else {
    log(
      `self-update failed (${result.status ?? "no status"}): ` +
        `${firstLine(result.stderr) || result.error || "no error output"}`,
    );
    process.exitCode = 1;
  }
} catch (error: unknown) {
  log(`self-update failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
