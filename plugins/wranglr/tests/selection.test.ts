import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anchorSelection, moveSelectionKey, viewportLines, type Selection } from "../src/herdr/selection.ts";

const ROWS = ["a", "b", "c", "d", "e"];

describe("anchorSelection", () => {
  const base: Selection = { section: "agents" };

  it("clears the key when the list is empty", () => {
    assert.deepEqual(anchorSelection([], { section: "agents", key: "a" }), { section: "agents" });
  });

  it("starts with the first row when no key is set", () => {
    assert.deepEqual(anchorSelection(ROWS, base), { section: "agents", key: "a" });
  });

  it("keeps a key that is still on the list", () => {
    assert.deepEqual(anchorSelection(ROWS, { section: "agents", key: "d" }), { section: "agents", key: "d" });
  });

  it("snaps a stale key to the first row and preserves the section", () => {
    assert.deepEqual(anchorSelection(ROWS, { section: "worktrees", key: "zzz" }), { section: "worktrees", key: "a" });
  });
});

describe("moveSelectionKey", () => {
  it("returns undefined on an empty list", () => {
    assert.equal(moveSelectionKey([], undefined, 1), undefined);
    assert.equal(moveSelectionKey([], "a", 1), undefined);
  });

  it("starts with the first row when no key is set", () => {
    assert.equal(moveSelectionKey(ROWS, undefined, 1), "a");
  });

  it("snaps a stale key that is no longer on the list to the first row", () => {
    assert.equal(moveSelectionKey(ROWS, "zzz", 1), "a");
  });

  it("moves down one row at a time from the first row", () => {
    assert.equal(moveSelectionKey(ROWS, "a", 1), "b");
  });

  it("visits every row in order exactly once on repeated down presses", () => {
    // The pane anchors the selection to the first row on open, then each
    // down press moves one row.
    let key = anchorSelection(ROWS, { section: "agents" }).key;
    const visited: Array<string | undefined> = [];
    for (let i = 0; i < ROWS.length; i++) {
      visited.push(key);
      key = moveSelectionKey(ROWS, key, 1);
    }
    assert.deepEqual(visited, ["a", "b", "c", "d", "e"]);
  });

  it("clamps at the last row instead of wrapping", () => {
    assert.equal(moveSelectionKey(ROWS, "e", 1), "e");
  });

  it("moves up symmetrically and clamps at the first row", () => {
    assert.equal(moveSelectionKey(ROWS, "c", -1), "b");
    assert.equal(moveSelectionKey(ROWS, "b", -1), "a");
    assert.equal(moveSelectionKey(ROWS, "a", -1), "a");
  });
});

describe("viewportLines", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => `line-${i}`);

  it("returns all lines when they fit the height", () => {
    assert.deepEqual(viewportLines(twenty, 0, 20), twenty);
    const short = ["a", "b", "c"];
    assert.deepEqual(viewportLines(short, 1, 10), short);
  });

  it("returns all lines for a non-positive height (nothing to clip to)", () => {
    assert.deepEqual(viewportLines(twenty, 0, 0), twenty);
  });

  it("starts at the top when there is no focus line", () => {
    assert.deepEqual(viewportLines(twenty, undefined, 5), twenty.slice(0, 5));
  });

  it("starts at the top when the focus line is out of range", () => {
    assert.deepEqual(viewportLines(twenty, 99, 5), twenty.slice(0, 5));
    assert.deepEqual(viewportLines(twenty, -1, 5), twenty.slice(0, 5));
  });

  it("keeps the focus line visible in the window", () => {
    const view = viewportLines(twenty, 15, 5);
    assert.equal(view.length, 5);
    assert.equal(view.includes("line-15"), true);
  });

  it("renders the head rather than the tail when content overflows", () => {
    const view = viewportLines(twenty, 0, 5);
    assert.deepEqual(view, ["line-0", "line-1", "line-2", "line-3", "line-4"]);
  });
});
