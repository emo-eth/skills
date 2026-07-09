# Test / Fixture Drift Domain Checklist

> **Read `reviewer_discipline.md` first.** The two discipline rules (comment-vs-code divergence, cross-file exit-path reasoning) override domain/lens-specific heuristics where they conflict.

Often High severity — tests silently diverge from prod code or CI gates reference nonexistent paths.

## Categories

### 1. test-contradicts-prod (High)
Prod code flipped a constant/map, test still asserts old value — but CI passes because the assertion path changed too.

**Check:**
- Diff includes `_test.go` / `.test.ts` / `.spec.ts` alongside prod file? Verify prod const/map edits have matching test updates.
- Prod const/map edits WITHOUT any test change in same package → flag as suspicious.

### 2. ci-gate-references-stale-path (High)
CI script diffs a file path that was renamed/moved; script still passes because the file is absent, but drift goes undetected.

**Check:**
- Any `.github/workflows/`, `.pre-commit-scripts/`, `scripts/ci-*` in diff — verify every referenced path still exists.
- Regen scripts comparing a re-export file → must compare the actual generated file, not its re-export.

### 3. mock-omits-field (Medium)
Mock/fixture missing a field the code under test now reads; test passes because `undefined` is coerced.

**Check:**
- In `e2e/fixtures/`, `__mocks__/`, test setup files — compare mock shape to the real type. Zod parse the mock against the prod schema if possible.

### 4. test-global-mutation-parallel-race (Medium)
Test mutates a package-level global (`global.fetch`, `config.X`); parallel test worker races.

**Check:**
- `rg "global\.|process\.env\." ` in `_test.go` / `.test.ts` setup — if mutated, use `beforeEach` + `afterEach` restore, not shared state.

### 5. log-matcher-never-matches (Low)
Assertion-helper matches on a log prefix that prod log omits; `expect().toHaveBeenCalled` is satisfied but actual match is empty.

**Check:**
- Log-matching test helpers must include a required discriminator string; verify prod logs emit that string.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files.
