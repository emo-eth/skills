# Go Domain Checklist

> **Read `reviewer_discipline.md` first.** The two discipline rules (comment-vs-code divergence, cross-file exit-path reasoning) override domain/lens-specific heuristics where they conflict.

Recurring Go patterns on native-markets/code. For each category: what to grep and what to verify in context.

## Categories

### 1. forked-logic-divergence
A helper / alert / handler exists in 2+ packages; PR fixes one copy and forgets the sibling. Most common pattern.

**Check:**
- For each new or changed function/const, `rg <symbol>` across the tree. If it appears in 2+ packages, verify sibling was also updated.
- Common hot symbols: `senderName`, `derefString`, `nilIfEmpty`, `joinCSV`, backfill handlers, webhook handlers, SEPA/ACH trace helpers.

### 2. panic-on-hot-path / `utils.Must*` misuse
`Must`, `Must2`, `os.Exit`, raw `panic` wrapping user or external-API input on a code path with a valid graceful branch below.

**Check:**
- `rg "utils\.Must2?\("` in diff. Flag when wrapping `ParseCurrency`, `AmountToCents`, `SetString`, or any field that came from an HTTP body, webhook, or external provider.
- Flag `os.Exit` / raw `panic` in handlers or job processors.

### 3. unchecked-error-or-response-discard
Return values assigned to `_` or `.Error` dropped on GORM calls.

**Check:**
- `rg ", _ [:=]*= .*\.(Update|Create|Count|Delete|First|Save)"` in diff.
- `rg "\.Count\(" ` then verify the result is assigned and error-checked.
- Functions with `(T, error)` signature called with only one return value.

### 4. nil-pointer-deref-on-optional-field
`.UTC()`, `.Format()`, `.String()`, `*ptr` on `*time.Time` / `*string` / nullable FK without nil check.

**Check:**
- `rg "\.(UTC|Format|String)\(" ` near pointer struct fields.
- Cross-check `types.go` for `*T` + `omitempty` tags; any call site dereferencing without `!= nil` guard is suspect.

### 5. missing-tenant-or-state-filter-in-query
Refactor drops `organization_id`, `state IN (...)`, `account_owner_type`, or `Unscoped()`.

**Check:**
- New `GetAll*(store, nil)` — flag immediately.
- `rg "\.Where\(" ` near new repository methods. Ensure `organization_id` is present when the model is tenant-scoped.
- Soft-delete models queried without `.Unscoped()` where uniqueness matters.

### 6. currency-unit-conversion-mismatch
EUR stored as USD cents, float for money, dollar-string → minor-unit parser.

**Check:**
- `rg "types\.CurrencyUSD"` — flag when near a field whose actual currency is dynamic.
- `rg "math\.Floor.*\* 100"` on decimal strings.
- `float64` used as a money type.

### 7. gorm-raw-sql-precedence / column-mismatch
`Where(\"a = ? OR b = ? AND c = ?\")` without parens; column names not matching `gorm:"column:"` tags.

**Check:**
- `rg "Where\(\".* OR "` — if unparenthesized, flag as High.
- Cross-check literal column names against struct tags.

### 8. empty-string-vs-nil-pointer-for-optional
`&addr.Field` on plain string field; `omitempty` misfires, DB stores `""` pointer.

**Check:**
- `rg "&\w+\.(StreetLine2|State|PostalCode|Reference|MiddleName)"` — require `utils.PtrIfNotEmpty`/`nilIfEmpty` for optional `*string` + `omitempty`.

### 9. external-call-inside-db-transaction
HTTP call (Clerk, Bridge, Slack) inside `store.WithTx` / `.Transaction()`.

**Check:**
- `rg -A 20 "WithTx\(|Transaction\("` in diff. Inspect body for `.Post(`, `.Do(`, `client.`.

### 10. pii-or-secret-leakage-in-logs
Raw body bytes, `bank_*` fields, hardcoded emails in source.

**Check:**
- `rg -i "body_b64|body_sha256|REMOVE"` in handler diffs.
- `rg "bank_"` in redaction allowlists.
- `rg "@[a-z0-9]+\.com"` in `packages/jobs`, `packages/api/cmd`.

### 11. test-prod-divergence
Prod constant flipped but test still asserts old value; helper mismatches log prefix so assertions never run.

**Check:**
- In any PR touching a `_test.go`, confirm the prod constant and test expectation agree.
- Log-matching test helpers must include the required prefix.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files. See `finding_format.md`.

Only report issues actually present in the current diff. Don't flag issues in code you merely read while investigating.
