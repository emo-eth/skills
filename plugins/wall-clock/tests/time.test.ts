import assert from "node:assert/strict";
import test from "node:test";
import { formatDurationMs, parseDeadlineSpec } from "../src/time.ts";

test("duration display does not round measured milliseconds up to a full second", () => {
  assert.equal(formatDurationMs(0), "0s");
  assert.equal(formatDurationMs(1), "1ms");
  assert.equal(formatDurationMs(999), "999ms");
  assert.equal(formatDurationMs(1_500), "1s 500ms");
  assert.equal(formatDurationMs(61_000), "1m 1s");
});

test("deadline parsing accepts precise positive millisecond durations", () => {
  assert.deepEqual(parseDeadlineSpec("1ms", 1_000), { durationMs: 1 });
  assert.throws(() => parseDeadlineSpec("0.1ms", 1_000), /positive/);
});
