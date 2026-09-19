// Unit tests for durable relative-rank helpers.
//   node --experimental-strip-types --test tools/linear-ranks.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { pairKey, type ComparisonCache, type Ticket } from "./prioritize-core.ts";
import {
  assignRankWeights,
  comparisonsFromRanks,
  mergeComparisonCaches,
  overlappingComparisons,
  pickRankStorage,
  projectSetLabel,
  readRankFromDescription,
  sameProjectSet,
  stripRankComment,
  ticketRank,
  writeRankIntoDescription,
} from "./linear-ranks.ts";

function ticket(id: string, extra: Record<string, unknown> = {}): Ticket {
  return { id, title: id, ...extra };
}

test("readRankFromDescription parses the HTML comment weight", () => {
  assert.equal(readRankFromDescription("Hello\n\n<!-- rank: 4 -->"), 4);
  assert.equal(readRankFromDescription("<!--rank: -2.5-->"), -2.5);
  assert.equal(readRankFromDescription("no tag"), undefined);
});

test("writeRankIntoDescription appends or replaces the comment without touching the face", () => {
  assert.equal(writeRankIntoDescription("", 3), "<!-- rank: 3 -->");
  assert.equal(
    writeRankIntoDescription("Visible body", 2),
    "Visible body\n\n<!-- rank: 2 -->",
  );
  assert.equal(
    writeRankIntoDescription("Visible body\n\n<!-- rank: 1 -->", 9),
    "Visible body\n\n<!-- rank: 9 -->",
  );
  assert.equal(stripRankComment("Visible body\n\n<!-- rank: 9 -->"), "Visible body");
});

test("ticketRank prefers an explicit relativeRank, then field, then comment", () => {
  assert.equal(ticketRank(ticket("A", { relativeRank: 7 })), 7);
  assert.equal(
    ticketRank(ticket("B", { customFields: [{ name: "Relative Rank", value: 5 }] })),
    5,
  );
  assert.equal(ticketRank(ticket("C", { description: "x <!-- rank: 2 -->" })), 2);
  assert.equal(ticketRank(ticket("D")), undefined);
});

test("pickRankStorage uses a matching custom number field when one exists", () => {
  const field = pickRankStorage([
    { id: "other", name: "Story points" },
    { id: "rank-id", name: "Relative Rank" },
  ]);
  assert.deepEqual(field, { kind: "field", field: { id: "rank-id", name: "Relative Rank" } });
  assert.deepEqual(pickRankStorage([]), { kind: "comment" });
});

test("comparisonsFromRanks reconstructs a total order from weights", () => {
  const tickets = [
    ticket("b", { relativeRank: 1 }),
    ticket("a", { relativeRank: 3 }),
    ticket("c", { relativeRank: 2 }),
  ];
  const cache = comparisonsFromRanks(tickets);
  assert.equal(cache[pairKey("a", "b")], "left"); // a (3) beats b (1)
  assert.equal(cache[pairKey("a", "c")], "left");
  assert.equal(cache[pairKey("b", "c")], "right"); // c (2) beats b (1)
});

test("comparisonsFromRanks ignores tickets without a weight", () => {
  const cache = comparisonsFromRanks([
    ticket("a", { relativeRank: 2 }),
    ticket("new"),
  ]);
  assert.deepEqual(cache, {});
});

test("overlappingComparisons keeps pairs that still exist after membership changes", () => {
  const cache: ComparisonCache = {
    [pairKey("a", "b")]: "left",
    [pairKey("a", "c")]: "left",
    [pairKey("b", "c")]: "right",
  };
  const afterRemoval = overlappingComparisons(cache, ["a", "b"]);
  assert.deepEqual(afterRemoval, { [pairKey("a", "b")]: "left" });
  const afterAddition = overlappingComparisons(cache, ["a", "b", "c", "d"]);
  assert.deepEqual(afterAddition, cache);
});

test("mergeComparisonCaches lets later local outcomes win", () => {
  const fromLinear: ComparisonCache = { [pairKey("a", "b")]: "left" };
  const local: ComparisonCache = { [pairKey("a", "b")]: "right", [pairKey("a", "c")]: "tie" };
  assert.deepEqual(mergeComparisonCaches(fromLinear, local), {
    [pairKey("a", "b")]: "right",
    [pairKey("a", "c")]: "tie",
  });
});

test("assignRankWeights gives the best ticket the highest weight", () => {
  const ranked = [ticket("best"), ticket("mid")];
  const all = [...ranked, ticket("rest")];
  assert.deepEqual(assignRankWeights(ranked, all), {
    best: 2,
    mid: 1,
    rest: 0,
  });
});

test("sameProjectSet compares project lists without regard to order", () => {
  assert.equal(sameProjectSet(["Saddle", "Creatordex"], ["Creatordex", "Saddle"]), true);
  assert.equal(sameProjectSet(["Creatordex"], ["Saddle"]), false);
  assert.equal(sameProjectSet(undefined, []), true);
  assert.equal(projectSetLabel(["Creatordex", "Saddle"]), "Creatordex, Saddle");
});
