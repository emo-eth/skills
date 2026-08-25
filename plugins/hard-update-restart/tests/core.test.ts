import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRestartableServerStatus,
  performRefresh,
  restartHerdr,
  updatePlan,
  type PlannedCommand,
} from "../src/core.ts";

test("the default plan updates only the three runtimes", () => {
  assert.deepEqual(updatePlan(false, "/opt/herdr"), [
    { label: "OMP", executable: "omp", args: ["update"] },
    { label: "Pi", executable: "pi", args: ["update", "--self"] },
    { label: "Herdr", executable: "/opt/herdr", args: ["update"] },
  ]);
});

test("the extension plan updates OMP plugins and Pi extensions", () => {
  assert.deepEqual(updatePlan(true, "/opt/herdr"), [
    { label: "OMP", executable: "omp", args: ["update"] },
    { label: "OMP plugins", executable: "omp", args: ["update", "--plugins"] },
    { label: "Pi and extensions", executable: "pi", args: ["update", "--all"] },
    { label: "Herdr", executable: "/opt/herdr", args: ["update"] },
  ]);
});

test("a failed update prevents later updates and the hard restart", async () => {
  const ran: string[] = [];
  let restartScheduled = false;

  await assert.rejects(
    performRefresh(false, "herdr", {
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
    performRefresh(false, "herdr", {
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

  await performRefresh(true, "herdr", {
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
    "Herdr",
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
    start: async () => {
      events.push("start");
    },
    waitUntilReady: async () => {
      events.push("ready");
    },
  });

  assert.deepEqual(events, ["delay", "stop", "start", "ready"]);
});
