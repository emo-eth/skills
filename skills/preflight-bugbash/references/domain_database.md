# Database Domain Checklist

> **Read `reviewer_discipline.md` first.** The two discipline rules (comment-vs-code divergence, cross-file exit-path reasoning) override domain/lens-specific heuristics where they conflict.

Recurring database patterns.

## Categories

### 1. missing-wrong-where-filter — most common
Query drops a predicate (state, currency, tenant). Too many or wrong rows returned.

**Check:**
- In `packages/db/queries/**` and `packages/api/**`, flag multi-tenant reads missing `organization_id =`.
- Refactors that drop `state IN (...)`, `currency =`, `account_owner_type`.
- `GetAll*(store, nil)` patterns with a `nil` filter argument.

### 2. missing-unscoped-soft-delete
Soft-delete hides rows a lookup needs; later collides with a non-partial unique index that includes deleted rows.

**Check:**
- `rg "\.Unscoped\(" ` — flag when a sibling lookup uses Unscoped but this one doesn't.
- Unique indexes should have `WHERE deleted_at IS NULL` if soft-delete is used.

### 3. nullable-column-pointer-mishandling
`*int64` / `*time.Time` always written non-nil (NULL unrepresentable), or nullable columns dereferenced without a nil check. TS mirror: `?? null` treats `0` as valid (bug).

**Check:**
- `&local` writes to `*T` where `0` / `""` has semantic meaning.
- `.UTC()` / `.Format()` on `*time.Time` without `!= nil`.
- `?? null` chains that treat `0` as nullable.

### 4. silently-discarded-db-errors
GORM `.Count()` / `.Update()` / `.First()` drop `*gorm.DB` or skip error check.

**Check:**
- `.Count(` / `.Update(` / `.First(` with unused return or missing `.Error` check.
- `err :=` followed directly by `return` (no `if err != nil`).

### 5. non-existent-or-wrong-column
SQL names a missing column, or `COALESCE(a,b)` no longer matches reconciliation semantics after a rename.

**Check:**
- Cross-check column names in raw `.Where("...")` strings against struct `gorm:"column:"` tags.
- Audit `COALESCE` calls — are the two fields semantically equivalent now?

### 6. tx-across-slow-io-and-idempotency
HTTP (Slack, Bridge) inside an open tx risks pool exhaustion; outer vs inner idempotency checks on different columns open TOCTOU races.

**Check:**
- `rg -A 30 "WithTx\(|Transaction\("` — inspect body for HTTP clients.
- Idempotency: outer WHERE vs inner WHERE should key on the same column(s).

### 7. over-eager-preload-n-plus-1 — watchlist
Helper Preloads a large graph when caller only reads `org.ID`.

**Check:**
- Callers using one scalar off a heavy-preload helper — prefer `SELECT id`.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files.
