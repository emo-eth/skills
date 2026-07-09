---
name: preflight-bugbash
description: Pre-emptively find bugs in a PR branch BEFORE opening for review, mimicking the review patterns Cursor BugBot has historically flagged on this repo, plus cross-cutting staff-engineer / security / performance lenses. Use this skill whenever the user says "bugbash", "preflight", "check my branch", "review before PR", "find bugs in my diff", "what would BugBot say", "multi-review", or any request to review the current working branch / uncommitted changes against `origin/dev` for bugs. Also use proactively before finalizing any significant PR, especially ones touching handlers, migrations, terraform, auth, money math, webhooks, or feature flags. Dispatches specialized parallel subagent reviewers based on what the diff actually touches, plus three always-on holistic lens reviewers, then an aggregator-critic synthesizes findings into a single ranked report and offers iterative fixes.
---

# Preflight Bug Bash

Find bugs in the working branch before opening a PR. Mirrors recurring patterns Cursor BugBot flags on this repo (native-markets/code), derived from 295 real findings over 2 weeks, plus cross-cutting staff-eng / security / performance lenses that catch issues no single domain reviewer would.

## Subagent backend

Review/triage subagents route through Codex (`gpt-5.4`, reasoning=high) by default. Flip via `NM_SKILL_SUBAGENT_MODEL`:

| Value | Backend |
|---|---|
| unset / `codex` / unknown | Codex via `.claude/skills/_shared/dispatch_codex.sh` |
| `claude` | `Agent(subagent_type=general-purpose, model=opus)` |

Aggregator always runs in the main Claude context — never as a subagent. See `.claude/skills/_shared/README.md` for the helper contract.

## When to use

Trigger on any of:
- "bugbash", "preflight", "check my branch", "pre-review", "multi-review", "what would bugbot say"
- Before the user opens or marks a PR ready-for-review
- After a large refactor or multi-package change
- When the user is about to merge/land code and wants a final pass

Skip if the diff is purely:
- Markdown/docs-only
- Single-file typo / copy change
- Auto-generated file regeneration

## Architecture

Two reviewer populations run in parallel:

1. **Domain subagents** (conditional) — pattern-match against historical BugBot findings for a specific area (Go, Next.js, Terraform, DB, permissions/secrets, money, flags/geo, analytics, idempotency/webhooks, test-fixture drift). Only dispatched if the diff matches their signals.

2. **Lens subagents** (always-on for non-trivial diffs) — holistic reviewers that read the diff as a whole. Three lenses: staff-engineer-correctness, security-auth, performance-cost. These catch issues domains miss because they're orthogonal to area.

Then a single **aggregator-critic** subagent dedupes, boosts compound signals, demotes speculation, and renders the final report.

## Workflow

### 0. Check pattern freshness

Read `.last_refresh` in the skill directory. Format: single line, ISO date (`YYYY-MM-DD`). If missing or >60 days old, surface a one-line warning to the user BEFORE running:

> Pattern library last refreshed YYYY-MM-DD (N days ago). BugBot patterns drift — consider running `scripts/refresh_patterns.sh` to pull the last 30 days of findings and surface new patterns. Proceeding with current patterns.

Do not block on it. The skill still runs. This is a nudge, not a gate — the user decides when to refresh.

### 1. Set up the run dir + compute the real diff

Every invocation gets a unique run-scoped scratch dir so simultaneous runs don't collide and stale state is easy to clean:

```bash
run_id="$(date +%s)-$$"
run_dir=".context/preflight/runs/$run_id"
mkdir -p "$run_dir/prompts" "$run_dir/outputs"
export PREFLIGHT_RUN_DIR="$run_dir"
```

All downstream scripts read `PREFLIGHT_RUN_DIR` (default falls back to `.context/preflight` for ad-hoc shell invocations). Subagent prompts land under `$run_dir/prompts/`; findings land under `$run_dir/outputs/`.

Do **not** trust `HEAD~1` or the latest commit alone. A branch accumulates commits; reviewers care about the full diff against the base.

```bash
BASE=$(git merge-base origin/dev HEAD 2>/dev/null || git merge-base origin/main HEAD)
git diff --name-status "$BASE"...HEAD
```

Run `scripts/compute_diff.sh` to produce `$run_dir/changed_files.txt`, `$run_dir/diff_summary.txt`, `$run_dir/base_sha.txt`, and `$run_dir/comment_sweep.txt`. Includes committed + staged + uncommitted.

**Check for early-exit signals after compute_diff.sh:**

- `$run_dir/skip_reason.txt` exists → the diff is a revert PR or dep-only bump. Print the reason, don't run any subagents, stop.
- `$run_dir/narrow_mode.txt` exists → no code files changed (config/docs/infra only). **Dispatch one solo-reviewer subagent (`references/lens_solo-reviewer.md`) instead of domains+lenses.** Never fall back to the main agent reviewing directly — every review path goes through a subagent so `reviewer_discipline.md` is loaded as fresh instructions, not buried context. The solo-reviewer handles config/docs/script diffs with a generalist checklist.

### 2. Classify changed files into domains

Run `scripts/classify_diff.sh` (reads `PREFLIGHT_RUN_DIR` set in step 1). Buckets files into one or more of these 10 domains:

| Tag | Triggers when diff touches |
|---|---|
| `go` | `*.go` (any Go file) |
| `typescript-next` | `*.ts`, `*.tsx`, `*.jsx`, `*.svelte`, `packages/usdh/`, `packages/usdh-account/`, `packages/dashboard/`, `app/api/**` |
| `terraform` | `*.tf`, `*.tfvars`, `packages/deploy/`, `terraform/` dirs |
| `database` | `packages/db/**`, `*/queries/*.go`, `*.sql`, `migrations/**`, or hunks grepping `WithTx\|Unscoped\|GORM\|\.Where(\|COALESCE\|Preload(` |
| `permissions-secrets` | routes under `api/internal/**`, middleware, `.env*`, or hunks grepping `secret\|token\|credential\|organization_id\|NEXT_PUBLIC_` |
| `money-currency` | hunks mentioning `cents\|AmountToCents\|szDecimals\|floatToWire\|toFixed\|ParseFloat\|decimals\|?? 0\|\|\| 0` |
| `feature-flags-geo` | hunks mentioning `featureFlag\|isFeatureEnabled\|geo\|eligibility\|allowedCountries\|blockedCountries\|GrowthBook` |
| `analytics-observability` | hunks mentioning `posthog\.capture\|Sentry\|captureException\|log\.(info\|warn\|error)\|super.*propert` |
| `idempotency-webhooks` | webhook route paths, or hunks mentioning `webhook\|Transaction(\|WithTx\|HMAC\|signature\|idempoten\|X-Signature` |
| `test-fixture-drift` | `*_test.go`, `*.test.ts`, `*.spec.ts`, `e2e/fixtures/`, `__mocks__/`, `.github/workflows/`, regen/diff-gate scripts |

A single file can match multiple domains. See `references/dispatch_rules.md` for exact rules.

### 3. Dispatch parallel subagents (domains + lenses, all in one turn)

**Core invariant: every review runs in a subagent, never on the main thread.** This ensures `reviewer_discipline.md` is loaded as fresh instructions, not legacy context the main agent will ignore. Three dispatch shapes:

- **Normal diff** (has code files): spawn every matched domain + the three always-on lenses (staff-eng-correctness, security-auth, performance-cost). All in one response, parallel.
- **Narrow mode** (`$run_dir/narrow_mode.txt` present): spawn exactly one `lens_solo-reviewer` subagent with the full diff and file list. No domains, no other lenses.
- **Skip signals** (`$run_dir/skip_reason.txt` present): no subagents at all, per step 1.

#### 3a. Build one prompt file per role

Prompt assembly is backend-agnostic. For each dispatched role, concatenate into `$run_dir/prompts/<role>.md`:

1. **`references/reviewer_discipline.md`** (read first — discipline + Codex-mode rules).
2. **`references/finding_format.md`** (output contract — JSON array as final agent message).
3. Role-specific reference:
   - Domain role: `references/domain_<tag>.md` + file list from `$run_dir/domain_<tag>.txt`.
   - Lens role: `references/lens_<name>.md` + full file list from `$run_dir/changed_files.txt`.
4. **Scope block**:
   ```
   Base SHA: <contents of $run_dir/base_sha.txt>
   Head SHA: $(git rev-parse HEAD)
   Files in scope (only these — ignore anything else):
     <one path per line>
   Comment-sweep pre-compute: <contents of $run_dir/comment_sweep.txt>
   ```
5. **Instructions**: "For each file, run `git diff <base>..<head> -- <file>` to see the changes; run `git show <head>:<file>` or read the working tree for surrounding code. Apply checklist + discipline. Emit findings as a JSON array — your final agent message IS the findings. Do not write files. Do not read files outside the scope list. Zero findings = `[]`."

Do **not** inline diff content — the reviewer fetches what it needs via `git`. Keeps prompt tokens bounded regardless of diff size.

Write every dispatched role (one per line, e.g. `go`, `database`, `lens_staff-eng-correctness`) to `$run_dir/dispatched.txt` before dispatch. Aggregator uses this to detect silent failures.

#### 3b. Dispatch (branch on backend)

```bash
backend="${NM_SKILL_SUBAGENT_MODEL:-codex}"
case "$backend" in
  claude)
    # Main Claude thread fires Agent() calls in one turn, one per role.
    # For each role in "$run_dir/dispatched.txt":
    #   1. Read "$run_dir/prompts/<role>.md" via Read tool.
    #   2. Agent(subagent_type=general-purpose, model=opus,
    #            description="<role> review",
    #            prompt=<full contents of that prompt file>)
    #   3. Subagent's final agent message is the JSON findings array.
    #   4. Main thread writes that final message to "$run_dir/outputs/<role>.json".
    # Batch all Agent() calls in a single assistant turn so they run in parallel.
    ;;
  codex|*)
    # Unknown / default → Codex. Parallelism via & + wait.
    while IFS= read -r role; do
      [ -z "$role" ] && continue
      bash .claude/skills/_shared/dispatch_codex.sh \
        "$run_dir/prompts/$role.md" \
        "$run_dir/outputs/$role.json" &
    done < "$run_dir/dispatched.txt"
    wait
    ;;
esac
```

Both backends read the same prompt files and write to the same output paths; only transport differs. Aggregator reads `$run_dir/outputs/*.json` — it does not care which backend wrote them.

**Model (Claude path):** `model: opus`. Reasoning: if Opus wrote the bug, a smaller model won't find it. Inference is cheap vs a prod bug.

**Model (Codex path):** `gpt-5.4` at `reasoning_effort=high` (baked into `dispatch_codex.sh`).

Why parallel: context cost, not latency, is the bottleneck. ~8 subagents in parallel (typical backend PR: 4-5 domains + 3 lenses) keeps the main context small and finishes in roughly the wall-clock of the slowest. Aggregator runs after.

### 4. Aggregate with the critic

After all subagents finish, the **main Claude thread** runs the aggregator (NOT a subagent — aggregation stays in main context so the main loop can ask follow-ups and drive fix mode without another round-trip). Reads `references/aggregator.md` as instructions and every `$run_dir/outputs/*.json` file, then:

- Dedupes (same path + line ±3 + category ⇒ one finding; merges `domain` field into a list)
- Boosts severity when 2+ domains/lenses agree on the same finding (compound signal)
- Demotes low-confidence single-source findings to a "Speculative" section
- Ranks within each severity tier (compound first, then cluster count, then alphabetical by path)
- Writes the final report to `$run_dir/report.md`

### 5. Present the report and offer fix mode

Read `report.md` and present to the user. At the bottom, offer: "Want me to apply fixes? Respond with `fix all`, `fix critical`, or `fix #<n>`."

**Fix flow (batched, not per-bug):**

1. Apply ALL selected fixes in one batch (each fix = Edit/Write, done in sequence). Do NOT re-run subagents between individual edits — that's wasteful.
2. After all fixes are applied, re-run **every subagent that originally matched** (same set from step 3). Fixes can introduce new bugs outside the domain that flagged the original — so full re-verification, not per-domain re-check.
3. Aggregate the post-fix run into a new report labeled "Post-fix verification".
4. If new findings appear, offer fix mode again (same cycle: batch → full re-run → re-aggregate).

### 6. Don't gold-plate

If a finding is speculative, the aggregator demotes it. Don't invent issues to pad the report. A clean diff should return an empty-or-near-empty report. The negative result ("no issues across 8 reviewers") is useful — explicitly state which domains ran and found nothing.

### 7. Never skip the subagent layer

If step 3's dispatch shape says "no subagents" (skip-signal path), the skill is done — do not substitute main-thread review. If dispatch shape says "one solo-reviewer," dispatch it even if the diff looks trivial. The discipline rules in `reviewer_discipline.md` only work when a fresh subagent loads them as primary instructions. Main-thread review without subagent dispatch is an anti-pattern this skill exists to prevent.

## Output format (report.md)

```markdown
# Preflight Bug Bash — <branch-name>

Base: <sha> (origin/dev)
Diff: <N> files, +<adds> / -<dels> lines
Domains run: go, database, permissions-secrets, money-currency, idempotency-webhooks
Lenses run: staff-eng-correctness, security-auth, performance-cost
Domains skipped: terraform (no .tf), feature-flags-geo (no gating code), test-fixture-drift (no test files)

## Critical (High)

### [permissions-secrets + lens-security] Missing tenant filter in new handler
`packages/api/internal/api/routes/foo/handler.go:42`
Agreed by 2 reviewers. `store.Foo.GetAll(ctx, nil)` has no `organization_id` predicate. Pattern previously leaked cross-org data in PR#1273. Add `.Where("organization_id = ?", orgID)`.

## Should-fix (Medium)

### [go] Unchecked error on GORM .Count()
...

## Nits (Low)

### [typescript-next] Duplicated `getCurrencyFamily` helper
...

## Speculative

### [lens-staff-eng] Possible silent behavior change in refactor
Low confidence, one reviewer. May be a true no-op refactor — flag for human review.

## Skipped
- terraform: no .tf files in diff
- feature-flags-geo: no geo/flag code touched

---
Want me to apply fixes? Respond with `fix all`, `fix critical`, or `fix #<n>`.
```

## Notes for dispatch

- If `origin/dev` doesn't exist, fall back to `origin/main`, then local `dev`/`main`.
- If no diff against base (branch == base), print "empty diff" and stop.
- If >10 domains+lenses match, run them all in parallel anyway — context, not time, is the cost.
- Works regardless of whether a PR is open.
- If the user points at a specific PR number, fetch its head SHA and diff against that PR's base instead.
- The three lenses ALWAYS run on non-trivial diffs. No classification needed for them.

See `references/dispatch_rules.md` for the full file→domain mapping, `references/finding_format.md` for the subagent output contract, `references/domain_*.md` for per-domain checklists, `references/lens_*.md` for the cross-cutting lens reviewers, and `references/aggregator.md` for the critic's dedupe + rank pipeline.

## Maintenance

### Pattern refresh

The domain `.md` files encode recurring BugBot patterns. Those patterns drift as the codebase and BugBot heuristics evolve, so the library gets stale if left alone.

- `scripts/refresh_patterns.sh [days]` — pulls the last N days (default 30) of merged PRs from `native-markets/code`, collects BugBot review comments, and dumps them to `.refresh-cache/comments.jsonl` with a per-path cluster summary. Does NOT auto-edit domain files — a human (or the skill agent on a follow-up pass) reads the comments, decides which patterns are now recurring (3+ occurrences) and not yet covered, and proposes `Check:` bullet additions to the relevant `domain_<tag>.md`.
- `.last_refresh` — single-line ISO date of the last refresh. Updated by `refresh_patterns.sh` on success. Read at step 0 of every invocation; >60 days old triggers a soft warning.
- `.refresh-cache/` — scratch dir for the refresh script; safe to delete anytime. Add to `.gitignore` if this skill lives in a checked-in location.
