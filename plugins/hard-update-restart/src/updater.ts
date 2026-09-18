import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  discoverMeshTargets,
  environmentOutsideHerdr,
  readRestartTarget,
  resolveHerdrBinary,
  type FleetTarget,
} from "./core.ts";

async function main(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error("Run this action in a Herdr popup so the full restart can be confirmed.");
  }
  const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!stateDir) {
    throw new Error("Missing plugin state directory. Run the hard-update-restart action from Herdr.");
  }
  const herdrBinary = resolveHerdrBinary();
  const status = spawnSync(herdrBinary, ["status", "server", "--json"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (status.status !== 0) {
    throw new Error(status.stderr.trim() || "Cannot read the current Herdr server.");
  }
  const target = readRestartTarget(status.stdout);
  const reattach = target.session ? `herdr --session ${target.session}` : "herdr";
  const meshTargets = discoverMeshTargets(herdrBinary, target, (cmd, args) => {
    const res = spawnSync(cmd, args, { encoding: "utf8", timeout: 5000 });
    return { status: res.status, stdout: res.stdout || "" };
  });

  const noUpdatesFlag = process.argv.includes("--no-updates");

  if (noUpdatesFlag) {
    console.log("Hard-restart Herdr (no updates)");
    console.log("");
    if (meshTargets.length > 1) {
      console.log("Mesh machines discovered:");
      for (const t of meshTargets) {
        if (t.kind === "local") {
          console.log(`  • Local (${t.session ? `session: ${t.session}` : "current session"})`);
        } else {
          console.log(`  • ${t.label} (SSH: ${t.sshTarget}, session: ${t.session})`);
        }
      }
      console.log("");
    }
    console.log("1. Drain and capture recoverable agent sessions.");
    console.log("2. Stop the Herdr server (every pane dies; the TUI client exits with it).");
    console.log("3. Start a replacement Herdr server with current configs loaded.");
    console.log("4. Open a new terminal window attached as the Herdr client.");
    console.log("5. Reconnect agent sessions into fresh processes.");
    console.log("");
    console.log("This stops EVERY pane process in selected session(s), including shells and dev servers.");
    console.log("Non-agent processes return as fresh shells, not running commands.");
    console.log("Working, blocked, and unknown agents must settle first.");
    console.log("An agent without a recoverable native session prevents shutdown.");
    console.log(`Custom herdr binaries are left untouched (no herdr update in this mode).`);
    console.log(`If a new client window does not open, run: ${reattach}`);
    console.log("");
  } else {
    console.log("Update everything and hard-restart");
    console.log("");
    if (meshTargets.length > 1) {
      console.log("Mesh machines discovered:");
      for (const t of meshTargets) {
        if (t.kind === "local") {
          console.log(`  • Local (${t.session ? `session: ${t.session}` : "current session"})`);
        } else {
          console.log(`  • ${t.label} (SSH: ${t.sshTarget}, session: ${t.session})`);
        }
      }
      console.log("");
    }
    console.log("1. Update OMP, Pi, and tracked plugins. Skip herdr update for custom builds.");
    console.log("2. Drain agents, stop the Herdr server (TUI client exits with it), start a replacement.");
    console.log("3. Open a new terminal window attached as the Herdr client.");
    console.log("4. Reconnect agent sessions into fresh processes.");
    console.log("Custom herdr binaries (unofficial version, cargo target, symlink, or .herdr-skip-update) are never overwritten.");
    console.log("Pinned and locally linked Herdr plugins stay untouched.");
    console.log("Configs already on disk are loaded by the new processes; configs are not replaced.");
    console.log("");
    console.log("This stops EVERY pane process in selected session(s), including shells and dev servers.");
    console.log("Non-agent processes return as fresh shells, not running commands.");
    console.log("Working, blocked, and unknown agents must settle first.");
    console.log("An agent without a recoverable native session prevents shutdown.");
    console.log(`If a new client window does not open, run: ${reattach}`);
    console.log("");
  }

  const input = createInterface({ input: process.stdin, output: process.stdout });
  let choice = "";
  try {
    const prompt = noUpdatesFlag
      ? meshTargets.length > 1
        ? 'Type "all" (or "restart") to restart all machines, "local" for this machine only, or anything else to cancel: '
        : 'Type "restart" (or "yes") to continue; anything else cancels: '
      : meshTargets.length > 1
        ? 'Type "all" (update & restart all), "restart" (restart all, NO updates), "local" (this machine only), or anything else to cancel: '
        : 'Type "update" to update & restart, "restart" for restart without updates, or anything else to cancel: ';
    choice = (await input.question(prompt)).trim().toLowerCase();
  } catch {
    choice = "";
  } finally {
    input.close();
  }

  let skipUpdates = noUpdatesFlag;
  let scope: "fleet" | "local" = "local";

  if (noUpdatesFlag) {
    if (choice === "all" || choice === "restart" || choice === "update" || choice === "yes" || choice === "y") {
      scope = meshTargets.length > 1 ? "fleet" : "local";
      skipUpdates = true;
    } else if (choice === "local") {
      scope = "local";
      skipUpdates = true;
    } else {
      console.log("Cancelled. Nothing changed.");
      return;
    }
  } else {
    if (choice === "all" || choice === "update") {
      scope = meshTargets.length > 1 ? "fleet" : "local";
      skipUpdates = false;
    } else if (choice === "restart" || choice === "r") {
      scope = meshTargets.length > 1 ? "fleet" : "local";
      skipUpdates = true;
    } else if (choice === "local") {
      scope = "local";
      skipUpdates = false;
    } else if (choice === "local-restart" || choice === "lr") {
      scope = "local";
      skipUpdates = true;
    } else {
      console.log("Cancelled. Nothing changed.");
      return;
    }
  }

  const selectedTargets: FleetTarget[] = scope === "fleet" ? meshTargets : [meshTargets[0]];

  mkdirSync(stateDir, { recursive: true });
  const activeDir = join(stateDir, "active");
  try {
    mkdirSync(activeDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`An update job already owns ${activeDir}. Inspect its job.json and status before retrying.`);
    }
    throw error;
  }
  let launched = false;
  try {
    const jobDir = mkdtempSync(join(stateDir, "job-"));
    const snapshotDir = join(jobDir, "snapshot");
    const workerDir = join(snapshotDir, "plugins", "hard-update-restart", "src");
    const pluginDir = join(snapshotDir, "plugins", "plugin-updater", "src");
    mkdirSync(workerDir, { recursive: true });
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(snapshotDir, "package.json"), JSON.stringify({ type: "module" }));
    for (const name of ["core.ts", "restart-helper.ts"]) {
      copyFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), join(workerDir, name));
    }
    copyFileSync(
      fileURLToPath(new URL("../../plugin-updater/src/core.ts", import.meta.url)),
      join(pluginDir, "core.ts"),
    );
    writeFileSync(
      join(jobDir, "request.json"),
      JSON.stringify({
        target,
        targets: selectedTargets,
        scope,
        skipUpdates,
        herdrBinary,
        cwd: jobDir,
        activeLockPath: activeDir,
      }),
    );
    writeFileSync(join(activeDir, "job.json"), JSON.stringify({ jobDir }));
    writeFileSync(join(stateDir, "latest-job.json"), JSON.stringify({ jobDir, reattach }));
    const outputPath = join(jobDir, "output.log");
    const log = openSync(outputPath, "a", 0o600);
    let workerExit: string | undefined;
    try {
      const child = spawn(process.execPath, ["--experimental-strip-types", join(workerDir, "restart-helper.ts"), jobDir], {
        detached: true,
        cwd: jobDir,
        env: environmentOutsideHerdr(process.env),
        stdio: ["ignore", log, log],
      });
      child.once("exit", (code, signal) => {
        workerExit = signal ? `signal ${signal}` : `exit ${code}`;
      });
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", resolve);
      });
      child.unref();
      launched = true;
    } finally {
      closeSync(log);
    }
    console.log(`\nDetached updater started. Log: ${outputPath}`);
    console.log("Closing this popup does not cancel the confirmed update.");
    const logReader = openSync(outputPath, "r");
    const buffer = Buffer.allocUnsafe(16 * 1024);
    const decoder = new TextDecoder();
    try {
      while (true) {
        let count: number;
        while ((count = readSync(logReader, buffer)) > 0) {
          process.stdout.write(decoder.decode(buffer.subarray(0, count), { stream: true }));
        }
        let state: { phase: string; message: string; error?: string } | undefined;
        try {
          state = JSON.parse(readFileSync(join(jobDir, "status.json"), "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (state && ["awaiting-reconnect", "complete", "failed"].includes(state.phase)) {
          console.log(state.message);
          if (state.error) console.error(state.error);
          if (state.phase === "failed") process.exitCode = 1;
          break;
        }
        if (workerExit) {
          try {
            const owner = JSON.parse(readFileSync(join(activeDir, "job.json"), "utf8"));
            if (owner.jobDir === jobDir) rmSync(activeDir, { recursive: true, force: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          throw new Error(`Updater stopped (${workerExit}) without a final result. Inspect ${outputPath}.`);
        }
        await delay(500);
      }
    } finally {
      closeSync(logReader);
    }
  } finally {
    if (!launched) rmSync(activeDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
if (process.stdin.isTTY && process.exitCode) {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await input.question("Press Enter to close.");
  } catch {
  } finally {
    input.close();
  }
}
