import assert from "node:assert/strict";
import test from "node:test";
import { isObservedNativeAbort } from "../src/native-abort.ts";

test("native abort observation accepts structured or executor-specific cancellation evidence", () => {
  assert.equal(isObservedNativeAbort({ status: "aborted" }), true);
  assert.equal(isObservedNativeAbort({ result: { details: { cancelled: true } } }), true);
  assert.equal(isObservedNativeAbort({ isError: true, content: [{ type: "text", text: "[Command cancelled]" }] }), true);
  assert.equal(isObservedNativeAbort({ isError: true, message: "Operation aborted" }), true);
});

test("native abort observation rejects loose cancellation language", () => {
  assert.equal(isObservedNativeAbort({ message: "The user cancelled a planned meeting" }), false);
  assert.equal(isObservedNativeAbort({ message: "Cancellation may be needed" }), false);
  assert.equal(isObservedNativeAbort({ isError: false, content: "Command cancelled" }), false);
});
