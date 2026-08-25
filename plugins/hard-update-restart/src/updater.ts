import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  assertRestartableServerStatus,
  performRefresh,
  resolveHerdrBinary,
  unsettledAgentsFromList,
  waitForAgentDrain,
  type AgentDrainPhase,
  type PlannedCommand,
  type UnsettledAgent,
} from "./core.ts";

const includeExtensions = process.argv.includes("--extensions");
const herdrBinary = resolveHerdrBinary();

async function confirmRestart(): Promise<boolean> {
  console.log("Update Herdr, OMP, and Pi, then hard-restart the Herdr server.");
  console.log(
    includeExtensions
      ? "Installed OMP plugins and Pi extensions will also be updated."
      : "Installed OMP plugins and Pi extensions will not be updated.",
  );
  console.log("");
  console.log("The restart stops every pane. Supported agent sessions will resume with the new runtimes.");
  console.log("Working, blocked, and unknown agents must become idle or done before updates and restart.");
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

function readUnsettledAgents(): Promise<UnsettledAgent[]> {
  const listed = spawnSync(herdrBinary, ["agent", "list"], {
    encoding: "utf8",
    env: process.env,
  });
  if (listed.status !== 0) {
    throw new Error(listed.stderr.trim() || "failed to read Herdr agent states");
  }
  return Promise.resolve(unsettledAgentsFromList(listed.stdout));
}

function pauseForAgentCheck(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 1_000);
  return promise;
}

async function waitForAgents(phase: AgentDrainPhase): Promise<void> {
  let announced = false;
  await waitForAgentDrain({
    read: readUnsettledAgents,
    delay: pauseForAgentCheck,
    onChange: (agents) => {
      announced = true;
      const boundary = phase === "before_updates" ? "updates" : "restart";
      console.log(`\nWaiting for active agents before ${boundary}. Ctrl+C cancels.`);
      for (const agent of agents) {
        const identity = agent.name || agent.paneId;
        const location = agent.cwd ? ` at ${agent.cwd}` : "";
        console.log(`- ${identity}: ${agent.agent} is ${agent.status}${location}`);
      }
    },
  });
  if (announced) {
    console.log("All active agents are now idle or done.");
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
    waitForAgents,
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
