import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "check-plan.mjs");
const PLAYBOOK = join(import.meta.dir, "../playbooks/multi-phase-plan.md");
const directories: string[] = [];

async function planSkeleton(): Promise<string> {
  const playbook = await readFile(PLAYBOOK, "utf8");
  const match = playbook.match(/````markdown\n([\s\S]*?)\n````/);
  if (!match) {
    throw new Error("multi-phase plan skeleton is missing");
  }
  return `${match[1]}\n`;
}

async function runPlan(contents: string): Promise<{
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "pstack-plan-"));
  directories.push(directory);
  const plan = join(directory, "plan.md");
  await writeFile(plan, contents);
  const result = Bun.spawnSync(["node", SCRIPT, plan]);
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("check-plan", () => {
  it("accepts the bundled plan skeleton", async () => {
    const result = await runPlan(await planSkeleton());

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("1 PR sections, 0 problems");
    expect(result.stderr).toBe("");
  });

  it("rejects a live block without lanes one through ten", async () => {
    const invalid = (await planSkeleton()).replace("Lane 10.", "Lane 11.");
    const result = await runPlan(invalid);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("expected 1 to 10");
  });
});
