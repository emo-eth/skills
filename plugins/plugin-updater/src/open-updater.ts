import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { resolveHerdrBinary } from "./core.ts";

const PLUGIN_ID = "plugin-updater";
const herdrBinary = resolveHerdrBinary();

function delay(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
}

function appendFailure(message: string): void {
  const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!stateDir) {
    return;
  }
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(
    join(stateDir, "plugin-updater.log"),
    `${new Date().toISOString()} popup failed: ${message}\n`,
  );
}

function openPane(): Promise<void> {
  const child = spawn(
    herdrBinary,
    [
      "plugin",
      "pane",
      "open",
      "--plugin",
      PLUGIN_ID,
      "--entrypoint",
      "updater",
      "--focus",
    ],
    { env: process.env, stdio: "ignore" },
  );
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
          ? `pane opener received ${signal}`
          : `pane opener exited ${code ?? "without a status"}`,
      ),
    );
  });
  return promise;
}

let lastError: unknown;
await delay(150);
for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    await openPane();
    process.exit(0);
  } catch (error: unknown) {
    lastError = error;
    await delay(100);
  }
}

const message = lastError instanceof Error ? lastError.message : String(lastError);
appendFailure(message);
process.exitCode = 1;
