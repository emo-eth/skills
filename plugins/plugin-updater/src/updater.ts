import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Interface } from "node:readline/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  SELF_PLUGIN_ID,
  collectOutcomes,
  firstLine,
  formatReport,
  installSpec,
  minHerdrHint,
  reinstallArgs,
  resolveHerdrBinary,
  runCommand,
  shortSha,
  sortForUpdate,
  type CheckOutcome,
} from "./core.ts";

const herdrBinary = resolveHerdrBinary();

function stateLog(message: string): void {
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

function spawnVisible(
  executable: string,
  args: string[],
): Promise<{ status: number | null; stderr: string }> {
  const { promise, resolve } = Promise.withResolvers<{
    status: number | null;
    stderr: string;
  }>();
  const child = spawn(executable, args, {
    env: process.env,
    stdio: ["ignore", "inherit", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.once("error", (error: Error) => resolve({ status: null, stderr: error.message }));
  child.once("close", (code: number | null) => resolve({ status: code, stderr }));
  return promise;
}

function printPreview(outcome: CheckOutcome): void {
  console.log(`-- ${outcome.pluginId}  (${installSpec(outcome.source)})`);
  console.log(
    `   commit   ${shortSha(outcome.source.resolved_commit)} -> ${shortSha(outcome.remoteSha)}`,
  );
  if (outcome.preview?.installedVersion || outcome.preview?.remoteVersion) {
    console.log(
      `   version  ${outcome.preview.installedVersion ?? "?"} -> ${outcome.preview.remoteVersion ?? "?"}`,
    );
  }
  if (outcome.preview?.changedFiles) {
    console.log(`   files    ${outcome.preview.changedFiles}`);
  }
  console.log("");
}

async function reinstall(outcome: CheckOutcome): Promise<boolean> {
  const args = reinstallArgs(outcome);
  console.log(`\n==> ${herdrBinary} ${args.join(" ")}`);
  const result = await spawnVisible(herdrBinary, args);
  if (result.status === 0) {
    console.log(`${outcome.pluginId} updated.`);
    stateLog(`updated ${outcome.pluginId} to ${shortSha(outcome.remoteSha)}`);
    return true;
  }
  const stderr = result.stderr.trim();
  console.error(`${outcome.pluginId} update FAILED (exit ${result.status ?? "signal"}):`);
  console.error(stderr || "no error output");
  const hint = minHerdrHint(stderr);
  if (hint) {
    console.error(`Hint: ${hint}`);
  }
  stateLog(`failed ${outcome.pluginId}: ${firstLine(stderr) || "no error output"}`);
  return false;
}

async function scheduleSelfUpdate(outcome: CheckOutcome): Promise<void> {
  const helperPath = fileURLToPath(new URL("./self-update.ts", import.meta.url));
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", helperPath, ...reinstallArgs(outcome)],
    { detached: true, env: process.env, stdio: "ignore" },
  );
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  child.once("error", reject);
  child.once("spawn", resolve);
  await promise;
  child.unref();
  console.log(
    `${SELF_PLUGIN_ID} will reinstall itself after this window closes ` +
      `(${shortSha(outcome.source.resolved_commit)} -> ${shortSha(outcome.remoteSha)}).`,
  );
  stateLog(`scheduled self-update to ${shortSha(outcome.remoteSha)}`);
}

async function ask(input: Interface, prompt: string): Promise<string> {
  try {
    return await input.question(prompt);
  } catch {
    // EOF or a closed popup: an unanswered prompt always counts as No.
    return "";
  }
}

async function main(): Promise<void> {
  console.log("Collecting plugin update information...");
  const { outcomes, localCount } = await collectOutcomes(runCommand, herdrBinary);
  console.log(formatReport(outcomes, localCount));
  const behind = outcomes.filter((outcome) => outcome.classification === "behind");
  if (behind.length === 0) {
    console.log("Nothing to update.");
    return;
  }
  console.log("");
  for (const outcome of behind) {
    printPreview(outcome);
  }

  if (process.stdin.isTTY !== true) {
    console.log(
      "Refusing to update: no interactive terminal is attached, so updates cannot be confirmed.",
    );
    console.log(
      "Run this plugin's `update` action from a Herdr session, then confirm in the popup.",
    );
    process.exitCode = 1;
    return;
  }


  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const mode = (await ask(
      input,
      "Apply updates? (a) all listed, (s) choose individually, Enter or anything else cancels: ",
    ))
      .trim()
      .toLowerCase();
    let selected: CheckOutcome[];
    if (mode === "a") {
      selected = [...behind];
    } else if (mode === "s") {
      selected = [];
      for (const outcome of behind) {
        const answer = (
          await ask(
            input,
            `Update ${outcome.pluginId} ${shortSha(outcome.source.resolved_commit)} -> ${shortSha(outcome.remoteSha)}? [y/N] `,
          )
        )
          .trim()
          .toLowerCase();
        if (answer === "y" || answer === "yes") {
          selected.push(outcome);
        }
      }
    } else {
      console.log("Cancelled. Nothing was installed.");
      return;
    }

    selected = sortForUpdate(selected);
    if (selected.length === 0) {
      console.log("Nothing selected. Nothing was installed.");
      return;
    }

    let updated = 0;
    let failed = 0;
    let scheduled = 0;
    for (const outcome of selected) {
      if (outcome.pluginId === SELF_PLUGIN_ID) {
        continue;
      }
      if (await reinstall(outcome)) {
        updated += 1;
      } else {
        failed += 1;
      }
    }
    const self = selected.find((outcome) => outcome.pluginId === SELF_PLUGIN_ID);
    if (self) {
      await scheduleSelfUpdate(self);
      scheduled += 1;
    }

    console.log("");
    const summary =
      `${updated} updated, ${scheduled} self-update${scheduled === 1 ? "" : "s"} scheduled, ` +
      `${failed} failed`;
    if (failed === 0) {
      console.log(`Done: ${summary}.`);
    } else {
      console.log(`Done with failures: ${summary}.`);
      process.exitCode = 1;
    }
    if (updated + scheduled > 0) {
      console.log("\nRe-checking installed state...");
      const fresh = await collectOutcomes(runCommand, herdrBinary);
      console.log(formatReport(fresh.outcomes, fresh.localCount));
    }
  } finally {
    input.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
