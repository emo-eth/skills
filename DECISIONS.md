# Decisions for EMO-548: prioritize-tickets

## Decision 1: Hierarchical Bins
- Bins: `now`, `next`, `later`, `never`.
- Hotkeys in TUI: `[1] Now`, `[2] Next`, `[3] Later`, `[4] Never` (or `[n] Now`, `[x] Next`, `[l] Later`, `[v] Never`).
- Default Elo per bin: Now (1600), Next (1400), Later (1200), Never (1000).

## Decision 2: State Store Format & Location
- Format: JSON.
- Path configurable: CLI flag `--state <path>` or env `PRIORITIZE_STATE_PATH`, defaulting to `~/.command-center/prioritize-state.json`.
- State structure:
  - `schema_version`: number
  - `tickets`: `{ [ticketId: string]: { elo: number, last_reviewed_at: string, comparisons: number, bin?: "now" | "next" | "later" | "never" } }`
  - `comparisons`: cached pairwise comparisons `Record<string, -1 | 1>` keyed by `${idA}:${idB}` (canonical sorted order) to ensure comparisons survive sessions.

## Decision 3: Recency Decay
- Default threshold: 14 days (`--stale-days 14`).
- If `now - last_reviewed_at > stale_days` and ticket is still in active candidate list, it resurfaces for bin re-confirmation. High confidence tickets (settled pairwise in Now) are not re-asked pairwise unless their bin changes or recency expires.

## Decision 4: --do-next Fast Path
- Goal: Produce top 1–3 tickets from `Now` in the fewest questions (<= 8 questions on 50 tickets).
- Fast path:
  1. Any ticket without a bin (or stale) gets a bin question. (With high-confidence or cached bins, only new/stale tickets are binned).
  2. If `Now` has <= 3 tickets, those are immediately the top candidates; if more than 3 tickets are in `Now`, pairwise tournament / top-k selection is run *only* within `Now` to identify the top 3.
  3. When choosing pairs to compare, pre-existing Elo scores order the tournament / comparisons and cached comparisons skip questions.
  4. If `Now` is empty, escalate to `Next`.

## Decision 5: Non-interactive Fixture Answers
- Added `--answers <path>` flag to drive the CLI deterministically with pre-recorded answers for test automation and CI.
