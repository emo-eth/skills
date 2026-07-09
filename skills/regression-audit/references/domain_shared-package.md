# Shared-Package Migration Checklist

> **Read `reviewer_discipline.md` first.** The discipline rules override domain-specific heuristics where they conflict.

"Shared-package migration" — swapping local imports for `@nm/ts-common/*` or for shared helpers under `packages/common` / `packages/db` — is the single highest-frequency source of silent field drops in the monorepo. The commit message is usually benign ("use shared X", "migrate to common Y"), but the diff often narrows types, drops helper behavior, or removes columns.

## Categories

### 1. shared-import-field-narrowing
Local type replaced with a shared type that has fewer fields.

**Check:**
- `git diff origin/dev -- '**/*.ts' '**/*.tsx'` for import-line swaps: local path → `@nm/ts-common/*` or other shared path.
- For each swap, compare the type shape: `git show origin/dev:<path>` for the local-type definition and read the shared type. If the shared type has fewer fields, confirm every dropped field is genuinely unused across the working tree.
- Common victims: `OnboardingStatus`, `PortfolioResponse`, `KYCPayload`, `TransferRoute`. Any `bridge_*` field on the Bridge-owned types is especially prone to silent drops.

### 2. helper-behavior-loss
Shared helper called instead of local, but the shared helper doesn't implement a subtle behavior the local one did.

**Check:**
- `git diff origin/dev -- '**/*.ts' '**/*.go'` for function calls renamed to a shared-package equivalent.
- Inspect the shared helper: `rg -n "func <SharedName>" packages/common/` or `rg -n "export (function|const) <SharedName>" packages/`.
- Diff the old local helper behavior against the shared helper. Edge cases (nil handling, empty-string handling, timezone handling, retry/backoff behavior) are the usual gaps.

### 3. gorm-model-column-drop
`packages/db` GORM model changes that silently drop columns, change nullability, or rename columns.

**Check:**
- `git diff origin/dev -- 'packages/db/models/**'` for removed struct fields.
- For every removed field: `rg -n "<FieldName>"` across the tree to find consumers; `rg -n "gorm:\"column:<snake_name>"` for the DB column name.
- Atlas migration generation is downstream — even if the migration compiles, data loss or `NOT NULL` breakage is a runtime regression.
- `omitempty` → removed on a `*string` pointer = empty strings now serialize as `""` instead of `null`, a behavior change.

### 4. generated-types-manual-edit
`src/lib/generated-types.ts` or `packages/common/tokens/generated_tokens.go` edited by hand.

**Check:**
- `git diff origin/dev -- 'packages/*/src/lib/generated-types.ts' 'packages/common/tokens/generated_tokens.go'`
- Any manual edit is a regression. The pre-commit hook at `packages/api/scripts/regenerate-api-types.sh` is the only correct source.
- If the diff is intentional because upstream `packages/api/pkg/resources/` changed, the source-side change must be present in the same branch — otherwise the hand edit will be reverted on next regeneration.

### 5. atlas-migration-hand-modified
Atlas migration files under `packages/db/migrations/` hand-edited instead of regenerated.

**Check:**
- `git diff origin/dev -- 'packages/db/migrations/**'` for changes to existing migration files (not net-new ones).
- Atlas migrations are generated from GORM model state via `make migrate-gen`. Hand edits mean the DB diverges from the model.
- If the diff shows an existing migration file modified (not a new file added in sequence), this is always a regression.

### 6. common-package-api-narrowing
`packages/common/*` public API narrowed in a way that breaks consumers.

**Check:**
- `git diff origin/dev -- 'packages/common/**/*.go'` for removed exported functions, types, or fields.
- `rg -n "common\.<Removed>"` across `packages/api`, `packages/jobs`, `packages/reconciler`, `packages/checker`, `packages/onboarding`, `packages/telegram-sync` for consumers that still reference the removed symbol.
- Even if the branch updates one consumer, all dependents must be checked because `common` is linked via `go.work`.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files. See `finding_format.md`.

Only report regressions actually present in the current branch vs. `origin/dev`. When flagging a shared-package migration, always name at least one consumer still depending on the removed/narrowed API — a migration with no remaining consumer is probably intentional and Low confidence at most.
