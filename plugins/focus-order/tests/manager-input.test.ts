import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitManagerInput } from "../src/herdr/manager-input.ts";

describe("manager input", () => {
  it("handles every arrow when repeated escape sequences share one chunk", () => {
    assert.deepEqual(
      splitManagerInput("\u001b[B\u001b[B\u001b[B"),
      ["\u001b[B", "\u001b[B", "\u001b[B"],
    );
  });

  it("normalizes application-mode arrows and preserves unsupported sequences", () => {
    assert.deepEqual(
      splitManagerInput("\u001bOB\u001bOA\u001b[1;2B"),
      ["\u001b[B", "\u001b[A", "\u001b[1;2B"],
    );
  });

  it("handles multiple single-character commands from one chunk", () => {
    assert.deepEqual(splitManagerInput("jjk"), ["j", "j", "k"]);
  });
});
