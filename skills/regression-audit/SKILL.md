---
name: regression-audit
disable-model-invocation: true
description: Audit a Native Markets branch or PR against `origin/dev` to find and fix regressions, unintended behavior changes, unnecessary churn, partial reverts, config drift, and silent field drops from shared-package migrations. Use when the user asks to compare a PR to `origin/dev`, find unnecessary changes, audit suspicious diffs, restore lost upstream behavior, verify a refactor or shared-package migration didn't drop functionality, or check a Sarajevo/usdh-account branch for reverted KYC/analytics/deploy wiring.
---

# Regression Audit

Audit a branch against `origin/dev`, prove what regressed, restore only lost behavior, leave intentional branch work intact.

## Subagent backend

Domain reviewers route through Codex (`gpt-5.4`, reasoning=high) by default. Flip via `NM_SKILL_SUBAGENT_MODEL`:

| Value | Backend |
|---|---|
| unset / `codex` / unknown | Codex via `.claude/skills/_shared/dispatch_codex.sh` |
| `claude` | `Agent(subagent_type=general-purpose, model=opus)` |

Aggregator always runs in the main Claude context — never as a subagent. See `.claude/skills/_shared/README.md` for the helper contract.

## Architecture

Reviewer population is **conditional** — only domains whose files the diff actually touches get dispatched. Six domain references live under `references/`:

| Tag | Triggers when diff touches |
|---|---|
| `usdh-account` | `packages/usdh-account/**` |
| `deploy-modules` | `packages/deploy/modules/**`, `*.tf`, `*.tfvars` |
| `cloudflare` | `packages/cloudflare/**` |
| `scripts` | `scripts/**`, `.github/workflows/**` |
| `shared-package` | `packages/common/**`, `packages/db/**`, `generated-types.ts`, `generated_tokens.go`, or any TS/Go import swap landing on a shared-package path |
| `go-terminology-tokens` | `**/*.go`, `packages/common/constants/contracts.go`, `packages/common/tokens/generated_tokens.go`, or any file with string containing a `Hyper`/`USDH` regression candidate |

A single file can match multiple domains (e.g. a `.go` change in `packages/common` touches `shared-package` + `go-terminology-tokens`). Dispatch every matched domain in parallel; `go-terminology-tokens` runs whenever Go files changed regardless of package.

**Main-context fallback ("narrow mode"):** if the diff is ≤1 file in exactly one domain, skip subagent dispatch and run the check inline on the main thread using that domain's reference file. Mirrors preflight-bugbash's narrow mode; cheap audits don't need subagent round-trips.

## Audit Workflow

### 0. Set up run dir + classify diff

Every invocation gets a unique scratch dir so simultaneous audits don't collide:

```bash
run_id="$(date +%s)-$$"
run_dir=".context/regression-audit/runs/$run_id"
mkdir -p "$run_dir/prompts" "$run_dir/outputs"
export NM_REGRESSION_AUDIT_RUN_DIR="$run_dir"

BASE=$(git merge-base origin/dev HEAD)
echo "$BASE" > "$run_dir/base_sha.txt"
git diff --name-only "$BASE"...HEAD > "$run_dir/changed_files.txt"
```

Classify each changed file into the six domain buckets above. Write matched domain file lists to `$run_dir/domain_<tag>.txt` and the set of dispatched domains (one per line) to `$run_dir/dispatched.txt`.

**Early exits:**
- Empty `changed_files.txt` (nothing to audit) → print "No diff vs origin/dev" and stop.
- No matched domains → run `solo` mode: one subagent using `reviewer_discipline.md` + `finding_format.md` + all changed files; no domain checklist. (Mirrors preflight's solo-reviewer.)
- ≤1 file in exactly one matched domain → narrow mode (skip dispatch, read that domain file inline, produce findings directly on the main thread).

### 1. Dispatch matched domain subagents (parallel)

For each matched domain, build a prompt file at `$run_dir/prompts/<domain>.md` by concatenating:

1. `references/reviewer_discipline.md` — discipline rules + Codex-mode rules.
2. `references/finding_format.md` — output contract (JSON array as final agent message).
3. `references/domain_<domain>.md` — the domain's category checklist.
4. **Scope block**:
   ```
   Base SHA: <contents of $run_dir/base_sha.txt>
   Head SHA: $(git rev-parse HEAD)
   Files in scope (only these — ignore anything else):
     <one path per line from $run_dir/domain_<domain>.txt>
   ```
5. **Instructions**: "For each file, run `git diff origin/dev -- <file>` to see the branch change and `git show origin/dev:<file>` for upstream state. Run `rg -n '<symbol>'` for consumer cross-checks. Apply the domain checklist + discipline. Emit findings as a JSON array — your final agent message IS the findings. Do not write files. Zero regressions = `[]`."

Do NOT inline diff content — reviewers fetch it themselves via git. Keeps prompt tokens bounded regardless of diff size.

Then dispatch (branch on backend):

```bash
backend="${NM_SKILL_SUBAGENT_MODEL:-codex}"
case "$backend" in
  claude)
    # Main Claude thread fires Agent() calls in one turn, one per domain.
    # For each domain in "$run_dir/dispatched.txt":
    #   1. Read "$run_dir/prompts/<domain>.md" via Read tool.
    #   2. Agent(subagent_type=general-purpose, model=opus,
    #            description="<domain> regression audit",
    #            prompt=<full contents of that prompt file>)
    #   3. Subagent's final agent message is the JSON findings array.
    #   4. Main thread writes that final message to "$run_dir/outputs/<domain>.json".
    # Batch all Agent() calls in a single assistant turn so they run in parallel.
    ;;
  codex|*)
    # Unknown / default → Codex. Parallelism via & + wait.
    while IFS= read -r domain; do
      [ -z "$domain" ] && continue
      bash .claude/skills/_shared/dispatch_codex.sh \
        "$run_dir/prompts/$domain.md" \
        "$run_dir/outputs/$domain.json" &
    done < "$run_dir/dispatched.txt"
    wait
    ;;
esac
```

Both backends write to the same output paths; aggregator doesn't care which backend wrote them.

### 2. Aggregate on the main thread

After all subagents finish, the **main Claude thread** merges `$run_dir/outputs/*.json`:

- Dedupe: same `path` + category + nearby line (±3) → one finding; merge `domain` field into a list.
- Boost severity when 2+ domains flag the same regression (e.g. `shared-package` + `usdh-account` agree on a dropped KYC field).
- Demote `confidence=low` single-source findings to a "Speculative" section.
- Rank within each severity tier (High → Medium → Low → Speculative), then by compound count, then alphabetical by path.

Aggregation stays in main context — subagents cannot drive the fix workflow.

### 3. Present the report + offer restore mode

Read the aggregated findings and present as a ranked list. At the bottom, offer: "Want me to restore? Respond with `restore all`, `restore high`, or `restore #<n>`."

**Restore flow:**
1. Apply ALL selected restores in one batch (each = Edit/Write against the working tree). Do NOT re-run subagents between individual edits.
2. After batch, re-run **every subagent originally dispatched**. Restores can surface new issues.
3. Re-aggregate, labelled "Post-restore verification".
4. If new findings appear, offer restore mode again.

### 4. Don't gold-plate

If a finding is speculative, the aggregator demotes it. Don't invent regressions to pad the report. A clean branch should return an empty-or-near-empty report. The negative result ("no regressions across N domain reviewers") is useful — explicitly state which domains ran and found nothing.

## Legacy single-thread workflow (reference)

The workflow below still describes the audit mental model that subagents execute. Kept for human-reference and narrow-mode fallback. Subagent dispatch above supersedes it for multi-file diffs.

### 1. Set base, scope diff

- Default base: `origin/dev` (the workspace target branch). Override only if user names another.
- Start with:
  - `git diff --name-status origin/dev...HEAD`
  - `git diff --stat origin/dev...HEAD`
- Prioritize:
  - deletion-heavy files
  - `packages/deploy/modules` and Terraform modules
  - `packages/cloudflare`
  - webhook / integration scripts under `scripts/`
  - `packages/usdh-account` (KYC, analytics, portfolio routes)
  - `packages/common` and `packages/db` (shared — changes cascade)
  - generated files: `src/lib/generated-types.ts`, `packages/common/tokens/generated_tokens.go`, Atlas migrations in `packages/db`

### 2. NM-specific regression patterns

**`packages/usdh-account` partial reverts:**
- analytics constants removed from `src/lib/analytics/events.ts`
- capture calls removed from page/flow components
- KYC fields dropped from `use-onboarding-status.ts` (esp. `bridge_kyc_status_updated_at`, `bridge_customer_status`)
- UI copy/constants removed from `src/lib/ui-text-constants.ts`
- KYC rejection, grace-period, or funnel-entry logic removed from KYC components
- `/api/portfolio` or `/api/earn/earnings` route changes that drop fields (HyperCore balances, HyperEVM base-token, earn positions, prices)
- Zerion being reintroduced into `/api/portfolio` — it was intentionally removed, do NOT re-add

**`packages/deploy/modules` drift:**
- alert thresholds
- aligner semantics (`ALIGN_SUM` vs `ALIGN_RATE`)
- health/startup probes
- Cloud Run module wiring that alters behavior vs. restructures
- IAM binding changes

**`packages/cloudflare` drift:**
- WAF/sanctions-block rule changes
- PostHog proxy worker behavior changes
- cache-rule regressions

**`scripts/` script regressions:**
- webhook signature format (especially Bridge double-SHA signing — do NOT simplify)
- env var assumptions
- changed payload semantics

**Shared-package migration masking behavior loss:**
- switching to `@nm/ts-common/*` imports while silently dropping fields or helper behavior
- replacing local imports with shared ones but failing to preserve upstream behavior
- GORM model changes in `packages/db` that drop columns / change nullability

**Generated-artifact drift:**
- `src/lib/generated-types.ts` edited by hand (should be regenerated via pre-commit hook from `packages/api/pkg/resources/`)
- `packages/common/tokens/generated_tokens.go` hand-edited
- Atlas migrations hand-modified instead of regenerated from GORM

**Go package regressions:**
- `utils.LogInfo`/`utils.LogError` replaced by logs with dynamic message strings (causes Sentry fingerprint spam)
- `utils.Must` + `utils.Wrap` chains simplified away
- abbreviated names replacing verbose ones (`tr`/`orgID`/`addr` vs `transferLog`/`organizationID`/`userAddress`)

**Terminology regressions:**
- "Hyper" used alone where `Hyperliquid`/`HyperCore`/`HyperEVM` should be specific
- `USDH` misspelled `USDHD`, `USD-H`, or product scope conflated between `packages/usdh` (usdh.com) and `packages/usdh-account`

**Token/contract constants:**
- edits to `packages/common/constants/contracts.go` — every address/chain ID must be cross-checked. Never trust diffs that change addresses without verification.

### 3. Prove each suspicion before calling it a bug

- `git diff origin/dev -- <path>`
- `git show origin/dev:<path>`
- `git log --oneline -- <path>` — did the branch reintroduce an older state?
- `rg -n "<symbol_or_field>"` — search consumers before assuming a deletion is harmless
- Name the upstream commit if the branch reverts a known fix: `git log origin/dev --oneline -- <path>`

## Fix Workflow

### 4. Restore behavior, not noise

- Reintroduce only the missing behavior from `origin/dev`.
- Preserve unrelated branch improvements.
- Do not blindly replace whole files — the branch may contain valid newer work.
- When shared generated-types lag fields `origin/dev` depends on:
  - keep the shared import if migration is intentional
  - add a local type extension rather than deleting the behavior

### 5. Repo-specific heuristics

- In `packages/usdh-account`, restore: event constants, capture payloads, KYC funnel instrumentation, `bridge_kyc_status_updated_at`, `bridge_customer_status`, KYC rejected-state copy, grace-period logic.
- In deploy modules, prefer `origin/dev` unless the branch has a newer coordinated rollout across all related modules.
- In Bridge webhook replay scripts, match server verification exactly. Double-SHA signing flow is load-bearing — never simplify it.
- For Next.js runtime / Docker path concerns, verify the build artifact directly (`bun run build`, inspect `.next/`). Don't guess.
- `/api/portfolio` is Clerk-authed and does NOT use Zerion. Zerion is only for `usdh-account` non-Hyperliquid chains via `ZERION_API_KEY`. Keep that boundary.
- `USDH_QUOTE_SECRET` and `ONCHAIN_ACTIVITY_SECRET` must match across `packages/api` and `packages/usdh-account` .env — flag any asymmetric change.

## Validation

### 6. Run narrow checks after restore

Match check to touched area:
- `terraform fmt -check -diff` for touched deploy modules
- `cd packages/usdh-account && bun run typecheck` and targeted `eslint`
- `cd packages/<pkg> && make test` for a single Go package
- targeted builds when runtime entrypoints or artifact paths are in question
- `make preflight-staged` before push on multi-file changes
- If a suspicion is cleared by direct verification, record it cleared — don't leave ambiguous.

Avoid `make test-all` unless scope demands it.

## Reporting

### 7. Report like a code review

Order findings by severity. For each:
- what regressed
- why it matters
- file path
- evidence from `origin/dev` or history (commit SHA if reverted)

Separate sections:
- confirmed regressions
- unnecessary churn
- cleared suspicions
- residual intentional drift left vs `origin/dev`

## Useful commands

```bash
git diff --name-status origin/dev...HEAD
git diff --stat origin/dev...HEAD
git diff origin/dev -- path/to/file
git show origin/dev:path/to/file
git log --oneline -- path/to/file
git log origin/dev --oneline -- path/to/file
rg -n "symbol_or_field"
```

## Decision rules

- Do not flag a diff just because it differs from `origin/dev` — show the lost behavior.
- Treat large deletions as suspicious until proven safe.
- Be skeptical of changes labeled cleanup, shared-package migration, config tidy-up, or refactor when they also remove wiring, fields, or instrumentation.
- Never trust address/chain-ID diffs without cross-checking `packages/common/constants/contracts.go` and `packages/common/tokens/generated_tokens.go`.
- Generated files edited by hand = regression. Regenerate via the proper hook.
- Prefer minimal, evidence-backed restores over broad reversions.
