/**
 * Durable relative-rank helpers for the Linear ticket ranker.
 *
 * Relative rank is a numeric weight (higher = more important), stored on the
 * ticket itself. It is not Linear's Urgent/High/Medium/Low priority.
 *
 * Storage preference:
 * 1. A workspace custom number field, when one exists or can be created.
 * 2. An HTML comment at the end of the issue description otherwise.
 */

import { pairKey, type ComparisonCache, type Ticket } from "./prioritize-core.ts";

export const RANK_COMMENT_RE = /<!--\s*rank:\s*(-?\d+(?:\.\d+)?)\s*-->/i;
export const RANK_FIELD_NAMES = ["relative rank", "rank weight", "rank"] as const;
export const DEFAULT_RANK_FIELD_NAME = "Relative Rank";

export type RankField = { id: string; name: string };
export type RankStorage =
  | { kind: "field"; field: RankField }
  | { kind: "comment" };

export function isRankFieldName(name: string | undefined): boolean {
  if (!name) return false;
  return RANK_FIELD_NAMES.includes(name.trim().toLowerCase() as (typeof RANK_FIELD_NAMES)[number]);
}

export function readRankFromDescription(description: string | undefined): number | undefined {
  if (!description) return undefined;
  const match = description.match(RANK_COMMENT_RE);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

export function writeRankIntoDescription(description: string | undefined, weight: number): string {
  const tag = `<!-- rank: ${weight} -->`;
  const current = description ?? "";
  if (RANK_COMMENT_RE.test(current)) {
    return current.replace(RANK_COMMENT_RE, tag);
  }
  const trimmed = current.replace(/\s+$/u, "");
  return trimmed.length > 0 ? `${trimmed}\n\n${tag}` : tag;
}

export function stripRankComment(description: string | undefined): string {
  if (!description) return "";
  return description.replace(RANK_COMMENT_RE, "").replace(/\s+$/u, "").trim();
}

export function ticketRank(ticket: Ticket): number | undefined {
  const stored = ticket.relativeRank;
  if (typeof stored === "number" && Number.isFinite(stored)) return stored;
  const fromDescription = readRankFromDescription(
    typeof ticket.description === "string" ? ticket.description : undefined,
  );
  if (fromDescription !== undefined) return fromDescription;
  return readRankFromFields(ticket);
}

export function readRankFromFields(ticket: Ticket): number | undefined {
  const fields = ticket.customFields;
  if (!Array.isArray(fields)) return undefined;
  for (const field of fields) {
    if (!field || typeof field !== "object") continue;
    const record = field as { name?: unknown; value?: unknown };
    if (!isRankFieldName(typeof record.name === "string" ? record.name : undefined)) {
      continue;
    }
    const value = Number(record.value);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

export function pickRankStorage(availableFields: RankField[]): RankStorage {
  const found = availableFields.find((field) => isRankFieldName(field.name));
  if (found) return { kind: "field", field: found };
  return { kind: "comment" };
}

/**
 * Reconstruct pairwise outcomes from stored weights.
 * Tickets without a weight do not contribute pairs.
 * Equal weights are a tie; a higher weight wins.
 */
export function comparisonsFromRanks(tickets: Ticket[]): ComparisonCache {
  const ranked = tickets
    .map((ticket) => ({ id: ticket.id, weight: ticketRank(ticket) }))
    .filter((entry): entry is { id: string; weight: number } => entry.weight !== undefined);

  const cache: ComparisonCache = {};
  for (let i = 0; i < ranked.length; i += 1) {
    for (let j = i + 1; j < ranked.length; j += 1) {
      const left = ranked[i];
      const right = ranked[j];
      const key = pairKey(left.id, right.id);
      if (left.weight === right.weight) {
        cache[key] = "tie";
        continue;
      }
      const winnerId = left.weight > right.weight ? left.id : right.id;
      const canonicalLeft = left.id < right.id ? left.id : right.id;
      cache[key] = winnerId === canonicalLeft ? "left" : "right";
    }
  }
  return cache;
}

/**
 * Keep every cached pair whose both ticket ids are still present.
 * Adding or removing a ticket therefore leaves overlapping comparisons intact.
 */
export function overlappingComparisons(
  cache: ComparisonCache,
  ticketIds: Iterable<string>,
): ComparisonCache {
  const known = new Set(ticketIds);
  const next: ComparisonCache = {};
  for (const [key, value] of Object.entries(cache)) {
    const split = key.split("\u0000");
    if (split.length !== 2) continue;
    const [idA, idB] = split;
    if (!known.has(idA) || !known.has(idB)) continue;
    next[key] = value;
  }
  return next;
}

export function mergeComparisonCaches(
  base: ComparisonCache,
  overlay: ComparisonCache,
): ComparisonCache {
  return { ...base, ...overlay };
}

/**
 * Assign durable weights after a finished ranking.
 * Ranked tickets (best -> worst) get k .. 1; everyone else gets 0.
 */
export function assignRankWeights(ranked: Ticket[], all: Ticket[]): Record<string, number> {
  const weights: Record<string, number> = {};
  const top = ranked.length;
  for (let index = 0; index < ranked.length; index += 1) {
    weights[ranked[index].id] = top - index;
  }
  for (const ticket of all) {
    if (weights[ticket.id] === undefined) weights[ticket.id] = 0;
  }
  return weights;
}

export function sameProjectSet(left: string[] | undefined, right: string[] | undefined): boolean {
  const a = [...(left ?? [])].map((value) => value.trim()).filter(Boolean).sort();
  const b = [...(right ?? [])].map((value) => value.trim()).filter(Boolean).sort();
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function projectSetLabel(projects: string[] | undefined): string {
  const list = [...(projects ?? [])].map((value) => value.trim()).filter(Boolean);
  if (list.length === 0) return "all projects";
  return list.join(", ");
}
