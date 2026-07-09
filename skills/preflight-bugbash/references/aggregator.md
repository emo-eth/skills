# Aggregator / Critic

Runs after all domain + lens subagents finish. Reads every `outputs/*.json` under `$PREFLIGHT_RUN_DIR` and produces the final report.

**Runs in the main Claude thread, not as a subagent.** The main loop needs the findings in context to offer and drive fix mode; a subagent aggregator would force another round-trip.

## Inputs

All paths below are relative to `$PREFLIGHT_RUN_DIR` (e.g. `.context/preflight/runs/<run_id>/`):

- `outputs/<domain>.json` — one file per domain subagent (e.g. `outputs/go.json`)
- `outputs/lens_<lens>.json` — one file per lens subagent (e.g. `outputs/lens_staff-eng-correctness.json`)
- `dispatched.txt` — every subagent the main agent dispatched (written by the main agent before dispatch)
- `domains_active.txt` — which domains ran
- `base_sha.txt` — the diff base
- `diff_summary.txt` — diffstat + hunk headers

## Pipeline

### 1. Load and check for failures

For every entry in `dispatched.txt`, check whether the corresponding `findings_*.json` exists and parses as valid JSON.

Track three failure modes:
- **Missing**: subagent was dispatched but no findings file exists. Treat as crash/timeout.
- **Malformed**: file exists but not valid JSON, or top-level isn't an array.
- **Bad-shape finding**: individual finding missing required fields (path, category, severity, title, evidence). Drop just that finding.

Write a `failures` array with `{subagent, reason}` for each failed reviewer. This will surface at the top of the report — no silent failures.

### 2. Normalize
Valid findings get loaded into a single list. Each carries its source `domain` / `lens` tag.

### 3. Dedupe
Two findings are duplicates when: same `path` AND same `line` (±3) AND same `category` OR overlapping titles (>70% token overlap). Keep the highest-severity + highest-confidence copy, merge `domain` field into a list.

Findings at the **same `path:line` with DIFFERENT categories** are NOT duplicates — those are separate real bugs. Keep them separate, but the rendering step will co-locate them.

### 4. Boost compound signals
If a finding is reported by 2+ domains/lenses, boost severity one tier (Low → Medium, Medium → High). Track "boosted=true" in the output so the report shows reviewer consensus.

### 5. Demote speculation
`confidence: low` AND only one domain reporting → demote to "Speculative" section.

### 6. Rank
Order within each severity tier:
- Compound signals first (≥2 domains agree)
- Then by count of findings (a cluster of related issues in one file trumps a single isolated one)
- Then alphabetically by path for stability

### 7. Render report

Use the format in `../SKILL.md` section "Output format". Include:

- **Reviewer failures** section at the top (if any). Each failed reviewer listed with reason. Skip entirely if all reviewers succeeded.
- **Signal density header** directly under the title, single line. Format: `High: N · Medium: N · Low: N · Speculative: N — focus: <recommendation>`. Recommendation picks the highest non-empty tier: any High → "High"; no High but Medium → "High + Medium"; only Low → "Low (likely noise, skim)"; nothing → "none — clean diff".
- Active/skipped domains with reasoning
- Critical (High), Should-fix (Medium), Nits (Low), Speculative
- Per-finding: title, path:line, evidence, recommendation, which domains/lenses agreed

**Co-locate same-line findings.** When 2+ findings share the exact same `path:line` (even with different categories), render them as a single cluster under one path:line header, sub-bulleted by category:

```markdown
### `packages/api/handler.go:42` — 2 issues flagged
- **[lens-perf]** N+1 query: loads transfers in loop
- **[permissions-secrets]** Missing `organization_id` filter — cross-org leak risk
```

This gives the reviewer the full picture of what's wrong at that line in one place.

**Soft-cap Low findings.** If >10 Low findings survive dedupe, render the first 10 inline and wrap the rest in a collapsed `<details>` block titled `Low findings 11–N (collapsed to reduce noise — expand to review)`. Every finding is preserved — nothing is silently dropped. The cap exists because a wall of Lows trains reviewers to skim past real High/Medium items above it.

High and Medium are never capped.

### 7a. Reviewer overlap (context for the critic, not output)

Overlap between reviewers is expected and by design — it's what produces the compound-signal boost in step 4. The critic does NOT ask subagents to coordinate; dedupe happens here.

Known-overlapping pairs (informational — use to sanity-check compound boosts):

| Pair | Typical overlap |
|---|---|
| `permissions-secrets` ↔ `lens_security-auth` | tenant-scope breaks, secret handling, webhook signing |
| `database` ↔ `lens_performance-cost` | N+1 queries, unbounded scans, missing indexes |
| `go` / `typescript-next` ↔ `lens_staff-eng-correctness` | contract drift, edge cases, nil/undefined handling |
| `idempotency-webhooks` ↔ `permissions-secrets` | webhook signature verification, HMAC algorithm |
| `idempotency-webhooks` ↔ `database` | external calls inside DB transactions |
| `money-currency` ↔ `lens_staff-eng-correctness` | float/cent math, decimals drift |

If two reviewers from an expected-overlap pair converge on the same finding, that's the signal working. If the same finding appears from three+ *unrelated* reviewers, treat it as very high confidence regardless of severity.

### 8. Offer fix mode

At the bottom of the report, offer: "Want me to apply fixes? Respond with `fix all`, `fix critical`, or `fix #<n>`."

**Fix flow (important — read carefully):**

When the user picks a fix mode:
1. Apply ALL selected fixes in one batch, edit-by-edit. Do not re-run subagents between individual edits.
2. After all fixes are applied, re-run **every subagent that originally matched** (domains + lenses that were active on the initial run). Fixes can introduce bugs outside the domain that flagged them, so one-domain re-verification is not sufficient.
3. Aggregate the post-fix results into a new "Post-fix verification" report.
4. If new findings appear, offer fix mode again — same cycle (batch fixes → full re-run → re-aggregate).

Do NOT re-run subagents once per individual bugfix — that's wasteful. Batch first, verify once.

## Output

Write the final report to `$PREFLIGHT_RUN_DIR/report.md`. The main skill agent reads and presents it to the user.

## Mandate

You're the critic, not another reviewer. Don't re-scan code. Trust the domain subagents' findings but be ruthless about dedup and speculation. A short, ranked, de-duped report beats a long one.

If every reviewer succeeded and the aggregate count is 0, report: "No issues found across N reviewers (M domains + L lenses). Skipped: [...]." — the absence of findings is itself useful.

If reviewers failed, the report MUST surface this. A report with "0 findings" from a run where 3 of 8 subagents crashed is a false-negative trap.
