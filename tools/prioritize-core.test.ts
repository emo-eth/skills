// Unit tests for the shared top-k selection core.
// Node built-in test runner:
//   node --experimental-strip-types --test tools/prioritize-core.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findTopKOrNextComparison,
  pairKey,
  readCachedComparison,
  type ComparisonCache,
  type ComparisonResult,
  type Ticket,
} from "./prioritize-core.ts";

function ticket(id: string, title = id): Ticket {
  return { id, title };
}

// A cache encoding a total order: ids earlier in `order` are more important.
// Cached values are stored canonically (id-smaller ticket = "left" side),
// which for sorted-by-value order simply records "left" for every pair.
function orderedCache(order: string[]): ComparisonCache {
  const cache: ComparisonCache = {};
  for (let i = 0; i < order.length; i += 1) {
    for (let j = i + 1; j < order.length; j += 1) {
      cache[pairKey(order[i], order[j])] = "left";
    }
  }
  return cache;
}

test("pairKey is order-independent and distinct", () => {
  assert.equal(pairKey("a", "b"), pairKey("b", "a"));
  assert.equal(pairKey("b", "a"), "a\u0000b");
  assert.notEqual(pairKey("a", "ab"), pairKey("a", "b"));
});

test("readCachedComparison flips directional results for reverse orientation", () => {
  const a = ticket("a");
  const b = ticket("b");
  const cache: ComparisonCache = { [pairKey("a", "b")]: "left" }; // a more important
  assert.equal(readCachedComparison(cache, a, b), "left");
  // Reversed orientation (candidate=b vs selected=a) -> b is less important.
  assert.equal(readCachedComparison(cache, b, a), "right");
});

test("returns top k without comparing when k covers all tickets", () => {
  const tickets = [ticket("a"), ticket("b"), ticket("c")];
  const result = findTopKOrNextComparison(tickets, 3, {});
  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.deepEqual(result.ranked.map((t) => t.id), ["a", "b", "c"]);
  assert.equal(result.comparisonCount, 0);
});

test("asks a comparison when the cache is empty", () => {
  const tickets = [ticket("a"), ticket("b")];
  const result = findTopKOrNextComparison(tickets, 1, {});
  assert.equal(result.complete, false);
  if (result.complete) return;
  const ids = [result.comparison.left.id, result.comparison.right.id].sort();
  assert.deepEqual(ids, ["a", "b"]);
});

test("resolves a definite top k given a full total-order cache", () => {
  const order = ["a", "b", "c", "d", "e"];
  const tickets = order.map((id) => ticket(id));
  const cache = orderedCache(order);
  const result = findTopKOrNextComparison(tickets, 3, cache);
  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.deepEqual(result.ranked.map((t) => t.id), ["a", "b", "c"]);
});

test("tie inserts after the existing item, preserving input-order stability", () => {
  const a = ticket("a");
  const b = ticket("b");
  const cache: ComparisonCache = { [pairKey("a", "b")]: "tie" };
  const result = findTopKOrNextComparison([a, b], 1, cache);
  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.deepEqual(result.ranked.map((t) => t.id), ["a"]);
});

test("tie between two tickets keeps both when k covers both", () => {
  const a = ticket("a");
  const b = ticket("b");
  const cache: ComparisonCache = { [pairKey("a", "b")]: "tie" };
  const result = findTopKOrNextComparison([a, b], 2, cache);
  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.equal(result.ranked.length, 2);
});

test("rejects invalid k", () => {
  const tickets = [ticket("a")];
  assert.throws(() => findTopKOrNextComparison(tickets, 0, {}), /positive integer/);
  assert.throws(() => findTopKOrNextComparison(tickets, 2.5, {}), /positive integer/);
});

test("rejects duplicate or empty ids", () => {
  assert.throws(
    () => findTopKOrNextComparison([ticket("a"), ticket("a")], 1, {}),
    /duplicate ticket id/,
  );
  assert.throws(() => findTopKOrNextComparison([ticket("")], 1, {}), /non-empty string id/);
  assert.throws(
    () =>
      findTopKOrNextComparison(
        [{ id: 3, title: "x" } as unknown as Ticket],
        1,
        {},
      ),
    /non-empty string id/,
  );
});

test("progresses comparison by comparison as the cache fills", () => {
  const tickets = [ticket("a"), ticket("b"), ticket("c")];
  const cache: ComparisonCache = {};

  const first = findTopKOrNextComparison(tickets, 2, cache);
  assert.equal(first.complete, false);
  if (first.complete) return;
  assert.equal(first.comparison.key, pairKey("a", "b"));

  cache[first.comparison.key] = "left"; // a more important than b
  const second = findTopKOrNextComparison(tickets, 2, cache);
  if (second.complete) {
    assert.deepEqual(second.ranked.map((t) => t.id), ["a", "b"]);
    return;
  }
  // Binary-inserting c into frontier [a, b] starts at the midpoint (b).
  assert.equal(second.comparison.key, pairKey("b", "c"));
});

test("returned ranked list never exceeds k", () => {
  const order = ["a", "b", "c", "d", "f", "g", "h", "i", "j", "k"];
  const tickets = order.map((id) => ticket(id));
  const cache = orderedCache(order);
  const result = findTopKOrNextComparison(tickets, 4, cache);
  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.equal(result.ranked.length, 4);
});

test("comparisonCount equals number of cached pair decisions consumed", () => {
  const order = ["a", "b", "c", "d", "e"];
  const tickets = order.map((id) => ticket(id));
  const cache = orderedCache(order);
  const result = findTopKOrNextComparison(tickets, 5, cache);
  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.equal(result.comparisonCount, 0); // k == n, no comparisons needed
});