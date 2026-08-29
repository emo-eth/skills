import { slugifyAdvisorName, type AdvisorConfig, type DiscoveredAdvisors } from "./config.ts";
import type { AdvisorOutcome } from "./review.ts";

export const PERSIST_ENTRY_TYPE = "advisor-profile";
export const PERSIST_VERSION = 1;
export const MAX_PERSISTED_DEDUPE = 500;

export type SelectionState =
  | { mode: "off" }
  | { mode: "all" }
  | { mode: "one"; slug: string };

export interface PersistedState {
  version: number;
  selection: SelectionState;
  dedupe: string[];
  followUpCount: number;
}

export class SessionState {
  roster: DiscoveredAdvisors | undefined = undefined;
  configError: string | undefined = undefined;
  reviewError: string | undefined = undefined;
  selection: SelectionState = { mode: "all" };
  readonly dedupe = new Set<string>();
  readonly statuses = new Map<string, AdvisorOutcome>();
  followUpCount = 0;
  correctionPending = false;
  skipNextReview = false;

  resetForSession(): void {
    this.selection = { mode: "all" };
    this.dedupe.clear();
    this.statuses.clear();
    this.followUpCount = 0;
    this.correctionPending = false;
    this.skipNextReview = false;
    this.reviewError = undefined;
    this.configError = undefined;
  }

  selectedAdvisors(): AdvisorConfig[] {
    const roster = this.roster;
    if (!roster) return [];
    const selection = this.selection;
    if (selection.mode === "off") return [];
    const enabled = roster.advisors.filter((advisor) => advisor.enabled !== false);
    if (selection.mode === "all") return enabled;
    return roster.advisors.filter((advisor) => slugifyAdvisorName(advisor.name) === selection.slug);
  }

  selectionDescription(): string {
    const selection = this.selection;
    if (selection.mode === "off") return "off";
    if (selection.mode === "all") {
      const count = this.selectedAdvisors().length;
      return count === 1 ? "all (1 advisor)" : `all (${count} advisors)`;
    }
    return `"${selection.slug}"`;
  }

  selectSlug(slug: string): void {
    this.selection = { mode: "one", slug };
  }

  toPersist(): PersistedState {
    return {
      version: PERSIST_VERSION,
      selection: this.selection,
      dedupe: [...this.dedupe],
      followUpCount: this.followUpCount,
    };
  }

  applyPersist(data: unknown): void {
    if (!isRecord(data)) return;
    if (data.version !== PERSIST_VERSION) return;
    const selection = data.selection;
    if (isRecord(selection)) {
      if (selection.mode === "off" || selection.mode === "all") {
        this.selection = { mode: selection.mode };
      } else if (selection.mode === "one" && typeof selection.slug === "string" && selection.slug) {
        this.selection = { mode: "one", slug: selection.slug };
      }
    }
    if (Array.isArray(data.dedupe)) {
      this.dedupe.clear();
      for (const note of data.dedupe) {
        if (typeof note === "string" && note) this.addDedupe(note);
      }
    }
    if (typeof data.followUpCount === "number" && Number.isFinite(data.followUpCount)) {
      this.followUpCount = data.followUpCount;
    }
  }

  addDedupe(normalizedNote: string): void {
    if (this.dedupe.size >= MAX_PERSISTED_DEDUPE) {
      const oldest = this.dedupe.values().next().value;
      if (oldest !== undefined) this.dedupe.delete(oldest);
    }
    this.dedupe.add(normalizedNote);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
