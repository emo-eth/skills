import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  environmentOutsideHerdr,
  resolveHerdrBinary,
  restartHerdr,
} from "./core.ts";

const herdrBinary = resolveHerdrBinary();
const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;

function appendLog(message: string): void {
  if (!stateDir) {
    return;
  }
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(
    join(stateDir, "hard-update-restart.log"),
    `${new Date().toISOString()} ${message}\n`,
  );
}

function delay(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
}

try {
  await restartHerdr({
    delay: async () => {
      await delay(1_000);
    },
    stop: async () => {
      appendLog("stopping Herdr server");
      const stopped = spawnSync(herdrBinary, ["server", "stop"], {
        encoding: "utf8",
        env: process.env,
        timeout: 30_000,
      });
      if (stopped.status !== 0) {
        const detail = stopped.stderr.trim() || stopped.stdout.trim() || "unknown stop failure";
        throw new Error(detail);
      }
    },
    update: async () => {
      appendLog("updating Herdr outside the stopped session");
      const updated = spawnSync(herdrBinary, ["update"], {
        encoding: "utf8",
        env: environmentOutsideHerdr(process.env),
        timeout: 300_000,
      });
      if (updated.stdout.trim()) {
        appendLog(`Herdr update output:\n${updated.stdout.trim()}`);
      }
      if (updated.stderr.trim()) {
        appendLog(`Herdr update diagnostics:\n${updated.stderr.trim()}`);
      }
      if (updated.status !== 0) {
        throw new Error(
          updated.stderr.trim() || updated.stdout.trim() || "unknown Herdr update failure",
        );
      }
    },
    start: async () => {
      appendLog("starting replacement Herdr server");
      const server = spawn(herdrBinary, ["server"], {
        detached: true,
        env: process.env,
        stdio: "ignore",
      });
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      server.once("error", reject);
      server.once("spawn", resolve);
      await promise;
      server.unref();
    },
    waitUntilReady: async () => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const status = spawnSync(herdrBinary, ["status", "server", "--json"], {
          encoding: "utf8",
          env: process.env,
          timeout: 2_000,
        });
        if (status.status === 0) {
          try {
            const parsed = JSON.parse(status.stdout) as { status?: unknown; version?: unknown };
            if (parsed.status === "running") {
              appendLog(`replacement Herdr server ready at version ${String(parsed.version)}`);
              return;
            }
          } catch {
            // The server can become reachable before a complete status response is available.
          }
        }
        await delay(100);
      }
      throw new Error("replacement Herdr server did not become ready within 30 seconds");
    },
  });
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  appendLog(`hard restart failed: ${message}`);
  process.exitCode = 1;
}
