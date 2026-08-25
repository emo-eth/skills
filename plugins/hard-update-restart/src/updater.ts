import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  assertRestartableServerStatus,
  performRefresh,
  type PlannedCommand,
} from "./core.ts";

const includeExtensions = process.argv.includes("--extensions");
const herdrBinary = process.env.HERDR_BIN_PATH || "herdr";

async function confirmRestart(): Promise<boolean> {
  console.log("Update Herdr, OMP, and Pi, then hard-restart the Herdr server.");
  console.log(
    includeExtensions
      ? "Installed OMP plugins and Pi extensions will also be updated."
      : "Installed OMP plugins and Pi extensions will not be updated.",
  );
  console.log("");
  console.log("The restart stops every pane. Supported agent sessions will resume with the new runtimes.");
  console.log("The current Herdr client will close. Run `herdr` again to reattach.");
  console.log("");

  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await input.question("Press Enter to continue, or type anything to cancel: ");
    return answer.length === 0;
  } finally {
    input.close();
  }
}

function runUpdateCommand(command: PlannedCommand): Promise<void> {
  console.log(`\n==> ${command.label}: ${command.executable} ${command.args.join(" ")}`);
  const child = spawn(command.executable, command.args, {
    env: process.env,
    stdio: "inherit",
  });
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(
      new Error(
        signal
          ? `${command.label} update received ${signal}`
          : `${command.label} update exited ${code ?? "without a status"}`,
      ),
    );
  });
  return promise;
}

async function scheduleRestartHelper(): Promise<void> {
  const helperPath = fileURLToPath(new URL("./restart-helper.ts", import.meta.url));
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", helperPath],
    {
      detached: true,
      env: process.env,
      stdio: "ignore",
    },
  );
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  child.once("error", reject);
  child.once("spawn", resolve);
  await promise;
  child.unref();
}

try {
  if (!(await confirmRestart())) {
    console.log("Cancelled. No updates ran.");
    process.exit(0);
  }

  await performRefresh(includeExtensions, {
    preflight: async () => {
      const status = spawnSync(herdrBinary, ["status", "server", "--json"], {
        encoding: "utf8",
        env: process.env,
      });
      if (status.status !== 0) {
        throw new Error(status.stderr.trim() || "failed to read Herdr server status");
      }
      assertRestartableServerStatus(status.stdout);
    },
    run: runUpdateCommand,
    scheduleRestart: scheduleRestartHelper,
  });

  console.log(
    "\nOMP and Pi updates complete. Herdr will close, update outside the session, and restart now.",
  );
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nUpdate stopped: ${message}`);
  console.error("Herdr was not restarted. Press Enter to close this window.");
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await input.question("");
  } finally {
    input.close();
  }
  process.exitCode = 1;
}
