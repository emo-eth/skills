import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendSkiterateNote, modelName, parseCommandArgs } from "../src/record.ts";

test("command arguments accept an optional skill and preserve note text", () => {
  assert.deepEqual(parseCommandArgs("--skill lc-ticketize fix the acceptance note"), {
    skill: "lc-ticketize",
    note: "fix the acceptance note",
  });
  assert.deepEqual(parseCommandArgs("capture this\nwithout ceremony"), {
    note: "capture this without ceremony",
  });
  assert.throws(() => parseCommandArgs("--skill"), /Usage: \/skiterate/);
});

test("append honors SKITERATE_PATH and writes one JSON record with metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "skiterate-record-"));
  const destination = join(root, "notes", "SKITERATE.md");
  try {
    const record = await appendSkiterateNote({
      note: "the skill needed a clearer proof\nstep",
      cwd: "/repo/worktree",
      agent: "Pi",
      model: { provider: "openai", id: "gpt-test" },
      skill: "lc-ticketize",
      env: { SKITERATE_PATH: destination },
      now: new Date("2026-08-13T12:34:56.000Z"),
      git: {
        repo: "https://github.com/emo-eth/skills",
        worktree: "/repo/worktree",
        branch: "skiterate",
      },
    });

    const lines = (await readFile(destination, "utf8")).trimEnd().split("\n");
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.startsWith("- "), true);
    assert.deepEqual(JSON.parse(lines[0]!.slice(2)), record);
    assert.deepEqual(record, {
      datetime: "2026-08-13T12:34:56.000Z",
      repo: "https://github.com/emo-eth/skills",
      worktree: "/repo/worktree",
      branch: "skiterate",
      cwd: "/repo/worktree",
      agent: "Pi",
      model: "openai/gpt-test",
      skill: "lc-ticketize",
      note: "the skill needed a clearer proof step",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model metadata uses the host model id when provider is absent", () => {
  assert.equal(modelName({ id: "gpt-test" }), "gpt-test");
  assert.equal(modelName(undefined), undefined);
});
