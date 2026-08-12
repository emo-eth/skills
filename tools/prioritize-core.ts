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
