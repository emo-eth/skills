/**
 * Shared pure top-k selection core for `prioritize-linear-tickets`.
 *
 * Dependency-free and free of I/O. Deterministic from the input order and the
 * comparison cache alone: the same cache always yields the same next pending
 * comparison or the same final ranking.
 *
 * Design (selection):
 * - Keep a frontier `selected` of the best tickets seen so far, sorted
 *   best -> worst.
 * - Process tickets in input order. Binary-insert each candidate into the
 *   frontier using cached human comparisons; trim to k worst-offenders.
 * - `left` is ALWAYS the candidate currently being inserted, `right` an
 *   existing selected ticket. "left" means the candidate is more important,
 *   "right" means it is less important, "tie" means equal (ties insert AFTER
 *   the existing item, preserving input-order stability for equals).
 * - Returns the first missing comparison (so the CLI can ask one question and
 *   rerun) or the completed best -> worst ranking.
 */

export interface Ticket {
  id: string;
  title: string;
  /** description / state / priority / url and any other record fields flow through unchanged. */
  [key: string]: unknown;
}

export type ComparisonResult = "left" | "right" | "tie";

/**
 * Cached pairwise outcomes.
 *
 * Keys are canonical pair keys (see `pairKey`). Values are stored in the
 * CANONICAL orientation: the id-smaller ticket is treated as the "left" side.
 * So a cached `"left"` means "the ticket whose id sorts first is more
 * important". Use `readCachedComparison` to read with an arbitrary
 * orientation; it performs any needed flip.
 */
export type ComparisonCache = Record<string, ComparisonResult>;

/** A pairwise decision that is still missing from the cache and must be asked. */
export interface PendingComparison {
  left: Ticket;
  right: Ticket;
  key: string;
}

export type SelectionResult =
  | { complete: false; comparison: PendingComparison }
  | { complete: true; ranked: Ticket[]; comparisonCount: number };

/** Separator between the two ids in a canonical pair key. */
const SEP = "\u0000";

/**
 * Canonical, order-independent key for an unordered pair of ticket ids.
 * The id that sorts first is stored first, so `pairKey(a, b) === pairKey(b, a)`.
 */
export function pairKey(idA: string, idB: string): string {
  if (idA < idB) return idA + SEP + idB;
  return idB + SEP + idA;
}

/**
 * Read a cached outcome for the given orientation.
 *
 * `left` is the candidate, `right` the existing selected ticket. Returns
 * `undefined` when the pair has no cached outcome. Cache values are stored in
 * canonical (id-order) orientation; this flips directional results when the
 * requested orientation is the reverse of the canonical one ("tie" is
 * symmetric and unchanged).
 */
export function readCachedComparison(
  cache: ComparisonCache,
  left: Ticket,
  right: Ticket,
): ComparisonResult | undefined {
  const stored = cache[pairKey(left.id, right.id)];
  if (stored === undefined) return undefined;
  if (left.id < right.id) return stored; // requested orientation == canonical
  switch (stored) {
    case "left":
      return "right";
    case "right":
      return "left";
    default:
      return "tie";
  }
}

function validate(tickets: Ticket[], k: number): void {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`k must be a positive integer, got: ${k}`);
  }
  const seen = new Set<string>();
  for (const t of tickets) {
    if (typeof t.id !== "string" || t.id.length === 0) {
      throw new Error(
        `every ticket must have a non-empty string id; found: ${JSON.stringify(t.id)}`,
      );
    }
    if (seen.has(t.id)) {
      throw new Error(`duplicate ticket id: ${t.id}`);
    }
    seen.add(t.id);
  }
}

/**
 * Resolve the top-k selection as far as the cache allows.
 *
 * Either the first missing comparison is returned (`complete: false`), or the
 * full best -> worst top-k list (`complete: true`) along with the number of
 * cached pair decisions consumed on this run (a stable, CLI-meaningful
 * comparison count).
 *
 * When `k >= tickets.length` there is nothing to discard, so no comparison is
 * ever requested and all tickets are returned (in input order).
 */
export function findTopKOrNextComparison(
  tickets: Ticket[],
  k: number,
  cache: ComparisonCache,
): SelectionResult {
  validate(tickets, k);

  // Nothing to choose when k covers every ticket: no comparisons needed.
  if (k >= tickets.length) {
    return { complete: true, ranked: [...tickets], comparisonCount: 0 };
  }

  const selected: Ticket[] = []; // sorted best -> worst
  let comparisonCount = 0;

  for (const candidate of tickets) {
    // Probe from the worst (bottom) of the frontier upward. Most candidates
    // lose to the lowest-ranked selection, so a single comparison rejects
    // them; only a candidate that actually makes the top-k walks further up.
    let insertAt = selected.length; // candidate belongs after selected[insertAt - 1]
    let offset = selected.length - 1;
    while (offset >= 0) {
      const outcome = readCachedComparison(cache, candidate, selected[offset]);
      if (outcome === undefined) {
        const key = pairKey(candidate.id, selected[offset].id);
        return {
          complete: false,
          comparison: { left: candidate, right: selected[offset], key },
        };
      }
      comparisonCount += 1;
      if (outcome === "left") {
        // Candidate is more important -> it may sit at or above this slot.
        insertAt = offset;
        offset -= 1;
      } else {
        // "right" or "tie": candidate goes after this slot (ties insert after).
        insertAt = offset + 1;
        break;
      }
    }
    selected.splice(insertAt, 0, candidate);
    if (selected.length > k) {
      selected.length = k; // drop the worst tail; selected stays best -> worst
    }
  }

  return { complete: true, ranked: selected, comparisonCount };
}

export function rankOrNextComparison(
  tickets: Ticket[],
  k: number,
  cache: ComparisonCache,
): SelectionResult {
  validate(tickets, Math.max(1, k));
  if (tickets.length <= 1) {
    return { complete: true, ranked: [...tickets], comparisonCount: 0 };
  }

  const targetK = Math.min(k, tickets.length);
  const selected: Ticket[] = [];
  let comparisonCount = 0;

  for (const candidate of tickets) {
    let insertAt = selected.length;
    let offset = selected.length - 1;
    while (offset >= 0) {
      const outcome = readCachedComparison(cache, candidate, selected[offset]);
      if (outcome === undefined) {
        const key = pairKey(candidate.id, selected[offset].id);
        return {
          complete: false,
          comparison: { left: candidate, right: selected[offset], key },
        };
      }
      comparisonCount += 1;
      if (outcome === "left") {
        insertAt = offset;
        offset -= 1;
      } else {
        insertAt = offset + 1;
        break;
      }
    }
    selected.splice(insertAt, 0, candidate);
    if (selected.length > targetK) {
      selected.length = targetK;
    }
  }

  return { complete: true, ranked: selected, comparisonCount };
}

export type BinName = "now" | "next" | "later" | "never";

export const BIN_NAMES: readonly BinName[] = ["now", "next", "later", "never"] as const;

export const BIN_INITIAL_ELO: Record<BinName, number> = {
  now: 1600,
  next: 1400,
  later: 1200,
  never: 1000,
};

export const DEFAULT_INITIAL_ELO = 1500;

export interface TicketRecord {
  elo: number;
  last_reviewed_at: string;
  comparisons: number;
  bin?: BinName;
}

export interface PrioritizeState {
  schema_version: number;
  tickets: Record<string, TicketRecord>;
  comparisons: ComparisonCache;
  snapshot?: string;
  top?: number;
  applying?: unknown;
  updatedAt?: string;
}

export function createInitialState(): PrioritizeState {
  return {
    schema_version: 3,
    tickets: {},
    comparisons: {},
    updatedAt: new Date().toISOString(),
  };
}

export function calculateEloUpdate(
  eloA: number,
  eloB: number,
  outcome: ComparisonResult,
  kFactor = 32,
): { newEloA: number; newEloB: number } {
  const expectedA = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
  const expectedB = 1 / (1 + Math.pow(10, (eloA - eloB) / 400));

  let scoreA = 0.5;
  let scoreB = 0.5;
  if (outcome === "left") {
    scoreA = 1;
    scoreB = 0;
  } else if (outcome === "right") {
    scoreA = 0;
    scoreB = 1;
  }

  const newEloA = Math.round(eloA + kFactor * (scoreA - expectedA));
  const newEloB = Math.round(eloB + kFactor * (scoreB - expectedB));
  return { newEloA, newEloB };
}

export function recordBinAnswer(
  state: PrioritizeState,
  ticketId: string,
  bin: BinName,
  now: string | Date | number = new Date().toISOString(),
): void {
  const isoTime = typeof now === "string" ? now : new Date(now).toISOString();
  const existing = state.tickets[ticketId];
  if (existing) {
    existing.bin = bin;
    existing.last_reviewed_at = isoTime;
    if (existing.comparisons === 0) {
      existing.elo = BIN_INITIAL_ELO[bin];
    }
  } else {
    state.tickets[ticketId] = {
      elo: BIN_INITIAL_ELO[bin],
      last_reviewed_at: isoTime,
      comparisons: 0,
      bin,
    };
  }
  state.updatedAt = isoTime;
}

export function recordComparisonAnswer(
  state: PrioritizeState,
  leftId: string,
  rightId: string,
  result: ComparisonResult,
  now: string | Date | number = new Date().toISOString(),
): void {
  const isoTime = typeof now === "string" ? now : new Date(now).toISOString();
  const key = pairKey(leftId, rightId);
  const canonicalResult: ComparisonResult =
    leftId < rightId
      ? result
      : result === "left"
        ? "right"
        : result === "right"
          ? "left"
          : "tie";

  state.comparisons[key] = canonicalResult;

  const leftRec: TicketRecord = state.tickets[leftId] ?? {
    elo: DEFAULT_INITIAL_ELO,
    last_reviewed_at: isoTime,
    comparisons: 0,
  };
  const rightRec: TicketRecord = state.tickets[rightId] ?? {
    elo: DEFAULT_INITIAL_ELO,
    last_reviewed_at: isoTime,
    comparisons: 0,
  };

  const { newEloA, newEloB } = calculateEloUpdate(leftRec.elo, rightRec.elo, result);
  leftRec.elo = newEloA;
  leftRec.comparisons += 1;
  leftRec.last_reviewed_at = isoTime;

  rightRec.elo = newEloB;
  rightRec.comparisons += 1;
  rightRec.last_reviewed_at = isoTime;

  state.tickets[leftId] = leftRec;
  state.tickets[rightId] = rightRec;
  state.updatedAt = isoTime;
}

export function isTicketStale(
  record: TicketRecord | undefined,
  staleDays = 14,
  nowMs: number = Date.now(),
): boolean {
  if (!record || !record.last_reviewed_at) return true;
  const reviewedAt = Date.parse(record.last_reviewed_at);
  if (Number.isNaN(reviewedAt)) return true;
  const elapsedDays = (nowMs - reviewedAt) / (1000 * 60 * 60 * 24);
  return elapsedDays >= staleDays;
}

export function isHighConfidenceSettled(
  record: TicketRecord | undefined,
  minComparisons = 2,
): boolean {
  if (!record) return false;
  return record.comparisons >= minComparisons && record.bin !== undefined;
}

export function groupTicketsByBin(
  tickets: Ticket[],
  state: PrioritizeState,
): Record<BinName, Ticket[]> {
  const result: Record<BinName, Ticket[]> = {
    now: [],
    next: [],
    later: [],
    never: [],
  };
  for (const t of tickets) {
    const bin = state.tickets[t.id]?.bin;
    if (bin && bin in result) {
      result[bin].push(t);
    }
  }
  return result;
}

export type BinQuestion = {
  done: false;
  kind: "bin";
  type: "bin";
  ticket: Ticket;
  currentBin?: BinName;
  isStale?: boolean;
  options: BinName[];
  prompt: string;
};

export type CompareQuestion = {
  done: false;
  kind: "compare";
  type: "compare";
  left: Ticket;
  right: Ticket;
  key: string;
  prompt: string;
};

export type DoneResult = {
  done: true;
  kind: "done";
  type: "done";
  ranked: Ticket[];
  comparisonCount: number;
  bins: Record<BinName, Ticket[]>;
  state: PrioritizeState;
};

export type NextQuestionResult = BinQuestion | CompareQuestion | DoneResult;

export interface PrioritizeEngineOptions {
  top?: number;
  doNext?: boolean;
  staleDays?: number;
  now?: number | Date | string;
  targetBin?: BinName;
  includeNext?: boolean;
  minComparisonsSettled?: number;
  highConfidenceEloGap?: number;
}

export interface PrioritizeEngineState {
  tickets: Ticket[];
  state: PrioritizeState;
  options?: PrioritizeEngineOptions;
}

export function nextQuestion(
  engine:
    | PrioritizeEngineState
    | (PrioritizeState & {
        tickets: Ticket[];
        options?: PrioritizeEngineOptions;
      }),
): NextQuestionResult {
  let tickets: Ticket[];
  let state: PrioritizeState;
  let options: PrioritizeEngineOptions;

  if ("state" in engine && "tickets" in engine) {
    tickets = engine.tickets;
    state = engine.state;
    options = engine.options ?? {};
  } else {
    tickets = engine.tickets ?? [];
    state = engine;
    options = engine.options ?? {};
  }

  const top = options.top ?? (options.doNext ? 3 : 10);
  const staleDays = options.staleDays ?? 14;
  const nowMs =
    typeof options.now === "number"
      ? options.now
      : typeof options.now === "string"
        ? Date.parse(options.now)
        : options.now instanceof Date
          ? options.now.getTime()
          : Date.now();
  const minComparisons = options.minComparisonsSettled ?? 2;

  if (options.doNext) {
    const currentNowTickets = tickets.filter(
      (t) => state.tickets[t.id]?.bin === "now",
    );
    for (const ticket of currentNowTickets) {
      const rec = state.tickets[ticket.id];
      if (
        isTicketStale(rec, staleDays, nowMs) &&
        !isHighConfidenceSettled(rec, minComparisons)
      ) {
        return {
          done: false,
          kind: "bin",
          type: "bin",
          ticket,
          currentBin: rec?.bin,
          isStale: true,
          options: ["now", "next", "later", "never"],
          prompt: `Review recency expired (${staleDays}d). Bin ${ticket.id}: "${ticket.title}" into [1] Now, [2] Next, [3] Later, [4] Never`,
        };
      }
    }

    const nowTickets = tickets.filter(
      (t) => state.tickets[t.id]?.bin === "now",
    );

    if (nowTickets.length < top) {
      const unbinned = tickets.filter((t) => state.tickets[t.id]?.bin === undefined);
      const nextTickets = tickets.filter((t) => state.tickets[t.id]?.bin === "next");

      const candidatePool = [...unbinned, ...nextTickets].sort((a, b) => {
        const eloA = state.tickets[a.id]?.elo ?? DEFAULT_INITIAL_ELO;
        const eloB = state.tickets[b.id]?.elo ?? DEFAULT_INITIAL_ELO;
        return eloB - eloA;
      });

      if (candidatePool.length > 0) {
        const candidate = candidatePool[0];
        const rec = state.tickets[candidate.id];
        return {
          done: false,
          kind: "bin",
          type: "bin",
          ticket: candidate,
          currentBin: rec?.bin,
          isStale: isTicketStale(rec, staleDays, nowMs),
          options: ["now", "next", "later", "never"],
          prompt: `Do-Next needs top ${top}. Bin candidate ${candidate.id}: "${candidate.title}" into [1] Now, [2] Next, [3] Later, [4] Never`,
        };
      }
    }

    let candidatePool = nowTickets;
    if (candidatePool.length === 0) {
      candidatePool = tickets.filter(
        (t) => state.tickets[t.id]?.bin !== "never" && state.tickets[t.id]?.bin !== "later",
      );
      if (candidatePool.length === 0) candidatePool = tickets;
    }

    candidatePool = [...candidatePool].sort((a, b) => {
      const eloA = state.tickets[a.id]?.elo ?? DEFAULT_INITIAL_ELO;
      const eloB = state.tickets[b.id]?.elo ?? DEFAULT_INITIAL_ELO;
      return eloB - eloA;
    });

    const k = Math.min(top, candidatePool.length);
    if (k <= 0) {
      return {
        done: true,
        kind: "done",
        type: "done",
        ranked: [],
        comparisonCount: 0,
        bins: groupTicketsByBin(tickets, state),
        state,
      };
    }

    const result = rankOrNextComparison(candidatePool, k, state.comparisons);
    if (result.complete) {
      return {
        done: true,
        kind: "done",
        type: "done",
        ranked: result.ranked,
        comparisonCount: result.comparisonCount,
        bins: groupTicketsByBin(tickets, state),
        state,
      };
    }

    const leftRec = state.tickets[result.comparison.left.id];
    const rightRec = state.tickets[result.comparison.right.id];
    const eloGapThreshold = options.highConfidenceEloGap ?? 400;
    if (
      leftRec &&
      rightRec &&
      isHighConfidenceSettled(leftRec, minComparisons) &&
      isHighConfidenceSettled(rightRec, minComparisons) &&
      Math.abs(leftRec.elo - rightRec.elo) >= eloGapThreshold
    ) {
      const outcome: ComparisonResult = leftRec.elo >= rightRec.elo ? "left" : "right";
      recordComparisonAnswer(
        state,
        result.comparison.left.id,
        result.comparison.right.id,
        outcome,
        nowMs,
      );
      return nextQuestion(engine);
    }

    return {
      done: false,
      kind: "compare",
      type: "compare",
      left: result.comparison.left,
      right: result.comparison.right,
      key: result.comparison.key,
      prompt: `Which is more important? [L] ${result.comparison.left.id} vs [R] ${result.comparison.right.id}`,
    };
  }

  for (const ticket of tickets) {
    const rec = state.tickets[ticket.id];
    const needsBin =
      rec === undefined ||
      rec.bin === undefined ||
      (isTicketStale(rec, staleDays, nowMs) && !isHighConfidenceSettled(rec, minComparisons));
    if (needsBin) {
      return {
        done: false,
        kind: "bin",
        type: "bin",
        ticket,
        currentBin: rec?.bin,
        isStale: rec?.bin !== undefined,
        options: ["now", "next", "later", "never"],
        prompt: `Bin ${ticket.id}: "${ticket.title}" into [1] Now, [2] Next, [3] Later, [4] Never`,
      };
    }
  }

  let pool = tickets.filter((t) => state.tickets[t.id]?.bin === "now");
  if (pool.length < top && options.includeNext) {
    const nextTickets = tickets.filter((t) => state.tickets[t.id]?.bin === "next");
    pool = [...pool, ...nextTickets];
  }

  pool = [...pool].sort((a, b) => {
    const eloA = state.tickets[a.id]?.elo ?? DEFAULT_INITIAL_ELO;
    const eloB = state.tickets[b.id]?.elo ?? DEFAULT_INITIAL_ELO;
    return eloB - eloA;
  });

  const k = Math.min(top, pool.length);
  if (k <= 0) {
    return {
      done: true,
      kind: "done",
      type: "done",
      ranked: [],
      comparisonCount: 0,
      bins: groupTicketsByBin(tickets, state),
      state,
    };
  }

  const result = rankOrNextComparison(pool, k, state.comparisons);
  if (result.complete) {
    return {
      done: true,
      kind: "done",
      type: "done",
      ranked: result.ranked,
      comparisonCount: result.comparisonCount,
      bins: groupTicketsByBin(tickets, state),
      state,
    };
  }

  return {
    done: false,
    kind: "compare",
    type: "compare",
    left: result.comparison.left,
    right: result.comparison.right,
    key: result.comparison.key,
    prompt: `Which is more important? [L] ${result.comparison.left.id} vs [R] ${result.comparison.right.id}`,
  };
}

export function applyAnswer(
  engine: PrioritizeEngineState,
  question: BinQuestion | CompareQuestion,
  answer: BinName | ComparisonResult,
  now?: string | Date | number,
): void {
  if (question.kind === "bin") {
    recordBinAnswer(engine.state, question.ticket.id, answer as BinName, now);
  } else if (question.kind === "compare") {
    recordComparisonAnswer(
      engine.state,
      question.left.id,
      question.right.id,
      answer as ComparisonResult,
      now,
    );
  }
}
