# `scripts/` Regression Checklist

> **Read `reviewer_discipline.md` first.** The discipline rules override domain-specific heuristics where they conflict.

`scripts/` holds CI/CD, deployment, and operational utilities that run against live environments. Regressions here surface as silent failures: webhook replays that look healthy but verify incorrectly, backfills that skip records, deployments that succeed against the wrong target.

## Categories

### 1. webhook-signature-simplification
Webhook signing flow simplified. Critical offender: Bridge double-SHA signing.

**Check:**
- `git diff origin/dev -- 'scripts/**'` for `hmac`, `sha256`, `sha1`, `crypto.createHmac`, `signature`, `X-Signature`.
- **Bridge webhook replay** is the canonical trap: the verification flow is `sha256(sha256(body))` or a specific nested signing order. Any simplification to single-pass HMAC is a High-severity regression. Cross-check server-side verification in `packages/api` to confirm the expected flow.
- Any replacement of per-field signing with whole-body signing (or vice versa) is suspect — it silently breaks compatibility with the production webhook sender.

### 2. env-var-assumption-change
Scripts that previously required or checked specific env vars now silently skip them.

**Check:**
- `git diff origin/dev -- 'scripts/**'` for `: ${VAR:?}` / `[[ -z "$VAR" ]]` patterns removed.
- Default-value fallbacks added (`VAR=${VAR:-default}`) where the old code failed fast — flag as candidate regression if the default differs from prod expectations.
- Env vars renamed on the branch without a corresponding CI/deploy update are regressions even if local testing passes.

### 3. payload-semantics-change
Request or response payload shapes changed.

**Check:**
- `git diff origin/dev -- 'scripts/**'` for JSON field renames, reorderings, or type changes (string → number, number → stringified-number).
- Backfill scripts that previously iterated with a specific filter clause (e.g. `status=pending AND created_at > X`) now using a different clause — confirm the semantics match the operational intent.
- CSV/TSV exports with reordered columns break downstream consumers even if the column set is the same.

### 4. deploy-target-change
Scripts that previously targeted a specific environment now ambiguous or retargeted.

**Check:**
- `git diff origin/dev -- 'scripts/**'` for `GCP_PROJECT`, `CLOUD_RUN_REGION`, `SERVICE_NAME`, `gcloud` project flags.
- A deploy script defaulting to `prod` instead of `dev` (or vice versa) is High severity.
- CI workflow file changes under `.github/workflows/` that alter deploy targets count too if the branch touches them.

### 5. error-handling-removed
`set -e` removed, `|| true` added, trap handlers dropped.

**Check:**
- `git diff origin/dev -- 'scripts/**'` for `set -e`, `set -o pipefail`, `trap ... EXIT` removals.
- Added `|| true` on a previously-failing command path silently converts errors to no-ops. Flag unless commit message explicitly justifies it.
- Exit-code propagation in a script that feeds CI matters — if the script returns 0 on failure, CI passes incorrectly.

### 6. logging-or-output-regression
Log/audit output silenced or reduced.

**Check:**
- Removed `echo` / `printf` lines that previously wrote to audit logs or stdout for operator visibility.
- `2>/dev/null` added on a command where stderr was meaningful.
- Progress indicators removed from long-running scripts that operators rely on to tell whether the run is hung.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files. See `finding_format.md`.

Only report regressions actually present in the current branch vs. `origin/dev`. For signing-flow regressions, prefer High severity — silent prod-signature mismatches are a load-bearing failure mode.
