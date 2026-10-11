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
    let low = 0;
    let high = selected.length;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const outcome = readCachedComparison(cache, candidate, selected[mid]);
      if (outcome === undefined) {
        const key = pairKey(candidate.id, selected[mid].id);
        return {
          complete: false,
          comparison: { left: candidate, right: selected[mid], key },
        };
      }
      comparisonCount += 1;
      if (outcome === "left") {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    selected.splice(low, 0, candidate);
    if (selected.length > k) {
      selected.length = k;
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
    let low = 0;
    let high = selected.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const outcome = readCachedComparison(cache, candidate, selected[mid]);
      if (outcome === undefined) {
        const key = pairKey(candidate.id, selected[mid].id);
        return {
          complete: false,
          comparison: { left: candidate, right: selected[mid], key },
        };
      }
      comparisonCount += 1;
      if (outcome === "left") {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    selected.splice(low, 0, candidate);
    if (selected.length > targetK) {
      selected.length = targetK;
    }
  }

  return { complete: true, ranked: selected, comparisonCount };
}

export type BinName = "now" | "next" | "later" | "never" | "reassess";

export const BIN_NAMES: readonly BinName[] = [
  "now",
  "next",
  "later",
  "never",
  "reassess",
] as const;

export const BIN_INITIAL_ELO: Record<BinName, number> = {
  now: 1600,
  next: 1400,
  later: 1200,
  never: 1000,
  reassess: 800,
};

export const DEFAULT_INITIAL_ELO = 1500;

export interface TicketRecord {
  elo: number;
  last_reviewed_at: string;
  comparisons: number;
  bin?: BinName;
  reassess_reason?: string;
}

export interface PrioritizeState {
  schema_version: number;
  tickets: Record<string, TicketRecord>;
  comparisons: ComparisonCache;
  snapshot?: string;
  top?: number;
  applying?: unknown;
  updatedAt?: string;
  consolidation_resolved?: string[][];
}

export function computeWorstCaseComparisons(poolSize: number, k: number): number {
  if (poolSize <= 1 || k <= 0) return 0;
  const effectiveK = Math.min(k, poolSize);
  const ceilLog2K = Math.max(1, Math.ceil(Math.log2(effectiveK)));
  return poolSize * ceilLog2K;
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
  reason?: string,
): void {
  const isoTime = typeof now === "string" ? now : new Date(now).toISOString();
  const existing = state.tickets[ticketId];
  if (existing) {
    existing.bin = bin;
    existing.last_reviewed_at = isoTime;
    if (bin === "reassess") {
      if (reason && reason.trim()) {
        existing.reassess_reason = reason.trim();
      }
    } else {
      delete existing.reassess_reason;
    }
    if (existing.comparisons === 0) {
      existing.elo = BIN_INITIAL_ELO[bin];
    }
  } else {
    state.tickets[ticketId] = {
      elo: BIN_INITIAL_ELO[bin],
      last_reviewed_at: isoTime,
      comparisons: 0,
      bin,
      ...(bin === "reassess" && reason && reason.trim()
        ? { reassess_reason: reason.trim() }
        : {}),
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
    reassess: [],
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
          options: ["now", "next", "later", "never", "reassess"],
          prompt: `Review recency expired (${staleDays}d). Bin ${ticket.id}: "${ticket.title}" into [1] Now, [2] Next, [3] Later, [4] Never, [5] Reassess`,
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
          options: ["now", "next", "later", "never", "reassess"],
          prompt: `Do-Next needs top ${top}. Bin candidate ${candidate.id}: "${candidate.title}" into [1] Now, [2] Next, [3] Later, [4] Never, [5] Reassess`,
        };
      }
    }

    let candidatePool = nowTickets;
    if (candidatePool.length === 0) {
      candidatePool = tickets.filter(
        (t) =>
          state.tickets[t.id]?.bin !== "never" &&
          state.tickets[t.id]?.bin !== "later" &&
          state.tickets[t.id]?.bin !== "reassess",
      );
      if (candidatePool.length === 0) candidatePool = tickets;
    }

    const rankIndex = new Map(tickets.map((t, idx) => [t.id, idx]));
    candidatePool = [...candidatePool].sort((a, b) => {
      const eloA = state.tickets[a.id]?.elo ?? DEFAULT_INITIAL_ELO;
      const eloB = state.tickets[b.id]?.elo ?? DEFAULT_INITIAL_ELO;
      if (Math.abs(eloA - eloB) >= 200) return eloB - eloA;
      return (rankIndex.get(a.id) ?? 0) - (rankIndex.get(b.id) ?? 0);
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
    const eloGapThreshold = options.highConfidenceEloGap ?? 200;
    if (
      leftRec &&
      rightRec &&
      Math.abs(leftRec.elo - rightRec.elo) > eloGapThreshold
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
        options: ["now", "next", "later", "never", "reassess"],
        prompt: `Bin ${ticket.id}: "${ticket.title}" into [1] Now, [2] Next, [3] Later, [4] Never, [5] Reassess`,
      };
    }
  }

  let pool = tickets.filter((t) => state.tickets[t.id]?.bin === "now");
  if (pool.length < top && options.includeNext) {
    const nextTickets = tickets.filter((t) => state.tickets[t.id]?.bin === "next");
    pool = [...pool, ...nextTickets];
  }

  const rankIndex = new Map(tickets.map((t, idx) => [t.id, idx]));
  pool = [...pool].sort((a, b) => {
    const eloA = state.tickets[a.id]?.elo ?? DEFAULT_INITIAL_ELO;
    const eloB = state.tickets[b.id]?.elo ?? DEFAULT_INITIAL_ELO;
    if (Math.abs(eloA - eloB) >= 200) return eloB - eloA;
    return (rankIndex.get(a.id) ?? 0) - (rankIndex.get(b.id) ?? 0);
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

  const leftRec = state.tickets[result.comparison.left.id];
  const rightRec = state.tickets[result.comparison.right.id];
  const eloGapThreshold = options.highConfidenceEloGap ?? 200;
  const leftElo = leftRec?.elo ?? DEFAULT_INITIAL_ELO;
  const rightElo = rightRec?.elo ?? DEFAULT_INITIAL_ELO;
  const eloGap = leftElo - rightElo;

  if (Math.abs(eloGap) > eloGapThreshold) {
    const outcome: ComparisonResult = eloGap > 0 ? "left" : "right";
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

export function wordWrap(
  text: string,
  width = Math.max(60, process.stdout.columns ? process.stdout.columns - 2 : 80),
): string {
  const targetWidth = Math.max(60, width);
  const lines = text.split("\n");
  const wrapped: string[] = [];

  for (const line of lines) {
    if (line.length <= targetWidth) {
      wrapped.push(line);
      continue;
    }

    const words = line.split(/(\s+)/);
    let currentLine = "";

    for (let i = 0; i < words.length; i += 2) {
      const word = words[i];
      const space = words[i + 1] ?? "";
      if (!word) {
        if (space) currentLine += space;
        continue;
      }

      if (currentLine.length === 0) {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= targetWidth) {
        currentLine += " " + word;
      } else {
        wrapped.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine.length > 0) {
      wrapped.push(currentLine);
    }
  }

  return wrapped.join("\n");
}

export function truncateAtWord(text: string, maxLength = 1200): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > 0) {
    return slice.slice(0, lastSpace).trimEnd() + "...";
  }
  return slice + "...";
}

export function extractSection(markdown: string, headingPattern: RegExp): string | undefined {
  const match = headingPattern.exec(markdown);
  if (!match) return undefined;
  const startIndex = match.index + match[0].length;
  const rest = markdown.slice(startIndex);
  const nextHeading = rest.search(/\n#{1,3}\s+/);
  const body = nextHeading !== -1 ? rest.slice(0, nextHeading) : rest;
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface TriageSections {
  problem?: string;
  completed?: string;
  fallback?: string;
}

export function extractTriageSections(markdown: string, fallbackLimit = 1200): TriageSections {
  if (!markdown || !markdown.trim()) {
    return { fallback: "No description provided." };
  }

  const problemPattern = /^#{1,4}\s+(?:\d+\.\s+)?What problem are you trying to solve\??[ \t]*(?:\n)?/im;
  const completedPattern = /^#{1,4}\s+(?:\d+\.\s+)?What does completed look like\??[ \t]*(?:\n)?/im;

  const problem = extractSection(markdown, problemPattern);
  const completed = extractSection(markdown, completedPattern);

  if (problem || completed) {
    return { problem, completed };
  }

  return { fallback: truncateAtWord(markdown.trim(), fallbackLimit) };
}

export function extractDeliverables(markdown: string): string[] {
  const pattern = /^#{1,4}\s+(?:\d+\.\s+)?Deliverables\??[ \t]*(?:\n)?/im;
  const section = extractSection(markdown, pattern);
  if (!section) return [];
  const lines = section.split("\n");
  const bullets: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("* ") || trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      bullets.push(trimmed.slice(2).trim());
    } else if (/^\d+\.\s+/.test(trimmed)) {
      bullets.push(trimmed.replace(/^\d+\.\s+/, "").trim());
    }
  }
  return bullets;
}

export function extractFiles(markdown: string): string[] {
  const matches = markdown.match(/`([^`\s]+\.[a-zA-Z0-9]+)`/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(1, -1)))];
}

export function extractPrLink(markdown: string): string {
  const match = markdown.match(/https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+/);
  return match ? match[0] : "None";
}

export function extractWorker(ticket: Ticket): string {
  if (ticket.assignee) return ticket.assignee;
  const desc = typeof ticket.description === "string" ? ticket.description : "";
  const match = desc.match(/Worker:\s*([^\n\r]+)/i) || desc.match(/Workspace:\s*([^\n\r]+)/i);
  return match ? match[1].trim() : "Unassigned";
}

export const CLUSTER_STOP_WORDS: Record<string, true> = {
  the: true, a: true, an: true, and: true, or: true, but: true, in: true, on: true, at: true, to: true, for: true, of: true, with: true,
  by: true, from: true, up: true, about: true, into: true, over: true, after: true, is: true, are: true, was: true, were: true,
  be: true, been: true, being: true, have: true, has: true, had: true, do: true, does: true, did: true, what: true, problem: true,
  trying: true, solve: true, creatordex: true,
};

export function extractTicketTokens(ticket: Ticket): Set<string> {
  const desc = typeof ticket.description === "string" ? ticket.description : "";
  const { problem, fallback } = extractTriageSections(desc);
  const probText = (problem || fallback || "").slice(0, 300);
  const text = `${ticket.title} ${probText}`.toLowerCase();
  const words = text
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !CLUSTER_STOP_WORDS[w]);
  return new Set(words);
}

export function computeTokenOverlap(setA: Set<string>, setB: Set<string>): number {
  let inter = 0;
  for (const item of setA) {
    if (setB.has(item)) inter++;
  }
  const union = setA.size + setB.size - inter;
  if (union === 0) return 0;
  return inter / union;
}

export interface ConsolidationDecision {
  tickets: string[];
  cluster?: string[];
  decision: "merge" | "split" | "keep" | "later";
  evidence?: string | Record<string, unknown>;
  canonical?: string;
  note?: string;
  decided_at: string;
  at?: string;
  source: string;
}

export interface ConsolidationCluster {
  id: number;
  tickets: Ticket[];
  sharedTokens: string[];
  sharedFiles: string[];
  similarity: number;
}

export function clusterTicketsForConsolidation(
  tickets: Ticket[],
  threshold = 0.6,
): ConsolidationCluster[] {
  const tokenSets = tickets.map((t) => extractTicketTokens(t));
  const adj: number[][] = Array.from({ length: tickets.length }, () => []);

  for (let i = 0; i < tickets.length; i++) {
    for (let j = i + 1; j < tickets.length; j++) {
      if (computeTokenOverlap(tokenSets[i], tokenSets[j]) >= threshold) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  const visited = new Set<number>();
  const clusters: ConsolidationCluster[] = [];

  for (let i = 0; i < tickets.length; i++) {
    if (visited.has(i)) continue;
    const component: number[] = [];
    const queue = [i];
    visited.add(i);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(curr);
      for (const neighbor of adj[curr]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (component.length >= 2) {
      const clusterTickets = component.map((idx) => tickets[idx]);
      const compSets = component.map((idx) => tokenSets[idx]);
      const sharedTokens: string[] = [];
      if (compSets.length > 0) {
        for (const token of compSets[0]) {
          if (compSets.every((s) => s.has(token))) {
            sharedTokens.push(token);
          }
        }
      }

      const allFiles = clusterTickets.map((t) =>
        new Set(extractFiles(typeof t.description === "string" ? t.description : "")),
      );
      const sharedFiles: string[] = [];
      if (allFiles.length > 0) {
        for (const f of allFiles[0]) {
          if (allFiles.slice(1).some((s) => s.has(f))) {
            sharedFiles.push(f);
          }
        }
      }

      clusters.push({
        id: clusters.length + 1,
        tickets: clusterTickets,
        sharedTokens,
        sharedFiles,
        similarity: threshold,
      });
    }
  }

  return clusters;
}

export function renderClusterCard(
  cluster: Ticket[],
  clusterIndex: number,
  totalClusters: number,
): string {
  const lines: string[] = [];
  const sep = "=".repeat(78);
  const thinSep = "-".repeat(78);
  lines.push(sep);
  lines.push(`CANDIDATE CONSOLIDATION CLUSTER [${clusterIndex + 1} of ${totalClusters}] (${cluster.length} tickets)`);
  lines.push(sep);

  const allFiles = cluster.map((t) =>
    new Set(extractFiles(typeof t.description === "string" ? t.description : "")),
  );
  const sharedFiles: string[] = [];
  if (allFiles.length > 0) {
    for (const f of allFiles[0]) {
      if (allFiles.slice(1).some((s) => s.has(f))) sharedFiles.push(f);
    }
  }

  const delivSets = cluster.map((t) => {
    const delivs = extractDeliverables(typeof t.description === "string" ? t.description : "");
    const words = delivs
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !CLUSTER_STOP_WORDS[w]);
    return new Set(words);
  });
  const sharedDeliv: string[] = [];
  if (delivSets.length > 0) {
    for (const w of delivSets[0]) {
      if (delivSets.slice(1).some((s) => s.has(w))) sharedDeliv.push(w);
    }
  }

  lines.push(`COMPUTED OVERLAP:`);
  lines.push(`  Shared Deliverable Terms : ${sharedDeliv.length > 0 ? sharedDeliv.slice(0, 10).join(", ") : "None"}`);
  lines.push(`  Shared Files from PRs    : ${sharedFiles.length > 0 ? sharedFiles.join(", ") : "None"}`);
  lines.push(thinSep);

  cluster.forEach((t, idx) => {
    const desc = typeof t.description === "string" ? t.description : "";
    const { problem, fallback } = extractTriageSections(desc);
    const deliverables = extractDeliverables(desc);
    const pr = extractPrLink(desc);
    const worker = extractWorker(t);

    lines.push(`[${idx + 1}] ${t.id}: ${t.title}`);
    lines.push(`    State: ${t.state ?? "Unknown"}  |  Worker: ${worker}  |  PR: ${pr}`);
    lines.push(`    Problem:`);
    const probText = (problem || fallback || "No problem statement").trim();
    probText.split("\n").forEach((pLine) => {
      lines.push(`      ${pLine}`);
    });
    if (deliverables.length > 0) {
      lines.push(`    Deliverables:`);
      deliverables.forEach((d) => {
        lines.push(`      * ${d}`);
      });
    }
    lines.push("");
  });

  lines.push(thinSep);
  lines.push(`[M]erge into <n>   [S]plit differently (free text)   [K]eep all distinct   [L]ater`);
  lines.push(sep);
  return lines.join("\n");
}

export function generateConsolidationMarkdown(clusters: ConsolidationCluster[]): string {
  const lines: string[] = [
    "# Creatordex Candidate Consolidation Clusters",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Total Clusters: ${clusters.length}`,
    "",
    "Review these candidate clusters for potential consolidation (Merge, Split, Keep distinct, or Later).",
    "",
  ];

  for (const cluster of clusters) {
    lines.push(`## Cluster ${cluster.id} (${cluster.tickets.length} tickets)`);
    lines.push(`- **Shared Terms**: ${cluster.sharedTokens.join(", ") || "None"}`);
    lines.push(`- **Shared Files**: ${cluster.sharedFiles.join(", ") || "None"}`);
    lines.push("");
    for (const t of cluster.tickets) {
      const desc = typeof t.description === "string" ? t.description : "";
      const { problem, fallback } = extractTriageSections(desc);
      const deliverables = extractDeliverables(desc);
      const pr = extractPrLink(desc);
      const worker = extractWorker(t);

      lines.push(`### [${t.id}] ${t.title}`);
      lines.push(`- **State**: ${t.state ?? "Unknown"}`);
      lines.push(`- **Worker**: ${worker}`);
      lines.push(`- **PR**: ${pr}`);
      lines.push(`- **Problem**: ${problem || fallback || "None"}`);
      if (deliverables.length > 0) {
        lines.push(`- **Deliverables**:`);
        for (const d of deliverables) {
          lines.push(`  - ${d}`);
        }
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
