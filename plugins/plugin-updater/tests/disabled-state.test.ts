import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const UPDATER_PATH = fileURLToPath(new URL("../src/updater.ts", import.meta.url));

const FAKE_HERDR = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.FAKE_HERDR_ROOT;
if (!root) process.exit(90);
const statePath = join(root, "state.json");
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : { enabled: true };
const command = process.argv.slice(2).join(" ");
appendFileSync(join(root, "calls.log"), command + "\\n");
if (command === "plugin list --json") {
  console.log(JSON.stringify({
    id: "cli:plugin",
    result: {
      plugins: [{
        plugin_id: "demo",
        enabled: state.enabled,
        source: {
          kind: "github",
          owner: "octo",
          repo: "demo-plugin",
          resolved_commit: "${SHA_A}",
          managed_path: join(root, "managed", "demo"),
        },
      }],
    },
  }));
  process.exit(0);
}
if (command === "plugin install octo/demo-plugin --yes") {
  writeFileSync(statePath, JSON.stringify({ enabled: true }));
  process.exit(0);
}
if (command === "plugin disable demo") {
  writeFileSync(statePath, JSON.stringify({ enabled: false }));
  process.exit(0);
}
process.exit(92);
`;

const FAKE_GIT = `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args.startsWith("ls-remote --symref ")) {
  console.log("ref:\\trefs/heads/main\\tHEAD\\n${SHA_B}\\tHEAD\\n");
  process.exit(0);
}
if (args.startsWith("-C ") && args.includes(" fetch --quiet origin main")) process.exit(0);
if (args.startsWith("-C ") && args.includes(" diff --shortstat ")) {
  console.log("1 file changed, 2 insertions(+)");
  process.exit(0);
}
if (args.startsWith("-C ") && args.includes(":herdr-plugin.toml")) {
  console.log('[plugin]\\nversion = "0.1.0"');
  process.exit(0);
}
process.exit(93);
`;

async function runUpdaterScenario(initialEnabled: boolean): Promise<{
  calls: string[];
  finalEnabled: boolean | undefined;
  output: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "plugin-updater-disabled-"));
  const binDir = join(root, "bin");
  const managedDir = join(root, "managed", "demo");
  await mkdir(binDir);
  await mkdir(managedDir, { recursive: true });
  const fakeHerdr = join(root, "herdr");
  const fakeGit = join(binDir, "git");
  await writeFile(fakeHerdr, FAKE_HERDR);
  await writeFile(fakeGit, FAKE_GIT);
  await chmod(fakeHerdr, 0o755);
  await chmod(fakeGit, 0o755);
  await writeFile(
    join(root, "state.json"),
    JSON.stringify({ enabled: initialEnabled }),
  );

  const wrapper =
    "process.stdin.isTTY = true;" +
    "await import('file://' + process.env.UPDATER_ENTRY);";
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", wrapper],
    {
      cwd: root,
      env: {
        ...process.env,
        UPDATER_ENTRY: UPDATER_PATH,
        FAKE_HERDR_ROOT: root,
        HERDR_BIN_PATH: fakeHerdr,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += String(chunk);
  });
  child.stdin.end("a\n");
  const { promise, resolve, reject } = Promise.withResolvers<number | null>();
  child.once("error", reject);
  child.once("exit", resolve);
  const code = await promise;
  const callsFile = await readFile(join(root, "calls.log"), "utf8");
  const state = JSON.parse(
    await readFile(join(root, "state.json"), "utf8"),
  ) as { enabled: boolean | undefined };
  const output = stdout + stderr;
  await rm(root, { recursive: true, force: true });
  if (callsFile.trim() === "") {
    throw new Error(`updater exited ${code} without any Herdr calls: ${output}`);
  }
  return {
    calls: callsFile.trim().split("\n"),
    finalEnabled: state.enabled,
    output,
  };
}

test("updating a disabled plugin reinstalls it and then disables it again", { timeout: 30_000 }, async () => {
  const { calls, finalEnabled, output } = await runUpdaterScenario(false);
  const installAt = calls.indexOf("plugin install octo/demo-plugin --yes");
  const disableAt = calls.indexOf("plugin disable demo");
  assert.notEqual(installAt, -1, `no install in trace: ${output}`);
  assert.notEqual(disableAt, -1, `no disable in trace: ${output}`);
  assert.ok(disableAt > installAt, "disable must follow the install");
  assert.equal(finalEnabled, false);
  assert.match(output, /1 updated/);
  assert.doesNotMatch(output, /Done with failures/);
});

test("updating an enabled plugin never disables it", { timeout: 30_000 }, async () => {
  const { calls, finalEnabled, output } = await runUpdaterScenario(true);
  assert.ok(calls.includes("plugin install octo/demo-plugin --yes"));
  assert.equal(calls.includes("plugin disable demo"), false);
  assert.equal(finalEnabled, true);
  assert.match(output, /1 updated/);
  assert.doesNotMatch(output, /Done with failures/);
});
