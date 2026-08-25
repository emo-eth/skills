import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertRestartableServerStatus,
  environmentOutsideHerdr,
  performRefresh,
  restartHerdr,
  updatePlan,
  type PlannedCommand,
} from "../src/core.ts";

const FAKE_HERDR = `#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.FAKE_HERDR_ROOT;
if (!root) process.exit(90);
const command = process.argv.slice(2).join(" ");
appendFileSync(
  join(root, "calls.log"),
  command + " HERDR_ENV=" + (process.env.HERDR_ENV ?? "unset") + "\\n",
);
if (command === "server stop") process.exit(0);
if (command === "update") process.exit(process.env.HERDR_ENV === "1" ? 91 : 0);
if (command === "server") {
  writeFileSync(join(root, "ready"), "ready");
  process.exit(0);
}
if (command === "status server --json") {
  console.log(JSON.stringify({
    status: existsSync(join(root, "ready")) ? "running" : "not_running",
    version: "test",
  }));
  process.exit(0);
}
process.exit(92);
`;

test("the default in-session plan updates OMP and Pi", () => {
  assert.deepEqual(updatePlan(false), [
    { label: "OMP", executable: "omp", args: ["update"] },
    { label: "Pi", executable: "pi", args: ["update", "--self"] },
  ]);
});

test("the extension plan updates OMP plugins and Pi extensions", () => {
  assert.deepEqual(updatePlan(true), [
    { label: "OMP", executable: "omp", args: ["update"] },
    { label: "OMP plugins", executable: "omp", args: ["update", "--plugins"] },
    { label: "Pi and extensions", executable: "pi", args: ["update", "--all"] },
  ]);
});

test("a failed update prevents later updates and the hard restart", async () => {
  const ran: string[] = [];
  let restartScheduled = false;

  await assert.rejects(
    performRefresh(false, {
      preflight: async () => {
        ran.push("preflight");
      },
      run: async (command: PlannedCommand) => {
        ran.push(command.label);
        if (command.label === "Pi") {
          throw new Error("Pi failed");
        }
      },
      scheduleRestart: async () => {
        restartScheduled = true;
      },
    }),
    /Pi failed/,
  );

  assert.deepEqual(ran, ["preflight", "OMP", "Pi"]);
  assert.equal(restartScheduled, false);
});

test("a failed preflight does not mutate runtimes", async () => {
  let updateRan = false;
  let restartScheduled = false;

  await assert.rejects(
    performRefresh(false, {
      preflight: async () => {
        throw new Error("no persistent server");
      },
      run: async () => {
        updateRan = true;
      },
      scheduleRestart: async () => {
        restartScheduled = true;
      },
    }),
    /no persistent server/,
  );

  assert.equal(updateRan, false);
  assert.equal(restartScheduled, false);
});

test("a successful refresh schedules restart only after every update", async () => {
  const events: string[] = [];

  await performRefresh(true, {
    preflight: async () => {
      events.push("preflight");
    },
    run: async (command: PlannedCommand) => {
      events.push(command.label);
    },
    scheduleRestart: async () => {
      events.push("restart");
    },
  });

  assert.deepEqual(events, [
    "preflight",
    "OMP",
    "OMP plugins",
    "Pi and extensions",
    "restart",
  ]);
});

test("server preflight requires a running detached daemon", () => {
  assert.doesNotThrow(() => {
    assertRestartableServerStatus(
      JSON.stringify({
        status: "running",
        running: true,
        capabilities: { detached_server_daemon: true },
      }),
    );
  });
  assert.throws(
    () => {
      assertRestartableServerStatus(
        JSON.stringify({
          status: "not_running",
          running: false,
          capabilities: { detached_server_daemon: true },
        }),
      );
    },
    /persistent Herdr server is not running/,
  );
  assert.throws(
    () => {
      assertRestartableServerStatus(
        JSON.stringify({
          status: "running",
          running: true,
          capabilities: { detached_server_daemon: false },
        }),
      );
    },
    /cannot launch a detached replacement/,
  );
});

test("hard restart stops the old server before starting and checking the new one", async () => {
  const events: string[] = [];

  await restartHerdr({
    delay: async () => {
      events.push("delay");
    },
    stop: async () => {
      events.push("stop");
    },
    update: async () => {
      events.push("update");
    },
    start: async () => {
      events.push("start");
    },
    waitUntilReady: async () => {
      events.push("ready");
    },
  });

  assert.deepEqual(events, ["delay", "stop", "update", "start", "ready"]);
});

test("a failed Herdr update still restarts the server before reporting failure", async () => {
  const events: string[] = [];

  await assert.rejects(
    restartHerdr({
      delay: async () => {
        events.push("delay");
      },
      stop: async () => {
        events.push("stop");
      },
      update: async () => {
        events.push("update");
        throw new Error("Herdr update failed");
      },
      start: async () => {
        events.push("start");
      },
      waitUntilReady: async () => {
        events.push("ready");
      },
    }),
    /Herdr update failed/,
  );

  assert.deepEqual(events, ["delay", "stop", "update", "start", "ready"]);
});

test("the detached Herdr update removes the nested-session marker only from its copy", () => {
  const original = {
    HERDR_ENV: "1",
    HERDR_SOCKET_PATH: "/tmp/herdr.sock",
  };

  assert.deepEqual(environmentOutsideHerdr(original), {
    HERDR_SOCKET_PATH: "/tmp/herdr.sock",
  });
  assert.equal(original.HERDR_ENV, "1");
});

test("the detached helper updates Herdr after stop without the nested marker", { timeout: 10_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "hard-update-restart-"));
  const fakeHerdr = join(root, "herdr");
  const stateDir = join(root, "state");
  const helperPath = fileURLToPath(new URL("../src/restart-helper.ts", import.meta.url));

  try {
    await writeFile(fakeHerdr, FAKE_HERDR);
    await chmod(fakeHerdr, 0o755);

    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", helperPath],
      {
        env: {
          ...process.env,
          FAKE_HERDR_ROOT: root,
          HERDR_BIN_PATH: fakeHerdr,
          HERDR_ENV: "1",
          HERDR_PLUGIN_STATE_DIR: stateDir,
        },
        stdio: "ignore",
      },
    );
    const { promise, resolve, reject } = Promise.withResolvers<number | null>();
    child.once("error", reject);
    child.once("exit", resolve);
    assert.equal(await promise, 0);

    const calls = await readFile(join(root, "calls.log"), "utf8");
    assert.match(
      calls,
      /^server stop HERDR_ENV=1\nupdate HERDR_ENV=unset\nserver HERDR_ENV=1\nstatus server --json HERDR_ENV=1\n$/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
