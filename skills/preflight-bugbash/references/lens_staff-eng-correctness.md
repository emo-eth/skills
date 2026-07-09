# Staff Engineer Correctness Lens

> **Read `reviewer_discipline.md` first.** The two discipline rules (comment-vs-code divergence, cross-file exit-path reasoning) override domain/lens-specific heuristics where they conflict.

Cross-cutting reviewer. Not tied to a file type — examines the diff as a whole for correctness issues a senior engineer would catch on careful read. Complements domain reviewers; don't duplicate their pattern-matching.


### 1. Contract violations between call sites
Function signature / behavior changed, callers partially updated. Example: `fn(a, b)` gained optional `opts`, but three call sites still pass positional args and `opts` is read as `undefined`.

**Check:** For every changed exported function, `rg <name>` across repo. Verify caller semantics match new contract.

### 2. Missing edge cases
Empty array, single item, duplicates, null/undefined, negative numbers, max int, unicode, trailing whitespace, timezones, leap years, DST.

**Check:** Read the diff's logic branches. For each branch, ask: what input makes this branch wrong?

### 3. Invariant violations
New code breaks an invariant the rest of the system assumed. Example: adding a state with no transition out of it; allowing a field to be null that downstream code deref's.

**Check:** Read the surrounding module for documented or implied invariants (comments, type system, schema constraints). Verify new code preserves them.

### 4. Off-by-one, boundary, ordering
`<` vs `<=`, `i++` vs `++i`, inclusive vs exclusive range, sort stability, timestamp comparison across DST.

**Check:** Any comparison operator or array index computation in the diff — walk through with concrete values at boundaries.

### 5. Silent behavior change
Refactor claimed to be no-op but changed semantics. Order of operations, short-circuit behavior, type coercion.

**Check:** Diff hunks with same input/output types but different internal flow — verify equivalence for all inputs, not just the happy path.

### 6. Error propagation
Error caught and returned, but the caller expects a specific error type; generic `Error` loses classification. Panic in Go where the caller expected `error`.

**Check:** Error-return type consistency; typed errors unwrapped correctly; recoverable errors not panicking.

### 7. Data migration vs code deploy ordering
New code depends on a column that's added in an unreleased migration; code ships, migration lagged; prod hits NPE / SQL error.

**Check:** Diff includes both migration and code that reads it? Is there a compatibility window (code handles missing column gracefully until migration lands)?

### 8. Reversibility
Can this change be rolled back without data loss? Destructive migration (drop column, drop index, enum value removed) that code now writes to?

**Check:** Migration diffs — identify destructive ops. Verify a rollback plan exists or the change is additive only.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files. Use `domain: "lens-staff-eng"` in findings.

## Mandate

Don't re-report issues already caught by domain reviewers. Your value is the holistic view. If the diff is "correct but weird," say so and explain — even if there's no concrete bug, a senior eng's unease is signal.
