// Unit tests for the shared top-k selection core.
// Node built-in test runner:
//   node --experimental-strip-types --test tools/prioritize-core.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BIN_INITIAL_ELO,
  calculateEloUpdate,
  createInitialState,
  extractTriageSections,
  findTopKOrNextComparison,
  isHighConfidenceSettled,
  isTicketStale,
  nextQuestion,
  pairKey,
  readCachedComparison,
  recordBinAnswer,
  recordComparisonAnswer,
  truncateAtWord,
  wordWrap,
  computeWorstCaseComparisons,
  extractDeliverables,
  extractFiles,
  type BinName,
  type ComparisonCache,
  type ComparisonResult,
  type PrioritizeState,
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

test("calculateEloUpdate updates ratings based on outcome", () => {
  const { newEloA, newEloB } = calculateEloUpdate(1500, 1500, "left");
  assert.equal(newEloA, 1516);
  assert.equal(newEloB, 1484);

  const tie = calculateEloUpdate(1500, 1500, "tie");
  assert.equal(tie.newEloA, 1500);
  assert.equal(tie.newEloB, 1500);

  const upset = calculateEloUpdate(1400, 1600, "left");
  assert.ok(upset.newEloA > 1400);
  assert.equal(upset.newEloA - 1400, 1600 - upset.newEloB);
});

test("recordBinAnswer initializes ticket record and Elo by bin tier", () => {
  const state = createInitialState();
  recordBinAnswer(state, "A", "now");
  assert.equal(state.tickets["A"]?.bin, "now");
  assert.equal(state.tickets["A"]?.elo, BIN_INITIAL_ELO.now);
  assert.equal(state.tickets["A"]?.comparisons, 0);
  assert.ok(state.tickets["A"]?.last_reviewed_at);

  recordBinAnswer(state, "B", "later");
  assert.equal(state.tickets["B"]?.bin, "later");
  assert.equal(state.tickets["B"]?.elo, BIN_INITIAL_ELO.later);
});

test("recordComparisonAnswer updates Elo, comparisons count, and cache", () => {
  const state = createInitialState();
  recordBinAnswer(state, "A", "now");
  recordBinAnswer(state, "B", "now");

  recordComparisonAnswer(state, "A", "B", "left");
  assert.ok(state.tickets["A"]!.elo > BIN_INITIAL_ELO.now);
  assert.ok(state.tickets["B"]!.elo < BIN_INITIAL_ELO.now);
  assert.equal(state.tickets["A"]!.comparisons, 1);
  assert.equal(state.tickets["B"]!.comparisons, 1);
  assert.equal(readCachedComparison(state.comparisons, ticket("A"), ticket("B")), "left");
  assert.equal(readCachedComparison(state.comparisons, ticket("B"), ticket("A")), "right");
});

test("isTicketStale detects recency decay after threshold days", () => {
  const now = Date.parse("2026-10-09T12:00:00.000Z");
  const freshRecord = {
    elo: 1600,
    comparisons: 0,
    last_reviewed_at: new Date(now - 5 * 86400000).toISOString(),
    bin: "now" as BinName,
  };
  assert.equal(isTicketStale(freshRecord, 14, now), false);

  const staleRecord = {
    elo: 1600,
    comparisons: 0,
    last_reviewed_at: new Date(now - 15 * 86400000).toISOString(),
    bin: "now" as BinName,
  };
  assert.equal(isTicketStale(staleRecord, 14, now), true);
  assert.equal(isTicketStale(undefined, 14, now), true);
});

test("isHighConfidenceSettled requires minimum comparisons and a bin", () => {
  assert.equal(isHighConfidenceSettled(undefined), false);
  assert.equal(isHighConfidenceSettled({ elo: 1600, comparisons: 1, last_reviewed_at: "", bin: "now" }, 2), false);
  assert.equal(isHighConfidenceSettled({ elo: 1600, comparisons: 2, last_reviewed_at: "", bin: "now" }, 2), true);
});

test("nextQuestion standard mode runs binning pass first then pairwise inside Now", () => {
  const tickets = [ticket("A"), ticket("B"), ticket("C")];
  const state = createInitialState();

  // Step 1: asks bin for A
  const q1 = nextQuestion({ tickets, state });
  assert.equal(q1.done, false);
  if (q1.done) return;
  assert.equal(q1.kind, "bin");
  assert.equal(q1.ticket.id, "A");
  recordBinAnswer(state, "A", "now");

  // Step 2: asks bin for B
  const q2 = nextQuestion({ tickets, state });
  assert.equal(q2.done, false);
  if (q2.done) return;
  assert.equal(q2.kind, "bin");
  assert.equal(q2.ticket.id, "B");
  recordBinAnswer(state, "B", "later"); // B is parked in later!

  // Step 3: asks bin for C
  const q3 = nextQuestion({ tickets, state });
  assert.equal(q3.done, false);
  if (q3.done) return;
  assert.equal(q3.kind, "bin");
  assert.equal(q3.ticket.id, "C");
  recordBinAnswer(state, "C", "now");

  // Step 4: All binned. Only A and C are in Now. B in later is never asked pairwise.
  const q4 = nextQuestion({ tickets, state, options: { top: 2 } });
  assert.equal(q4.done, false);
  if (q4.done) return;
  assert.equal(q4.kind, "compare");
  assert.equal([q4.left.id, q4.right.id].sort().join(","), "A,C");

  recordComparisonAnswer(state, "A", "C", "left");

  // Step 5: Done!
  const done = nextQuestion({ tickets, state, options: { top: 2 } });
  assert.equal(done.done, true);
  if (!done.done) return;
  assert.deepEqual(done.ranked.map((t) => t.id), ["A", "C"]);
});

test("nextQuestion doNext produces top 1-3 from Now in minimal questions", () => {
  const tickets = [
    ticket("A"),
    ticket("B"),
    ticket("C"),
    ticket("D"),
    ticket("E"),
  ];
  const state = createInitialState();
  // Pre-binned state: A, B, C, D in Now, E in Later
  recordBinAnswer(state, "A", "now");
  recordBinAnswer(state, "B", "now");
  recordBinAnswer(state, "C", "now");
  recordBinAnswer(state, "D", "now");
  recordBinAnswer(state, "E", "later");

  let questions = 0;
  while (true) {
    const step = nextQuestion({ tickets, state, options: { doNext: true, top: 3 } });
    if (step.done) {
      assert.equal(step.ranked.length, 3);
      break;
    }
    assert.equal(step.kind, "compare");
    // Simulate A > B > C > D
    const leftWins = step.left.id < step.right.id;
    recordComparisonAnswer(state, step.left.id, step.right.id, leftWins ? "left" : "right");
    questions += 1;
    assert.ok(questions <= 8, `Expected questions <= 8, got ${questions}`);
  }
  assert.ok(questions <= 8, `Total questions to reach top-3 was ${questions}`);
});

test("nextQuestion resumes with zero repeated questions", () => {
  const tickets = [ticket("A"), ticket("B"), ticket("C")];
  const state = createInitialState();
  recordBinAnswer(state, "A", "now");
  recordBinAnswer(state, "B", "now");
  recordBinAnswer(state, "C", "later");
  recordComparisonAnswer(state, "A", "B", "left");

  const step = nextQuestion({ tickets, state, options: { top: 2 } });
  assert.equal(step.done, true);
  if (!step.done) return;
  assert.deepEqual(step.ranked.map((t) => t.id), ["A", "B"]);
});

test("stale ticket resurfaces for bin question unless high-confidence settled", () => {
  const now = Date.parse("2026-10-09T12:00:00.000Z");
  const tickets = [ticket("Unsettled"), ticket("Settled")];
  const state = createInitialState();

  // Both reviewed 20 days ago (> 14 days)
  const twentyDaysAgo = new Date(now - 20 * 86400000).toISOString();
  state.tickets["Unsettled"] = {
    elo: 1600,
    comparisons: 0,
    last_reviewed_at: twentyDaysAgo,
    bin: "now",
  };
  state.tickets["Settled"] = {
    elo: 1600,
    comparisons: 3, // settled with 3 comparisons!
    last_reviewed_at: twentyDaysAgo,
    bin: "now",
  };

  // Step 1: Unsettled resurfaces because it is stale and comparisons < 2
  const step1 = nextQuestion({ tickets, state, options: { now, staleDays: 14 } });
  assert.equal(step1.done, false);
  if (step1.done) return;
  assert.equal(step1.kind, "bin");
  assert.equal(step1.ticket.id, "Unsettled");

  // User confirms Unsettled is still now
  recordBinAnswer(state, "Unsettled", "now", now);

  // Step 2: Settled should NOT resurface because it is high-confidence settled!
  // Since both are in Now, it goes straight to pairwise comparison
  const step2 = nextQuestion({ tickets, state, options: { now, staleDays: 14 } });
  assert.equal(step2.done, false);
  if (step2.done) return;
  assert.equal(step2.kind, "compare");
});

test("wordWrap never splits a word and wraps to width boundary", () => {
  const sample = "The quick brown fox jumps over the lazy dog repeatedly until the sentence exceeds sixty characters in length.";
  const wrapped = wordWrap(sample, 60);
  const lines = wrapped.split("\n");

  for (const line of lines) {
    assert.ok(line.length <= 60, `Line exceeds width: "${line}" (${line.length} > 60)`);
  }

  // Original words are all present intact in order
  const originalWords = sample.split(/\s+/);
  const wrappedWords = wrapped.split(/\s+/);
  assert.deepEqual(wrappedWords, originalWords);

  // Minimum width floor is 60: width 20 clamps to 60
  const clamped = wordWrap(sample, 20);
  assert.equal(clamped, wrapped);

  // Individual words longer than width are preserved intact without hyphenation
  const longWord = "supercalifragilisticexpialidocious_unbroken_token_that_is_very_long_indeed";
  const withLong = `Prefix ${longWord} suffix`;
  const wrappedLong = wordWrap(withLong, 60);
  assert.ok(wrappedLong.includes(longWord), "Long word must not be split");

  // Preserves existing newlines
  const multiLine = "Line one is here.\n\nLine two after empty line.";
  const wrappedMulti = wordWrap(multiLine, 60);
  assert.ok(wrappedMulti.includes("\n\n"), "Paragraph breaks preserved");
});

test("extractTriageSections extracts What problem are you trying to solve and What does completed look like from 7-question body", () => {
  const body = `## What problem are you trying to solve?
Current test coverage relies on synthetic component mocks rather than exercising real browser sessions against production database records.

## Why is it important?
Mocks conceal authentication and cookie synchronization race conditions.

## What does it feel like in use?
Logging in on a mobile browser immediately restores the user session.

## What does completed look like?
A headless Playwright browser loads an authenticated session, queries the API, and receives an HTTP 200 containing genuine user shortlists.

## Validation steps for reviewers
Run npx playwright test tests/e2e/test.spec.ts
`;

  const sections = extractTriageSections(body);
  assert.ok(sections.problem, "Problem section should be extracted");
  assert.ok(sections.completed, "Completed section should be extracted");
  assert.equal(
    sections.problem,
    "Current test coverage relies on synthetic component mocks rather than exercising real browser sessions against production database records.",
  );
  assert.equal(
    sections.completed,
    "A headless Playwright browser loads an authenticated session, queries the API, and receives an HTTP 200 containing genuine user shortlists.",
  );
  assert.equal(sections.fallback, undefined);

  // Heading variations: numbered headings and missing question marks
  const variantBody = `## 1. What problem are you trying to solve
Latency spikes on cold restart.

## 4. What does completed look like?
Cold starts finish under 200ms.
`;
  const variantSections = extractTriageSections(variantBody);
  assert.equal(variantSections.problem, "Latency spikes on cold restart.");
  assert.equal(variantSections.completed, "Cold starts finish under 200ms.");
});

test("extractTriageSections fallback path when headings are absent never cuts mid-word", () => {
  // Short description without headings returns verbatim
  const shortText = "Simple task with no 7-question spec headings.";
  const shortSections = extractTriageSections(shortText);
  assert.equal(shortSections.problem, undefined);
  assert.equal(shortSections.completed, undefined);
  assert.equal(shortSections.fallback, shortText);

  // Long description without headings truncates at word boundary before 1200 chars
  const longBody = Array.from({ length: 300 }, (_, i) => `token${i + 1}`).join(" ");
  assert.ok(longBody.length > 1200, "Must be longer than 1200 chars");

  const longSections = extractTriageSections(longBody);
  assert.equal(longSections.problem, undefined);
  assert.equal(longSections.completed, undefined);
  assert.ok(longSections.fallback, "Fallback text must be returned");
  assert.ok(longSections.fallback.endsWith("..."), "Fallback must end with ellipsis");

  const withoutEllipsis = longSections.fallback.slice(0, -3);
  const lastWord = withoutEllipsis.split(/\s+/).pop();
  assert.ok(lastWord?.startsWith("token"), "Last word must be a complete token, never cut mid-word");
  assert.ok(
    longBody.includes(lastWord!),
    `Truncated word "${lastWord}" must match an exact whole token in source`,
  );
  assert.ok(longSections.fallback.length <= 1205, "Fallback length must respect bound");
});

test("recordBinAnswer persists reassess bin, reason, and initial Elo rating", () => {
  const state = createInitialState();
  recordBinAnswer(state, "EMO-1", "reassess", undefined, "Unclear touch targets spec");

  assert.equal(state.tickets["EMO-1"].bin, "reassess");
  assert.equal(state.tickets["EMO-1"].reassess_reason, "Unclear touch targets spec");
  assert.equal(state.tickets["EMO-1"].elo, 800);
  assert.equal(state.tickets["EMO-1"].comparisons, 0);
});

test("reassess tickets are excluded from pairwise comparisons and ranking", () => {
  const state = createInitialState();
  const tickets = [
    ticket("A", "High Priority"),
    ticket("B", "Normal Priority"),
    ticket("C", "Ambiguous Ticket"),
    ticket("D", "Unwanted"),
  ];

  recordBinAnswer(state, "A", "now");
  recordBinAnswer(state, "B", "now");
  recordBinAnswer(state, "C", "reassess", undefined, "Ambiguous requirements");
  recordBinAnswer(state, "D", "never");

  // nextQuestion should ask pairwise comparison only between A and B
  const step = nextQuestion({ tickets, state });
  assert.equal(step.done, false);
  if (step.done) return;
  assert.equal(step.kind, "compare");
  assert.ok(
    (step.left.id === "A" && step.right.id === "B") ||
      (step.left.id === "B" && step.right.id === "A"),
    "Only A and B should be compared",
  );
  assert.notEqual(step.left.id, "C");
  assert.notEqual(step.right.id, "C");

  // Record answer between A and B
  recordComparisonAnswer(state, step.left.id, step.right.id, "left");

  // Next step should finalize ranking
  const finalStep = nextQuestion({ tickets, state, options: { top: 2 } });
  assert.equal(finalStep.done, true);
  if (!finalStep.done) return;
  const rankedIds = finalStep.ranked.map((t) => t.id);
  assert.ok(rankedIds.includes("A") || rankedIds.includes("B"));
  assert.ok(!rankedIds.includes("C"), "Reassess ticket C must never appear in ranked list");
  assert.ok(!rankedIds.includes("D"), "Never ticket D must never appear in ranked list");
});

test("Part A: 67 tickets, 12 in now, k=3 -> worst case <= 24 and zero comparisons involve a non-now ticket", () => {
  const tickets: Ticket[] = Array.from({ length: 67 }, (_, i) => ({
    id: `EMO-${i + 1}`,
    title: `Ticket ${i + 1}`,
  }));

  const state = createInitialState();
  // 12 in now
  for (let i = 0; i < 12; i++) {
    recordBinAnswer(state, tickets[i].id, "now");
  }
  // 18 in next
  for (let i = 12; i < 30; i++) {
    recordBinAnswer(state, tickets[i].id, "next");
  }
  // 20 in reassess
  for (let i = 30; i < 50; i++) {
    recordBinAnswer(state, tickets[i].id, "reassess");
  }
  // 16 in later
  for (let i = 50; i < 66; i++) {
    recordBinAnswer(state, tickets[i].id, "later");
  }
  // 1 in never
  recordBinAnswer(state, tickets[66].id, "never");

  // Worst case for pool of 12 with k=3
  const worstCase = computeWorstCaseComparisons(12, 3);
  assert.ok(worstCase <= 24, `Worst case ${worstCase} must be <= 24`);
  assert.equal(worstCase, 24);

  let comparisonCount = 0;
  let nonNowComparisons = 0;

  while (true) {
    const step = nextQuestion({
      tickets,
      state,
      options: { top: 3, includeNext: false },
    });
    if (step.done) {
      assert.equal(step.ranked.length, 3);
      for (const t of step.ranked) {
        assert.equal(state.tickets[t.id]?.bin, "now", "All ranked tickets must be from Now bin");
      }
      break;
    }
    assert.equal(step.kind, "compare");
    if (step.kind === "compare") {
      comparisonCount++;
      const leftBin = state.tickets[step.left.id]?.bin;
      const rightBin = state.tickets[step.right.id]?.bin;
      if (leftBin !== "now" || rightBin !== "now") {
        nonNowComparisons++;
      }
      recordComparisonAnswer(state, step.left.id, step.right.id, "left");
    }
  }

  assert.equal(nonNowComparisons, 0, "Zero comparisons should involve a non-now ticket");
  assert.ok(comparisonCount <= worstCase, `Comparisons (${comparisonCount}) must be <= worstCase (${worstCase})`);
});

test("Part A: comparisons already implied by Elo gaps > 200 are skipped", () => {
  const tickets: Ticket[] = [
    ticket("A", "Ticket A"),
    ticket("B", "Ticket B"),
    ticket("C", "Ticket C"),
  ];
  const state = createInitialState();
  recordBinAnswer(state, "A", "now");
  recordBinAnswer(state, "B", "now");
  recordBinAnswer(state, "C", "now");

  // Give A high Elo, B medium Elo, C low Elo with > 200 gaps
  state.tickets["A"].elo = 1800;
  state.tickets["B"].elo = 1500;
  state.tickets["C"].elo = 1200;

  // nextQuestion with top 2 should automatically resolve without asking human comparisons
  const step = nextQuestion({
    tickets,
    state,
    options: { top: 2, highConfidenceEloGap: 200 },
  });

  assert.equal(step.done, true);
  if (step.done) {
    assert.equal(step.ranked.length, 2);
    assert.equal(step.ranked[0].id, "A");
    assert.equal(step.ranked[1].id, "B");
  }
});