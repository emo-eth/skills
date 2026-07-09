# Performance / Cost Lens

> **Read `reviewer_discipline.md` first.** The two discipline rules (comment-vs-code divergence, cross-file exit-path reasoning) override domain/lens-specific heuristics where they conflict.

Cross-cutting performance + cloud-spend review. Catches the "it works but will cost $10k/month" class of issues that correctness-focused review misses.

## Focus areas

### 1. N+1 queries
Loop that hits the DB or an HTTP API per iteration. Especially: `for each user → fetch user.transfers`.

**Check:** Any `for`/`map`/`forEach` in diff whose body does a DB or HTTP call. Can it be batched (`IN (...)`, joined, bulk endpoint)?

### 2. Unbounded fanout
Fan-out to N things where N is user-controlled or grows unboundedly. Sending a Slack message per order, creating a PostHog event per row in a backfill.

**Check:** Every place the diff emits a side effect — is N bounded? At what rate? Does it need a queue / batch / throttle?

### 3. Missing index / full-table scan
New query pattern against a large table without an index. Prefix-match on a non-indexed column. Filter on a computed column.

**Check:** New `.Where("...")` clauses against `packages/db/queries/**` — is the column indexed? Is the index usable for this predicate (ordering, prefix)?

### 4. Over-eager preload / over-fetch
`Preload()` chain pulls a large graph when the caller reads one field. GraphQL query / REST response returning the whole record where id + name would do.

**Check:** Helpers with heavy `Preload()` called by many sites; most callers only use `.ID`.

### 5. Large payload in hot path
JSON-encoding a 10MB object on every request; logging full `%+v` of a struct; serializing a full model into Sentry.

**Check:** `rg "fmt\.Sprintf\(\"%\+v\"|JSON\.stringify" ` in hot paths. Log levels set so verbose logs don't ship to prod.

### 6. Cache-busting refactor
Change invalidates a hot cache: CDN edge cache, query result cache, React memo. Example: adding a random request-ID query param to a cacheable URL.

**Check:** Refactor that changes URL shape, query params, cache keys, memo deps — analyze cache hit-rate impact.

### 7. Infinite / runaway polling
`setInterval` on a 100ms cadence, `while (true)` with no backoff, retry loops with no max attempts.

**Check:** Polling intervals — is the cadence justified? Backoff on failure? Bounded retry?

### 8. Cloud / third-party spend
Per-invocation cost adds up: Cloud Run per-request, Secret Manager accesses, LLM API tokens per request.

**Check:** New endpoint that calls an LLM → token budget? New Cloud Run service → concurrency + min-instances tuned? Secret accessed per request (can be cached in memory)?

### 9. Memory leaks / retainers
Event listener added without a removal; closure captures a large object that lives past its scope; map grown without bound.

**Check:** `addEventListener`, `on(...)` without matching cleanup. Unbounded caches / maps in long-lived servers.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files. Use `domain: "lens-perf-cost"`.

## Mandate

Focus on likely impact, not micro-optimization. A 5ms regression doesn't matter; an N+1 that will hit 10k users does. Quantify when possible ("this adds N Bridge API calls where N = org count").
