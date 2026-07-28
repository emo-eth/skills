---
name: autonomous-pr
disable-model-invocation: true
description: Use when the user asks to drive a specific GitHub PR to ready-to-merge state without intervention — ship PR N, get this PR ready to merge, autonomously handle CI, review threads, Bugbot state, and mergeability. NEVER merges; human approval is always required to merge in this repo.
---

# Autonomous PR

Drive a single PR to **ready-to-merge** state without human intervention. This skill never merges. A human always merges in this repo. The skill exits only once all comments are addressed, all blocking checks are green, Bugbot is CLEAN at HEAD, and the PR is mergeable — verified across multiple settle polls so async bot findings (Bugbot especially) cannot land after exit.

Builds on `ralph-ci`. Reuses its scripts in `.claude/skills/ralph-ci/scripts/` directly — do not reimplement them here.

## Subagent backend

Triage/fix/conflict subagents route through Codex (`gpt-5.4`, reasoning=high) by default. Flip via `NM_SKILL_SUBAGENT_MODEL`:

| Value | Backend |
|---|---|
| unset / `codex` / unknown | Codex via `.claude/skills/_shared/dispatch_codex.sh` |
| `claude` | `Agent(subagent_type=general-purpose, model=opus)` |

The main loop (shell, gh, git, preflight, merge) always runs in the main Claude context. Subagents are dispatched only for the three judgment-heavy roles defined in `references/role_<name>.md`. See `.claude/skills/_shared/README.md` for the helper contract.

**Run-scoped scratch dir.** Each `/autonomous-pr` invocation gets `.context/autonomous-pr/runs/<pr>-<loop_n>/` with `prompts/` and `outputs/` subdirs. The loop counter (`loop_n`) increments on every dispatch within the same run so parallel agents do not collide.

```bash
loop_n=0
run_root=".context/autonomous-pr/runs"
# At start of each iteration that will dispatch:
loop_n=$((loop_n+1))
run_dir="$run_root/${PR}-${loop_n}"
mkdir -p "$run_dir/prompts" "$run_dir/outputs"
export AUTONOMOUS_PR_RUN_DIR="$run_dir"
```

## When to Use

- User invokes `/autonomous-pr <PR_NUMBER>`
- User says "drive PR N to ready-to-merge", "ship PR N autonomously", "get this PR ready to merge"
- Target PR is open, not draft

## When NOT to Use

- PR is draft → Cursor BugBot skips drafts entirely. Mark ready-for-review first or switch to `ralph-ci`.
- User wants the agent to actually merge → not supported. Human always merges in this repo.

## Prerequisites

- `gh auth status` green, `jq` available
- Checked out to the PR branch: `gh pr checkout <PR_NUMBER>`
- Repo exposes a preflight command. In this repo: `make preflight` (branch-wide, not `make preflight-staged`).
- Ralph-ci skill installed in the same workspace at `.claude/skills/ralph-ci/`.

## Scripts (reused from ralph-ci unless noted)

- `../ralph-ci/scripts/get-pr-feedback.sh [--summary] [--timeout-min N]` — authoritative feedback state. Summary includes `bugbot_state`, `unresolved_count`, `bugbot_unresolved_count`, `head_age_min`, `bugbot_timeout_min`.
- `../ralph-ci/scripts/get-pr-checks.sh [--summary]` — authoritative CI state across GitHub Actions AND external providers (Cloud Build, etc.). `gh run list` is GHA-only; do not use it as the single source of truth.
- `../ralph-ci/scripts/get-failed-logs.sh [--run-id ID]` — fetch failed CI logs.
- `../ralph-ci/scripts/derive-local-parity.sh <check-name>` — map a failing PR check to the nearest local parity command.
- `../ralph-ci/scripts/resolve-thread.sh <thread_id>` — EXISTS but this skill does NOT call it. Threads are left for bots/humans to close. Never invoke.
- `../ralph-ci/scripts/reply-to-thread.sh <thread_id> <body>` — EXISTS but this skill does NOT call it. Replies are the user's job. Never invoke.
- `scripts/status-log.sh` — emit one structured JSON status line per iteration.
- `scripts/poll-wait.sh <phase>` — phase-aware sleep that respects the 5-min prompt-cache TTL.

## Core Flow

```
AUTONOMOUS_PR_MAX_ITERATIONS = 10
SETTLE_CHECKS_REQUIRED       = 3
BUGBOT_TIMEOUT_MIN           = 6
BUGBOT_RETRIGGER_AFTER_MIN   = 4   # optional: @cursor review nudge

iteration = 0
loop:
    iteration++
    if iteration > AUTONOMOUS_PR_MAX_ITERATIONS: ESCALATE

    ## 1. SYNC (merge, never rebase)
    git fetch origin
    base=$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null || echo dev)
    # Default integration strategy: merge origin/$base into HEAD, no-ff,
    # so every commit and every PR reviewer context is preserved.
    # Rebase is forbidden on branches with an open PR — it rewrites history
    # and risks clobbering PR commits on any subsequent force-push race.
    if ! git merge-base --is-ancestor "origin/$base" HEAD; then
        git merge --no-ff "origin/$base" -m "chore: merge origin/$base"
        # On conflict: resolve inline, re-run preflight, continue.
        # Never `git merge --abort` silently. Surface non-trivial conflicts.
    fi
    # Do NOT squash PR branch history. Squash is opt-in only (see Rules).

    ## 2. GATHER SIGNAL — deterministic, shell-only
    Run these sequentially in the main loop. All four produce boolean/structured
    output; none need an agent.

      feedback:
        `../ralph-ci/scripts/get-pr-feedback.sh` → bugbot_state, unresolved
        threads list (with bodies, paths, thread_ids).

      checks:
        `../ralph-ci/scripts/get-pr-checks.sh --summary` → any FAILING ?
        For each failing blocking check, fetch log via
        `../ralph-ci/scripts/get-failed-logs.sh` and local parity via
        `../ralph-ci/scripts/derive-local-parity.sh "<check-name>"`.

      mergeability:
        `gh pr view <N> --json mergeable,mergeStateStatus,headRefOid,baseRefName`
        CONFLICTING list comes from `git ls-files -u` after a trial rebase.

      cve:
        `gh api repos/{owner}/{repo}/dependabot/alerts --jq '[.[] | select(.state=="open")]'`
        filtered to manifests in `gh pr diff --name-only`. Empty = skip.
        Scheduled sweep: skip if last-sweep marker <24h.

    Collect all four into decision record. No subagents needed yet.

    ## 3. ACT
    For each domain with actionable work, decide agent-vs-inline:

      **Agent-worthy** (judgment-heavy):
        - **bugbot thread classification + fix** — each unresolved thread needs
          valid/false-positive/nit classification AND a code fix (or a
          documented skip). Main loop context bloats fast. Dispatch ONE subagent:
          give it the full threads array + HEAD SHA; it returns
          {resolutions:[{thread_id, action:"fix"|"skip", patch?, skip_reason?}]}.
          Main loop applies patches serially. Never post replies or resolve
          threads — bots re-scan HEAD and auto-resolve; humans close their own.
        - **CI failure root-cause fix** when log > ~200 lines or cross-file
          refactor needed. Give it the log + parity_cmd; it returns a patch.
          Small failures (typo, import, lint) → fix inline, no agent.
        - **Non-trivial merge conflict resolution** (logic files, >2 hunks).
          Generated files (lockfiles, types) → regenerate inline.

      **Inline** (deterministic):
        - Merge base branch (no conflicts).
        - CVE bump: edit go.mod/package.json to fixed_version, run tidy/install.
        - Lockfile/generated-type regen.

      **Parallelism rule:** only parallelise subagents if they touch DISJOINT
      file sets. Bugbot fixes + CI fixes typically overlap — run serially to
      avoid clobbering each other's edits. A bugbot-triage agent and a
      cve-audit agent on unrelated manifests CAN go parallel.

      Commit prefixes:
        bugbot → "fix(review): ", ci → "fix(ci): ",
        conflict → "fix(merge): ", cve → "fix(deps): "

      VERIFY LOCALLY: `make preflight`
        Fail → fix-loop (max 3 attempts), else ESCALATE.
      PUSH:
        `git push` (plain; never `--force`). On non-fast-forward rejection:
        fetch, `git merge origin/<branch>`, re-preflight, retry.
        Force-push is forbidden on PR branches. `--force-with-lease` permitted
        only after a user-sanctioned squash AND only when upstream has no
        commits you lack locally.
      After push succeeds, record each addressed thread_id in an in-memory
      `addressed_thread_ids` set. Do NOT call resolve-thread.sh. Do NOT post any
      comment. Bots re-scan HEAD on their own schedule and auto-resolve.
      Emit status-log, continue loop from 1.

    If no actionable work AND iteration > 1:
        Go to 4.

    ## 4. WAIT FOR BUGBOT AT HEAD
    Reuse ralph-ci §4c logic. Poll with `get-pr-feedback.sh --summary` reading
    `bugbot_state`:
        BLOCKING → back to step 2
        CLEAN    → proceed to 5
        PENDING  → sleep via `scripts/poll-wait.sh bugbot`, re-poll

    Do NOT post `@cursor review` or any other PR comment. If Bugbot is silent
    past bugbot_timeout_min, server-side state flips to CLEAN and the loop
    proceeds. If you genuinely need a re-trigger, escalate to the user.

    Hard timeout: 15 min wall-clock on this phase → ESCALATE.

    ## 5. SETTLE WAIT
    3 consecutive polls with: all blocking checks green AND every thread ID in
    `unresolved_threads` already in `addressed_thread_ids` AND
    bugbot_state=CLEAN. Use `scripts/poll-wait.sh settle` between polls. Hard
    cap 15 min → ESCALATE.

    Note: we do NOT gate on `unresolved_count == 0` — this skill never resolves
    threads, so that count will not go to zero from our actions.

    ## 6. MERGEABILITY RECHECK
    `gh pr view <N> --json mergeable,mergeStateStatus`
    If CONFLICTING → step 1.
    If UNKNOWN → sleep 10s, retry up to 3x.
    If MERGEABLE + CLEAN → step 7.

    ## 7. READY-TO-MERGE REPORT (NEVER MERGE)
    This skill MUST NOT merge. Human approval is always required in this repo.
    Do NOT call `gh pr merge` under any circumstances. Do NOT enable auto-merge
    (`gh pr merge --auto`); auto-merge would let GitHub merge the PR without the
    required human approval the moment branch protection clears.

    Emit the final ready-to-merge report (see "Ready-to-Merge Report Format")
    summarising: PR URL, HEAD SHA, all blocking checks green (with names), every
    unresolved thread ID covered by `addressed_thread_ids` (with disposition
    fix/skip+reason and commit SHA), bugbot_state=CLEAN at HEAD with head_age,
    settle polls passed (≥3), mergeable=MERGEABLE/mergeStateStatus=CLEAN.

    DONE — exit. Do not merge. Do not poll further.
```

## Bugbot Gating (3-state model)

The original bug: using `latest_review_matches_head == true` as a boolean gate. When Bugbot passes silently on a clean diff, it posts no review; `bot_reviews.length == 0` for HEAD; the boolean stays false forever; merge never opens.

The shared script `get-pr-feedback.sh` already computes `bugbot_state` correctly:

| State | Meaning | Next action |
|-------|---------|-------------|
| `BLOCKING` | ≥1 unresolved bugbot-authored thread NOT in `addressed_thread_ids` | Fix in code, push (do not resolve) |
| `PENDING` | No review at HEAD yet AND `head_age_min < bugbot_timeout_min` | Poll |
| `CLEAN` | Latest bot review matches HEAD OR HEAD older than timeout with 0 unresolved bugbot threads | Proceed |

Default timeout is 6 minutes; override via `--timeout-min N` or env `BUGBOT_TIMEOUT_MIN`.

Do NOT branch on `latest_review_matches_head` directly. It remains in the output for back-compat only.

## Subagent Dispatch Policy

Default to inline shell. Spawn a subagent only when the work is judgment-heavy or context-heavy. Three roles exist, each with a reference prompt template under `references/role_<name>.md`:

| Role | When to spawn | Reference |
|---|---|---|
| `bugbot-triage` | ≥2 unresolved Bugbot threads needing classification + fix | `references/role_bugbot-triage.md` |
| `ci-fix` | Failed CI log >~200 lines OR root cause crosses >1 file | `references/role_ci-fix.md` |
| `conflict-resolve` | Merge conflict in logic files with >2 hunks | `references/role_conflict-resolve.md` |

**Do not spawn for:**
- `go mod tidy`, `bun install`, lockfile regen, generated-type regen.
- Trivial rebase (no conflicts).
- One-file lint/typecheck/import fix.
- Reading PR state (shell scripts return structured JSON).

### Prompt assembly (backend-agnostic)

For each dispatched role, the main loop assembles one prompt file at `$AUTONOMOUS_PR_RUN_DIR/prompts/<role>.md` by concatenating:

1. Contents of `references/role_<role>.md` (role spec + output contract + discipline).
2. A live-state block populated from the current iteration:
   ```
   PR: <url from `gh pr view`>
   HEAD SHA: <git rev-parse HEAD>
   Base SHA: <git merge-base origin/<base> HEAD>
   Merge target: origin/<base>         # conflict-resolve only
   Unresolved threads: <JSON>          # bugbot-triage only
   Check name: <name>                  # ci-fix only
   Log: <tail of failing check>        # ci-fix only
   Parity cmd: <from derive-local-parity.sh>   # ci-fix only
   Conflicting files: <list>           # conflict-resolve only
   ```
3. Instructions: "Fetch file contents and diffs yourself via `git diff <base>..<head> -- <path>` and `git show <head>:<path>`. Do not read outside the scope list. Emit the JSON schema described above as your final agent message. No file writes."

Same prompt feeds both backends — no transport-specific copy.

### Dispatch (branch on backend)

```bash
backend="${NM_SKILL_SUBAGENT_MODEL:-codex}"
prompt_file="$AUTONOMOUS_PR_RUN_DIR/prompts/$role.md"
output_file="$AUTONOMOUS_PR_RUN_DIR/outputs/$role.json"

case "$backend" in
  claude)
    # Main Claude thread fires Agent() with the prompt file contents.
    # 1. Read "$prompt_file" via Read tool.
    # 2. Agent(subagent_type=general-purpose, model=opus,
    #          description="<role> <≤5 words>",
    #          prompt=<contents of prompt file>)
    # 3. Subagent's final agent message is the JSON payload (schema in role file).
    # 4. Main thread writes that final message to "$output_file".
    ;;
  codex|*)
    bash .claude/skills/_shared/dispatch_codex.sh "$prompt_file" "$output_file"
    ;;
esac

# Main loop reads $output_file with jq and applies patches/resolutions.
```

Aggregation/consumption stays in the main loop regardless of backend — the subagent never writes to disk, never applies patches, never pushes. It returns a structured payload the main loop validates and executes.

### Parallelism

Unchanged from before the backend switch.

- Serial by default. Fixes from different domains frequently touch the same files; parallel agents would clobber each other.
- Parallel ONLY when agents operate on provably disjoint file sets (e.g. `bugbot-triage` on `packages/api/*.go` + `ci-fix` on `packages/dashboard/package.json`).
- When running parallel, use distinct `loop_n` suffixes so each gets its own `run_dir`. Launch with `& ... wait` and consume both output files afterward.
- Read-only diagnostics (investigate, return patch as text) CAN run parallel; main loop applies patches serially afterward.

### When spawning

1. Identify role (`bugbot-triage` / `ci-fix` / `conflict-resolve`).
2. Assemble prompt file per the "Prompt assembly" block above.
3. Dispatch per the branch block. Helper validates output starts with `{` (payload) or `[` (findings); non-zero exit → escalate.
4. Subagent output is strict JSON per the schema in its role file — main loop runs `jq` on the output file.
5. `description` ≤5 words (Claude path only).

## Self-Verification Before Push

Every push runs `make preflight` locally first. No exceptions.

- Use `make preflight` (branch-wide), not `make preflight-staged` — the staged-only gate misses unrelated regressions that CI will catch.
- Preflight failure → `fix-loop` skill, max 3 attempts per failure. If fix-loop escalates, escalate here; never push red.
- Rationale: remote CI minutes are expensive, and every push invalidates in-flight runs + re-triggers Bugbot. Catch locally.

## Base Integration: Merge, Never Rebase

Default strategy is `git merge --no-ff origin/<base>`.

Why:
- Preserves every original commit — reviewers see exact authored code, not rewritten copies.
- Merge commits are additive; rebase is destructive (old SHAs disappear).
- Force-push is never needed after a merge → no race where upstream PR work gets clobbered.
- GitHub's "squash and merge" at final merge time still gives you linear main-branch history; interim preservation is free.

```bash
base=$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null || echo dev)
git fetch origin "$base"
if ! git merge-base --is-ancestor "origin/$base" HEAD; then
    git merge --no-ff "origin/$base" -m "chore: merge origin/$base"
fi
```

**Conflict handling:**
- Conflicts are expected and fine. Resolve them, `git add`, `git commit`.
- Never `git merge --abort` silently — surfaces are real signal.
- For generated files (lockfiles, types): take `origin/<base>` version and regenerate locally (`go mod tidy`, `bun install`, `regenerate-api-types.sh`).
- For logic conflicts >2 hunks: spawn `conflict-resolve` subagent.

**Rebase is forbidden** on any branch with an open PR. The only exceptions:
- User explicitly requests rebase.
- Private scratch branch with no PR.

## Squash-Before-Push (opt-in only)

Do NOT squash by default. Squashing rewrites history and invalidates per-commit review context. Squash only when:

1. User explicitly asks, OR
2. Branch is private scratch (no PR) AND >10 noisy WIP commits AND sole-authored.

Never squash once a PR exists without explicit user confirmation. Reflog preserves originals if recovery needed.

## Concurrent-Push Recovery

Remote branch can advance between fetch and push (another contributor, agent, merge queue, Dependabot).

- On `git push` rejected as non-fast-forward: **NEVER force-push**. Always merge first.
- Recovery: `git fetch origin <branch>` + `git merge origin/<branch>` (NOT rebase) + re-run `make preflight` + push.
- `--force` is forbidden on PR branches. `--force-with-lease` permitted only after a user-sanctioned squash AND only if `git log origin/<branch>..HEAD` confirms no upstream commits will be lost.

## Turn-Persistence

Ending a model turn before CI + Bugbot settle is failure. Async findings arrive after a superficially clean snapshot; an early "done" silently misses them.

- The polling loops in steps 4 and 5 MUST block the turn until they emit a terminal state.
- Use `scripts/poll-wait.sh` between polls — it respects the 5-min prompt-cache TTL so you get warm wakes without hammering the API.
- If you are running up against context limits during a long settle, summarise status briefly and keep polling on the next turn; do NOT declare DONE.

## Status Log

Emit one JSON line per iteration via `scripts/status-log.sh`:

```
{"ts":"2026-04-21T10:42:03Z","iteration":3,"pr":4421,"head":"a1b2c3d",
 "ci":"pending|success|failure","bugbot":"CLEAN|PENDING|BLOCKING",
 "merge":"CLEAN|DIRTY|BLOCKED|UNKNOWN","unresolved":0,
 "action":"dispatch|fix|push|settle|merge|escalate","note":"..."}
```

Tail-friendly. User can `tail -f` the file. Numeric values auto-detected.

## Ready-to-Merge Report Format

```
## PR #{N} ready to merge — awaiting human approval

**PR:** {url}
**HEAD SHA:** {sha}
**Base:** {baseRefName}
**Mergeable:** MERGEABLE / CLEAN

**Blocking checks (all green):**
- {check name} ✓
- ...

**Bugbot:** CLEAN at HEAD (head_age={m}m, bugbot_unresolved=0 at exit)
**Settle polls passed:** {n}/3

**Threads addressed by this run:**
- {path}:{line} by {author} — fixed in {commit_sha}: {short desc}
- {path}:{line} by {author} — skipped: {concrete reason}

**Threads still open on PR (left for bot/human to close themselves):**
- {thread_id} — {author} at {path}:{line}

**Next step:** human reviewer approves and merges via GitHub UI.
```

The skill never runs `gh pr merge`. Auto-merge is also disallowed.

## Escalation Format

```
## autonomous-pr stopped on PR #{N}

**PR:** {url}
**Iterations:** {n}/{MAX}

**Per-iteration log:**
{tail of status-log file}

**Blocking state:**
- CI: {...}
- Bugbot: {bugbot_state}, {bugbot_unresolved_count} unresolved, head_age={m}m
- Review threads: {unresolved_count}
- Merge: {mergeable}/{mergeStateStatus}

**Assessment:** {theory about root cause / why we can't finish}
```

## Rules

- **This skill never merges.** Human approval is always required. Do NOT call `gh pr merge`, do NOT pass `--auto`, do NOT enable auto-merge through any other path. Exiting with the PR queued for auto-merge is forbidden — branch protection clearing would merge it without the human review.
- **Exit criterion is hard.** READY-TO-MERGE requires: all blocking PR checks green AND every thread ID in `unresolved_threads` is in `addressed_thread_ids` AND `bugbot_state=="CLEAN"` AND PR mergeable=MERGEABLE + mergeStateStatus=CLEAN AND 3 consecutive settle polls. Never declare ready on anything weaker. We do NOT gate on `unresolved_count==0` since we never resolve threads.
- **Wait for Bugbot like ralph-ci does.** Bugbot frequently posts new findings minutes after CI goes green. The polling loops in steps 4 and 5 MUST block the turn until `bugbot_state` reaches CLEAN at HEAD AND 3 consecutive settle polls confirm it. Do not exit early because "everything looks green right now".
- **Use `gh pr checks` not `gh run list`.** Blocking checks from Cloud Build / external analyzers don't show up in `gh run list`.
- **Turn-persistence.** Blocking polling loops before declaring DONE. Early exit on async bot feedback is failure.
- **`bugbot_state` is the gate, not `latest_review_matches_head`.** The latter is retained only for back-compat.
- **Merge, never rebase.** Integrate base branch with `git merge --no-ff origin/<base>`. Rebase is forbidden on PR branches. Squash is opt-in only (user must ask).
- **Base branch default.** Use PR's `baseRefName` if it exists, else `origin/dev`. Never integrate against `main` unless user specifies.
- **Anti-clobber discipline.** Never `git reset --hard`, `git clean -fd`, `git checkout -- <file>`, `git stash drop`, `git branch -D`, or `git push --force` without explicit user confirmation. Never delete a PR branch before merge succeeds.
- **Every push runs `make preflight` first.** No `--no-verify`, no `|| true`, no `--admin` merge bypass.
- **Subagents return strict JSON.** If one returns prose, re-dispatch with a stricter prompt.
- **Do not override Bugbot.** The only way out of BLOCKING is fix + resolve, or a concrete reply-and-resolve with articulable reason.
- **Never merge over requested changes from a human reviewer.** Escalate.
- **Human architectural asks beyond PR scope** → escalate rather than silently drop.
- **Cache-warm poll cadence.** Active phases: 60–270s intervals. Settle/idle: up to 1800s via ScheduleWakeup. Crossing the 5-min TTL costs a full cache miss, so pick one side of 300s deliberately.

## Red Flags — Stop and Reassess

- `latest_review_matches_head` used as a boolean gate → old broken logic; read `bugbot_state` instead.
- Iteration > 5 without progress on the same failure → wrong root cause; escalate.
- Local preflight green but remote same-named check red → environment divergence (OS, runtime version, env vars, secrets). Do not keep pushing blind — investigate the diff.
- About to run `gh pr merge` (with or without `--auto`/`--admin`) → NEVER. This skill does not merge. Human approval is always required.
- About to `git push --force` or `--force-with-lease` on a PR branch → STOP. Merge, don't force.
- About to `git rebase origin/<base>` on a PR branch → STOP. Use `git merge --no-ff` instead.
- About to `git reset --hard`, `git clean -fd`, `git stash drop`, `git branch -D` without explicit user ask → STOP. Diagnose what the dirty state is first; never discard unknown work.
- Upstream has commits your local branch lacks + you were about to force-push → STOP. Fetch + merge first; those upstream commits are another contributor's or another agent's work.

## Relation to ralph-ci

- `ralph-ci` = push + watch CI until green + address feedback, for any branch.
- `autonomous-pr` = drive a specific existing PR all the way to **ready-to-merge**, with on-demand subagent dispatch + explicit mergeability + Bugbot-settle gate. Human always merges.

Both stop short of `gh pr merge`. autonomous-pr adds: targeted PR-number scope, mergeability recheck against base, on-demand subagent dispatch for judgment-heavy work (bugbot classification, large-log CI diagnosis, non-trivial conflict resolution), and a final ready-to-merge report for the human reviewer.
