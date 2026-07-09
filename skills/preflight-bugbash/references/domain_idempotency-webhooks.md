# Idempotency / Webhooks / Retries Domain Checklist

> **Read `reviewer_discipline.md` first.** The two discipline rules (comment-vs-code divergence, cross-file exit-path reasoning) override domain/lens-specific heuristics where they conflict.

Folded out of go+database because the failure modes (replay, dedup, forward-only state, external-in-tx) are domain-specific and cross-language.

## Categories

### 1. external-call-inside-db-transaction (High)
HTTP call (Clerk, Bridge, Slack, PostHog) inside `store.Transaction(...)` / `WithTx`. Rollback orphans external resource or pool exhausts under load.

**Check:**
- `rg -A 30 "WithTx\(|Transaction\("` — inspect body for `client.`, `.Post(`, `.Do(`, `.Send(`.
- Move HTTP call outside tx; commit first, then call external; on external failure, enqueue a compensating job.

### 2. wrong-signing-algorithm (High)
Webhook signature verification doesn't match provider spec (double SHA-256 where single was documented).

**Check:**
- `rg "sha256|hmac" packages/api/internal/api/routes/*_webhooks/` — diff against provider docs.
- Unit-test against a provider-supplied sample payload + signature.

### 3. outer-inner-idempotency-column-mismatch (Medium)
Outer existence check uses `template_id`; inner insert uses new `template_version_id`. TOCTOU: two workers both pass the outer check.

**Check:**
- Idempotency probe columns must match the unique index columns exactly.
- Migration that introduces a new column shouldn't leave the old column in dedup probes.

### 4. forward-only-state-missing-guard (Medium)
Transfer/order state can regress (`completed` → `pending`) because the state-write lacks a `WHERE state IN (earlier_states)` predicate.

**Check:**
- State updates must include the allowed previous-state set in the WHERE clause.
- `rg "\.Update\(.*state"` — verify guard exists.

### 5. webhook-500-instead-of-skip (Medium)
Handler 500s on invalid/unknown customer ID → provider retries forever, alerts fire.

**Check:**
- Unknown IDs or unsupported event types should ACK (200) with a no-op log, not 500.
- Distinguish "provider misconfig" (ACK+alert) from "our bug" (500).

### 6. refund-failure-blocks-webhook-ack (Medium)
Post-processing failure (Slack notify, metric emit) bubbles up, causes 5xx, provider retries the whole webhook → duplicate processing.

**Check:**
- Side effects after the primary DB write must not fail the webhook response.
- Wrap non-critical post-processing in `defer` + error log.

### 7. catch-up-deduplication (Low)
Reconciler / catch-up job emits duplicate state-change events for records already advanced by the live path.

**Check:**
- Catch-up queries should filter out records already in the target state.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files.
