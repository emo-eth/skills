import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { withContainedFileLock } from "../src/safe-fs.ts";

async function fixture(): Promise<{ root: string; target: string; lock: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-bots-lock-"));
  const target = path.join(root, "state.md");
  return { root, target, lock: `${target}.lock` };
}

test("a fresh abandoned lock blocks takeover", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  await mkdir(fx.lock);
  let ran = false;
  await assert.rejects(
    withContainedFileLock(fx.root, fx.target, async () => {
      ran = true;
    }, 20, 2_000),
    /timed out acquiring coordination lock/,
  );
  assert.equal(ran, false);
  assert.equal((await stat(fx.lock)).isDirectory(), true);
});


test("a killed lock holder is reclaimed after the stale boundary", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const script = [
    `const lockfile = require("proper-lockfile");`,
    `lockfile.lock(process.argv[1], { realpath: false, stale: 2000, update: 1000 })`,
    `  .then(() => { console.log("READY"); process.stdin.resume(); })`,
    `  .catch((error) => { console.error(error); process.exit(1); });`,
  ].join("\n");
  const child = spawn(process.execPath, ["-e", script, fx.target], {
    cwd: path.resolve("."),
    stdio: ["pipe", "pipe", "inherit"],
  });
  const outcome = await Promise.race([
    once(child.stdout!, "data").then(() => "ready"),
    once(child, "exit").then(() => "exit"),
  ]);
  assert.equal(outcome, "ready");
  child.kill("SIGKILL");
  await once(child, "exit");
  let ran = false;
  await withContainedFileLock(fx.root, fx.target, async () => {
    ran = true;
  }, 4_000, 2_000);
  assert.equal(ran, true);
});
