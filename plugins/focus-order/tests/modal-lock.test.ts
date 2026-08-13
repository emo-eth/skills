import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  claimOwner,
  markerPath,
  popupOpen,
  readOwner,
  releaseOwner,
} from "../src/shared/modal-lock.ts";

const previousStateDir = process.env.HERDR_PLUGIN_STATE_DIR;
const temporaryDirectories: string[] = [];

afterEach(() => {
  if (previousStateDir === undefined) delete process.env.HERDR_PLUGIN_STATE_DIR;
  else process.env.HERDR_PLUGIN_STATE_DIR = previousStateDir;
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function useTemporaryStateDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "focus-order-modal-lock-"));
  temporaryDirectories.push(path);
  process.env.HERDR_PLUGIN_STATE_DIR = path;
  return path;
}

describe("attention popup ownership", () => {
  it("claims an empty marker atomically and releases only its owner", () => {
    useTemporaryStateDirectory();

    const owner = claimOwner();
    assert.ok(owner);
    assert.equal(owner.pid, process.pid);
    assert.deepEqual(readOwner(), owner);
    assert.equal(popupOpen(), true);

    releaseOwner({ pid: owner.pid + 1, started_at: owner.started_at });
    assert.deepEqual(readOwner(), owner);

    releaseOwner(owner);
    assert.equal(readOwner(), undefined);
    assert.equal(popupOpen(), false);
  });

  it("does not replace a live owner", () => {
    useTemporaryStateDirectory();
    const existing = { pid: process.pid, started_at: Date.now() - 1 };
    writeFileSync(markerPath(), `${JSON.stringify(existing)}\n`, "utf8");

    assert.equal(claimOwner(), undefined);
    assert.deepEqual(readOwner(), existing);
  });

  it("removes malformed and dead markers before claiming", () => {
    const directory = useTemporaryStateDirectory();
    writeFileSync(markerPath(), "not-json\n", "utf8");
    assert.equal(popupOpen(), false);
    assert.equal(readOwner(), undefined);

    writeFileSync(
      markerPath(),
      `${JSON.stringify({ pid: 999_999_999, started_at: Date.now() })}\n`,
      "utf8",
    );
    const owner = claimOwner();
    assert.ok(owner);
    assert.deepEqual(readOwner(), owner);
    assert.equal(
      readFileSync(join(directory, "attention-owner.json"), "utf8"),
      `${JSON.stringify(owner)}\n`,
    );
  });
});
