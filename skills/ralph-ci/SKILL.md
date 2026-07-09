---
name: ralph-ci
description: "Autonomous push-fix-watch loop that drives a PR to green AND addresses every bot review thread with a code fix. Runs local preflight (make preflight or act), fixes failures, pushes, creates/updates the PR, then watches remote CI while polling unresolved review threads via GraphQL (scripts/get-pr-feedback.sh) — the authoritative signal for Cursor BugBot, CodeRabbit, Greptile, and similar inline-comment bots. On failure, fetches logs, fixes, re-pushes, re-watches. NEVER posts replies or resolves threads on the PR — fixes land in code, bots auto-resolve, humans handle their own threads. Exits when CI is green AND every addressable finding has a pushed fix AND bugbot_state is CLEAN AND 3 consecutive clean settle polls AND PR is mergeable, or max attempts hit. Triggers include /ralph-ci, 'ralph it', 'push and watch ci', 'get this green', 'ship it and watch', or any autonomous push-and-fix-until-green request."
---

# Ralph CI

Autonomous push-fix-watch loop. Get a PR to green and get every bot comment addressed with a code fix, without human intervention.

**Never acts on behalf of the user in the PR conversation.** No replies, no resolves. Fixes land in commits; bots re-scan and auto-resolve their own threads; humans close theirs. This skill only writes code and pushes.

## Prerequisites

- GitHub CLI `gh` must be installed and authenticated. Run `gh auth status` to verify. If not ready, stop and tell the user.
- `jq` must be installed (scripts depend on it).
- Must be in a git repository with a remote configured.
- `act` (nektos/act) is strongly recommended for running GitHub Actions locally. Check with `which act`. If not installed, fall back to running checks manually. Docker must be running for `act` to work.

## When To Use

- User invokes `/ralph-ci`
- User says "ralph it", "push and watch ci", "get this green", "ship it and watch"
- User wants to push code, monitor CI, and autonomously fix failures AND bot feedback until green

## Scripts

- `scripts/get-pr-checks.sh` — Returns the authoritative blocking PR checks from `gh pr checks`, including external providers such as GCP Cloud Build previews. Use this before deciding CI is green. `gh run list` is GitHub Actions only and is not sufficient.
- `scripts/derive-local-parity.sh <check-name>` — Maps a failing PR check to the nearest local parity command for the affected package by inspecting package config (`cloudbuild.pr.yaml`, `package.json`, `Makefile`, Dockerfile).
- `scripts/get-failed-logs.sh` — Fetches failed CI logs for the most recent run on the current branch. Accepts optional `--run-id ID` to target a specific run.
- `scripts/get-pr-feedback.sh` — Returns structured JSON with unresolved review threads, bot reviews, and bot issue comments. This is the authoritative source for "what still needs addressing." Uses GraphQL `pullRequestReviewThread.isResolved` — the only reliable way to know if a BugBot/CodeRabbit/Greptile finding is still open. REST endpoints do not expose resolved state; do not hand-craft queries against them.
  - Pass `--summary` to get only counts + latest timestamps (~300 bytes vs ~2KB+). Use for polling loops where you just need to detect change. Fetch full output only when counts change.
- `scripts/resolve-thread.sh <thread_id>` — EXISTS but this skill does NOT call it. Threads are left for bots/humans to close themselves. Never invoke.
- `scripts/reply-to-thread.sh <thread_id> <body>` — EXISTS but this skill does NOT call it. Replies are the user's job. Never invoke.

## Core Principle For Bot Comments

**Default to fixing.** Fix and push. Never comment on the PR. Never resolve threads. Bots re-scan HEAD on their own schedule and auto-resolve when their finding no longer applies; humans close their own threads after verifying the fix.

An unresolved review thread — bot or human — is actionable unless you can cite a *specific* reason to skip:
- The bot is wrong in a way you can explain (e.g. "it flagged a null check but the caller already validates").
- The finding is explicitly out of scope (documented in the PR description).
- The fix is already present elsewhere in the diff.

Do NOT skip on vague grounds ("subjective style", "nit", "informational"). If the bot flagged it as a bug, correctness, security, or performance issue, treat it as actionable until you have a concrete counter-reason.

If you skip a thread, document the reason in the final report. Do not silently ignore, and do not reply or resolve on the PR.

## The Ralph Loop

```
RALPH_MAX_REMOTE_ATTEMPTS = 5

Phase 1: LOCAL PREFLIGHT (CRITICAL — run EVERYTHING locally before pushing)
    This is the most important phase. Remote CI failures are expensive (slow feedback,
    wasted runner minutes, noise for other contributors). Catch everything you can locally.

    1a. DETECT what checks the repo has:
        Look for: package.json scripts, Makefile targets, CI workflow files (.github/workflows/),
        pre-commit hooks, .eslintrc, tsconfig.json, pyproject.toml, Cargo.toml, etc.
        Understand what the CI pipeline actually runs so you can mirror it locally.

    1b. RUN CI LOCALLY — use the repo's canonical preflight as a baseline, then run targeted parity for failing scoped checks:
        FIRST: If the repo exposes a canonical local preflight command, use it as the
        default gate before any push. Prefer this order:
            make preflight
            make ci-preflight
            repo-specific equivalent documented in Makefile / package.json / docs

        IMPORTANT: For ralph, prefer a branch-wide or before-push command such as
        `make preflight`. Do NOT substitute a staged-only command such as
        `make preflight-staged` unless the repo has no broader option.

        THEN: Treat repo preflight as a broad sanity gate, not proof that every CI
        surface is covered. If a failing PR check points at a specific package or app,
        derive and run the nearest package-local parity command directly:
            scripts/derive-local-parity.sh "<failing-check-name>"

        Mapping policy:
            - preview/build/deploy for package X -> run package X's production build locally
            - lint/type/test/generate for package X -> run that package-local command directly
            - if no explicit mapping exists -> inspect package.json / Makefile / CI config /
              cloudbuild.pr.yaml and infer the closest local parity command

        If local preflight fails first for an unrelated environment problem, do NOT stop
        there. Continue targeted reproduction for the failing remote check as long as the
        preflight failure is clearly unrelated to that scoped check.

        THEN: If `act` is available and the repo's GitHub Actions surface is broader than the local
        preflight command, use `act` to run the GitHub Actions workflows directly.
            act push
            act pull_request
            act -j <job_name>
            act --list

        FALLBACK: If there is no repo-owned preflight command and `act` is not available,
        build the local suite manually in order:
            - Lint (eslint, ruff, golangci-lint, clippy, etc.)
            - Type check (tsc --noEmit, mypy, pyright, etc.)
            - Build / compile
            - Unit tests
            - Integration tests if they can run locally

    1c. FIX FAILURES:
        If anything fails → apply fix-loop skill (up to 3 fix attempts per failure).
        If fix-loop escalates → stop and report to user. Do not push broken code.

    1d. VERIFY ALL GREEN:
        Re-run the full suite one final time to confirm everything passes together.

Phase 2: COMMIT & PUSH
    Stage changed files.
    Commit with a descriptive message.
    Push to remote with tracking: git push -u origin $(git branch --show-current)

    INTEGRATE BASE (merge, not rebase):
        Default integration strategy is `git merge`, not `git rebase`. Rebase
        rewrites history, which risks clobbering PR commits during a
        force-push race. Merge preserves every commit and every PR reviewer
        context intact.
            base=$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null || echo dev)
            git fetch origin "$base"
            # Only merge if base has advanced:
            if ! git merge-base --is-ancestor "origin/$base" HEAD; then
                git merge --no-ff "origin/$base" -m "chore: merge origin/$base into $(git branch --show-current)"
            fi
        On merge conflict: resolve, `git add`, `git commit`. Never
        `git merge --abort` silently — surface conflicts to the user if non-trivial.

    CONCURRENT-PUSH RECOVERY:
        Between your local work and `git push`, the remote branch may have
        advanced (another contributor, another agent, merge queue autofix).
        If `git push` is rejected as non-fast-forward, do NOT force-push.
        Fetch, merge `origin/<branch>` into HEAD (preserves both sides),
        re-run local preflight, then push. Force-push is forbidden on shared
        PR branches; if absolutely required after a deliberate squash, use
        `--force-with-lease` (never `--force`).

    SQUASH-BEFORE-PUSH (rarely — opt-in only):
        Do NOT squash by default. Squashing rewrites history and invalidates
        per-commit review context. Only squash when:
          1. User explicitly asks, OR
          2. Branch is a private scratch branch with no PR yet AND >10 noisy
             WIP commits AND all authored by current user.
        Never squash once a PR exists unless the user confirms.

Phase 3: ENSURE PR EXISTS
    Check for existing PR: gh pr view --json url 2>/dev/null
    If no PR exists → create one:
        gh pr create --fill
    Report the PR URL to the user.

Phase 4: WATCH REMOTE CI + RESOLVE FEEDBACK (the ralph loop)
    remote_attempt = 0
    while remote_attempt < RALPH_MAX_REMOTE_ATTEMPTS:

        4a. WATCH CI (active waiting — do useful work while CI runs)
            Identify the current required PR checks:
                scripts/get-pr-checks.sh --summary
            Store that as the authoritative blocking state.

            Identify the latest GitHub Actions run only as supplemental detail:
                gh run list --branch $(git branch --show-current) --limit 1 --json databaseId,status
            This is useful for GitHub Actions logs, but it is not the source of truth for overall CI status.

            Active polling loop — SAME TOKEN DISCIPLINE AS 4c:
                - Run the poll as a single shell loop (Monitor or background bash).
                - Emit to stdout ONLY on state change or terminal state. A
                  stable "still running" status emits nothing.
                - Use `scripts/get-pr-feedback.sh --summary` (cheap). Only
                  upgrade to full output when counts change.
                - Poll interval 60-90s. Never exceed 270s between model wakes
                  or you lose the prompt cache (5-min TTL).

            Inside each iteration:
                1. Poll required PR checks:
                    scripts/get-pr-checks.sh --summary
                   If blocking checks change, emit CHECKS_CHANGED.

                   Separately poll GitHub Actions run status only for runs that exist:
                    gh run view {run_id} --json status,conclusion
                   If a newer Actions run exists, adopt it for Actions-log inspection,
                   but do not ignore external blocking checks.

                2. While waiting, do productive work:

                   a. CHECK FOR MERGE CONFLICTS
                      gh pr view --json mergeable,mergeStateStatus
                      If mergeable == "CONFLICTING": emit CONFLICT and break.
                          Pull latest from base branch, resolve conflicts locally.
                          Re-run local preflight + fix-loop.
                          Stage, commit (prefix: "fix(merge): resolve conflicts with {base}"), push.
                          remote_attempt++
                          Adopt the new run as target.

                   b. CHECK FOR PR FEEDBACK (summary first; only pull bodies on change)
                      summary=$(scripts/get-pr-feedback.sh --summary)
                      full=$(scripts/get-pr-feedback.sh)
                      # Threads we have not addressed yet this run:
                      new_unaddressed=$(jq -r --arg addr "$ADDRESSED" \
                        '[.unresolved_threads[].id] - ($addr | split("\n") | map(select(length>0))) | length' \
                        <<<"$full")
                      If new_unaddressed > 0:
                          Emit UNRESOLVED, break loop, and proceed to 4b.
                          Read every `unresolved_threads[].body` for threads not
                          already in `addressed_thread_ids` at that point.

                3. If remote_attempt >= RALPH_MAX_REMOTE_ATTEMPTS → escalate.

            When all required PR checks are complete:
            If every blocking check is green → proceed to 4b to verify no outstanding feedback.
            If any blocking check is failing:
                remote_attempt++
                Report: "Remote CI failure #{remote_attempt}/5 — investigating."
                Inspect the failing check via scripts/get-failed-logs.sh.
                Derive local parity via scripts/derive-local-parity.sh "<failing-check-name>".
                Fix the code locally. Re-run baseline preflight + targeted parity + fix-loop.
                Stage, commit, and push the fix.
                Proceed to 4b to also check for comments before re-watching.

        4b. ADDRESS PR FEEDBACK (runs after EVERY CI outcome)
            Run: scripts/get-pr-feedback.sh

            Never post comments on the PR. Never call scripts/resolve-thread.sh
            or scripts/reply-to-thread.sh. Fix the code, push, let bots re-scan.

            Track which threads have been addressed by this skill in an in-memory
            `addressed_thread_ids` set, keyed by thread ID. A thread is counted
            as addressed once a fix for it has been pushed (or it has been
            explicitly skipped with a documented reason).

            UNRESOLVED THREADS (primary actionable list):
                For each thread in `unresolved_threads` that is NOT in
                `addressed_thread_ids`:
                    Read path, line, author, body fully.
                    Decide: fix, or skip.

                    FIX (default):
                        Apply the fix locally at the specified path:line.
                        If multiple threads touch related code, batch them in one commit.
                        Re-run local preflight + fix-loop.
                        Stage, commit (prefix: "fix(review): {short description}"), push.
                        Add each addressed thread ID to `addressed_thread_ids`.
                        Do NOT run scripts/resolve-thread.sh.
                        remote_attempt++

                    SKIP (rare, requires concrete reason):
                        Do NOT run scripts/reply-to-thread.sh. Do NOT post any comment.
                        Record the thread ID and reason for the final report.
                        Add the thread ID to `addressed_thread_ids` so the loop
                        doesn't re-process it.

                    Do NOT silently ignore a thread. Every thread is either fixed
                    (code pushed) or documented as skipped in the final report.

            BOT REVIEW BODIES (`bot_reviews`):
                Read each body. Most are summaries referencing findings already in
                threads. If a review flags a cross-cutting concern NOT tied to a line
                (e.g. "overall the error handling pattern is inconsistent"), decide
                whether it needs a code change; if yes, fix and push. Never reply.

            BOT ISSUE COMMENTS (`bot_issue_comments`):
                Usually CI status / coverage bots. Read bodies; act only if actionable
                (code change). Never reply.

            HUMAN REVIEW COMMENTS:
                If the unresolved_threads include human authors (isBot == false) with
                requested changes, fix the code. NEVER reply on behalf of the user.
                NEVER resolve a human's thread. For large architectural redesign asks
                beyond PR scope, add to the final report and leave the thread open
                for the user — but inline correctness/bug comments should still be
                addressed with a code fix.

            When all new threads have been fixed or skipped:
                Re-run scripts/get-pr-feedback.sh to record current state for the
                final report.
                Note: threads may still show unresolved because we do not resolve
                them. That is expected. Progress is measured by
                `addressed_thread_ids` covering every item in `unresolved_threads`.
                If CI was a failure iteration → return to 4a to watch new run.
                If CI is green and every unresolved thread ID is in
                `addressed_thread_ids` → proceed to 4c.

        4c. WAIT FOR BUGBOT TO CATCH UP TO HEAD
            Addressed threads are NOT enough. Bugbot can still be processing the
            latest pushed commit and post new findings after a superficially clean
            snapshot. You must not declare DONE until Bugbot has either reviewed the
            current HEAD SHA or silent-passed (no review posted within the timeout
            window).

            Note: BLOCKING here means there is a bugbot-authored thread whose ID is
            NOT in `addressed_thread_ids`. Bugbot threads we have already fixed-or-
            skipped do not block — we do not resolve threads, so they stay
            unresolved on the PR until Bugbot re-scans on its own schedule.

            Use `scripts/get-pr-feedback.sh --summary` and read `bugbot_state`, a
            3-state field computed server-side:

              - BLOCKING — bugbot_unresolved_count > 0 AND at least one unaddressed
                           bugbot thread → return to 4b immediately
              - PENDING  — no review on HEAD yet AND head_age_min < bugbot_timeout_min
                           → keep polling
              - CLEAN    — latest review matches HEAD SHA, OR HEAD is older than
                           bugbot_timeout_min (default 6) with no unaddressed bugbot
                           threads → silent-pass; proceed to 4d

            The silent-pass timeout is what fixes the "Bugbot passes without posting
            a review, blocking ralph forever" bug. Cursor Bugbot often silent-passes
            on clean diffs: `bot_reviews.length == 0` for the current HEAD, and
            `latest_review_matches_head` stays false indefinitely. `bugbot_state`
            resolves this by treating old HEAD with zero unresolved bugbot threads
            as CLEAN.

            After every push, set:
                target_sha=$(git rev-parse HEAD)

            Then run a single shell polling loop:
              - emit only on state change
              - poll every 60-90s (≤270s to stay cache-warm)
              - on state transition to BLOCKING → break and return to 4b
              - on state transition to CLEAN   → break and proceed to 4d
              - otherwise keep polling until hard timeout

            Hard timeout:
              - If `bugbot_state` has not reached CLEAN after 15 minutes despite
                head_age_min already exceeding bugbot_timeout_min, something is
                wrong (clock skew, GraphQL outage, etc.). Escalate rather than
                declaring DONE.

            Reference implementation:

                target_sha=$(git rev-parse HEAD)
                start_ts=$(date +%s)
                prev_state=""
                while true; do
                  summary=$(scripts/get-pr-feedback.sh --summary 2>/dev/null)
                  bugbot_state=$(jq -r '.summary.bugbot_state' <<<"$summary")
                  unresolved=$(jq -r '.summary.unresolved_count' <<<"$summary")
                  head_age=$(jq -r '.summary.head_age_min' <<<"$summary")
                  if [ "$bugbot_state" != "$prev_state" ]; then
                    echo "BUGBOT_STATE: $bugbot_state (head_age=${head_age}m, unresolved=${unresolved})"
                    prev_state="$bugbot_state"
                  fi
                  case "$bugbot_state" in
                    BLOCKING) echo "BUGBOT_BLOCKING"; break ;;
                    CLEAN)    echo "BUGBOT_CLEAN"; break ;;
                  esac
                  now_ts=$(date +%s)
                  if [ $((now_ts - start_ts)) -ge 900 ]; then
                    echo "BUGBOT_TIMEOUT"
                    break
                  fi
                  sleep 60
                done

            On `BUGBOT_BLOCKING` → return to 4b.
            On `BUGBOT_CLEAN` → proceed to 4d.
            On `BUGBOT_TIMEOUT` → escalate; do not call the PR done.

            OPTIONAL RETRIGGER: Posting `@cursor review` is a PR comment on the
            user's behalf. This skill does NOT post it automatically. If Bugbot is
            silent past `bugbot_timeout_min`, the server-side state flips to CLEAN
            and you proceed to 4d. If you genuinely need a re-review trigger,
            escalate to the user so they can post it themselves.

        4d. SETTLE WAIT — async bot comments post after CI passes
            Bug bots, security scanners, and review tools often post comments 1-3
            minutes AFTER Bugbot has finished reviewing HEAD. Exit criterion:
            3 consecutive polls with CI green AND every unresolved thread ID
            already in `addressed_thread_ids` AND bugbot_state == "CLEAN".

            Unresolved thread count is NOT the exit signal on its own — we never
            resolve threads. Use the delta between `unresolved_threads[].id` and
            `addressed_thread_ids`: if empty, the settle condition is met for this
            poll.

            IMPLEMENTATION: Use a single shell loop via the Monitor tool (or a
            background bash command that emits to stdout). Do NOT do separate
            model turns per poll — that burns tokens re-reading full conversation
            context. A single shell loop keeps all polling work off-model; the
            model only wakes when the loop emits an event.

            EMIT-ON-CHANGE ONLY: The loop must print a line ONLY when state
            actually changes (unresolved_count, CI status, or new bot review
            timestamp), plus exactly one terminal line. A stable clean settle
            emits one line total (SETTLE_DONE), not three. This is the biggest
            token-cost lever in the whole skill.

            Inside the loop, use `scripts/get-pr-feedback.sh --summary` (not full)
            — it's ~87% smaller and sufficient to detect change. Fetch full
            output only if the summary indicates unresolved_count > 0.

            Hard timeout:
              - The settle loop MUST cap total wall time. Without a cap, a
                flapping upstream (e.g. a bot that keeps bumping timestamps
                without creating actionable findings) resets `settled` every
                iteration and the loop runs forever. `remote_attempt` is NOT
                incremented inside settle, so `RALPH_MAX_REMOTE_ATTEMPTS`
                offers no safety net here.
              - On timeout, escalate to the user. Do NOT declare DONE.

            Reference implementation (adapt to the harness). `ADDRESSED` is a
            newline-separated list of thread IDs that this skill has already
            fixed-or-skipped; compute `new_unaddressed` as the set of
            `unresolved_threads[].id` not in `ADDRESSED`:

                # ADDRESSED=$(printf '%s\n' "${addressed_thread_ids[@]}")
                summary=$(scripts/get-pr-feedback.sh 2>/dev/null)
                checks=$(scripts/get-pr-checks.sh --summary 2>/dev/null)
                ci=$(jq -r '.summary | "\(.blocking_count)|\(.failing_count)|\(.pending_count)|\(.all_green)"' <<<"$checks")
                new_unaddressed=$(jq -r --arg addr "$ADDRESSED" \
                  '[.unresolved_threads[].id] - ($addr | split("\n") | map(select(length>0))) | length' \
                  <<<"$summary")
                prev_state=$(jq -r '.summary | "\(.latest_review_ts)|\(.latest_thread_ts)|\(.bugbot_state)"' <<<"$summary")"|$new_unaddressed|$ci"
                settled=0
                start_ts=$(date +%s)
                SETTLE_TIMEOUT_SEC=900  # 15 minutes, generous for async bot posts
                while [ $settled -lt 3 ]; do
                  sleep 60
                  now_ts=$(date +%s)
                  if [ $((now_ts - start_ts)) -ge $SETTLE_TIMEOUT_SEC ]; then
                    echo "SETTLE_TIMEOUT"
                    break
                  fi
                  summary=$(scripts/get-pr-feedback.sh 2>/dev/null)
                  checks=$(scripts/get-pr-checks.sh --summary 2>/dev/null)
                  ci=$(jq -r '.summary | "\(.blocking_count)|\(.failing_count)|\(.pending_count)|\(.all_green)"' <<<"$checks")
                  new_unaddressed=$(jq -r --arg addr "$ADDRESSED" \
                    '[.unresolved_threads[].id] - ($addr | split("\n") | map(select(length>0))) | length' \
                    <<<"$summary")
                  state=$(jq -r '.summary | "\(.latest_review_ts)|\(.latest_thread_ts)|\(.bugbot_state)"' <<<"$summary")"|$new_unaddressed|$ci"
                  bugbot_state=$(jq -r '.summary.bugbot_state' <<<"$summary")
                  if [ "$state" != "$prev_state" ]; then
                    echo "STATE_CHANGE: $state"
                    prev_state="$state"
                    if [ "$new_unaddressed" != "0" ] || [ "$bugbot_state" = "BLOCKING" ]; then
                      echo "SETTLE_UNRESOLVED"
                      break
                    fi
                    if [ "$bugbot_state" = "PENDING" ]; then
                      echo "SETTLE_BUGBOT_STALE"
                      break
                    fi
                    settled=0
                    continue
                  fi
                  all_green=$(jq -r '.summary.all_green' <<<"$checks")
                  if [ "$new_unaddressed" != "0" ] || [ "$bugbot_state" = "BLOCKING" ]; then
                    echo "SETTLE_UNRESOLVED"
                    break
                  fi
                  if [ "$bugbot_state" = "PENDING" ]; then
                    echo "SETTLE_BUGBOT_STALE"
                    break
                  fi
                  if [ "$all_green" = "true" ]; then
                    settled=$((settled+1))
                  else
                    echo "SETTLE_CHECKS_NOT_GREEN"
                    break
                  fi
                done
                if [ $settled -ge 3 ]; then
                  echo "SETTLE_DONE"
                fi

            CACHE-WARM POLL INTERVAL: Anthropic's prompt cache has a 5-min TTL.
            If the model goes silent for >5 min, the next wake pays a full
            cache-miss (100% of input). Keeping polls ≤270s (2.5 min, with
            buffer) means every wake is a cache hit (~10% of input). For waits
            up to ~25 min, this is strictly cheaper than going cold. For waits
            >25 min (rare — long CI), a cold wake becomes cheaper than many
            warm polls, but still use ≤270s for the last 5 min before CI is
            expected to complete. Default to 60-90s polls.

            On `SETTLE_UNRESOLVED` → return to 4b.
            On `SETTLE_CHECKS_NOT_GREEN` → return to 4a.
            On `SETTLE_BUGBOT_STALE` → return to 4c.
            On `SETTLE_TIMEOUT` → escalate; do not declare DONE.
            On `STATE_CHANGE` with advancing review/thread timestamps → re-fetch full
            feedback and return to 4b when unresolved_count > 0.

        4e. FINAL MERGEABILITY CHECK
            gh pr view --json mergeable,mergeStateStatus
            If mergeable == "CONFLICTING" or mergeStateStatus == "DIRTY":
                Pull latest from base, resolve conflicts, re-run preflight.
                Commit (prefix: "fix(merge): ..."), push.
                remote_attempt++, return to 4a.
            If mergeable == "UNKNOWN":
                Wait ~10s, retry up to 3 times. Note in report if still unknown.
            If mergeable == "MERGEABLE" and mergeStateStatus == "CLEAN" → DONE.

    If remote_attempt reaches RALPH_MAX_REMOTE_ATTEMPTS:
        ESCALATE to user with full history.

Phase 5: DONE
    Report final status with PR URL, summary of threads addressed (each with
    short description: fixed or skipped+reason), list of thread IDs still open
    on the PR that bots/humans are expected to close themselves, settle checks
    passed, and mergeability.

    Threads on the PR will often still show unresolved at this point. That is
    expected — we do not resolve threads. The user decides whether to close
    them, whether to reply, and how.
```

## Commit Messages During Ralph

- Initial push: descriptive commit message for the changes
- CI fix commits: prefix `fix(ci):` — `fix(ci): add missing env var for integration test`
- Bot/review fix commits: prefix `fix(review):` — `fix(review): guard against nil user in auth middleware`
  - Applies to both bot threads (BugBot, CodeRabbit, Greptile, etc.) and human inline comments.
- Merge conflict fix commits: prefix `fix(merge):` — `fix(merge): resolve conflicts with main in config module`

## Escalation Format

When ralph gives up (local or remote):

```
## Ralph stopped after {N} remote fix attempts

**PR:** {url}

**Attempt history:**
1. [failure or feedback description] → [fix applied] → [result]
2. ...

**Unaddressed threads at exit:**
- {path}:{line} by {author}: {body excerpt} — {why it wasn't addressed}

**Threads addressed by code fix (still open on PR for bot/human to close):**
- {path}:{line} by {author}: {commit SHA that addressed it}

**Threads addressed by skip (still open on PR, documented reason):**
- {path}:{line} by {author}: {reason for skipping}

**Current failure / blocker:**
[paste relevant log output]

**My assessment:** [theory about what is wrong and why fixes aren't sticking]
```

## Rules

- **Exit criterion is hard.** DONE requires: all blocking PR checks green from `scripts/get-pr-checks.sh` AND every thread ID in `unresolved_threads` is in `addressed_thread_ids` (fixed-or-skipped by this skill run) AND `bugbot_state == "CLEAN"` AND 3 consecutive clean settle polls AND PR mergeable. Never declare DONE on any weaker condition. Never gate on `unresolved_count == 0` — we do not resolve threads, so that count will not reach zero from our actions.
- **Turn-persistence.** Ending the model turn before CI finishes is failure. Bugbot findings post asynchronously — an early exit misses them and ralph silently claims success. The polling loops in 4a/4c/4d MUST block the turn until a terminal state emits. If you are near a context limit, summarise progress and keep polling on the next turn rather than declaring DONE prematurely.
- **Merge, don't rebase.** Default base-branch integration is `git merge --no-ff origin/<base>`. Rebase is forbidden on any branch with a PR. Merge preserves every commit and every reviewer context; rebase risks losing work on force-push race.
- **Base branch default.** Use PR's `baseRefName` if a PR exists, else `origin/dev`. Never integrate against `main` unless user specifies.
- **Squash is opt-in only.** Never squash an existing PR branch. Only squash private scratch branches on explicit user ask. (Was "squash-before-rebase threshold" — removed.)
- **Concurrent push recovery.** Non-fast-forward rejection → fetch + `git merge origin/<branch>` + re-preflight + push. Force-push forbidden on PR branches. If post-squash force required, `--force-with-lease`, never `--force`.
- **Anti-clobber discipline.** Never `git reset --hard`, `git checkout -- <file>`, `git clean -f`, `git stash drop`, or `git branch -D` without user confirmation. Never `git push --force` or `--force-with-lease` when upstream has commits you don't have locally — merge first. Never `--delete-branch` on a PR branch before merge succeeds.
- **`gh pr checks` is the required CI truth source.** Treat every blocking PR check as first-class regardless of backend: GitHub Actions, Cloud Build previews, external analyzers, bug bots, or other providers surfaced in PR checks. `gh run list` is supplemental only.
- **Unresolved review threads are the authoritative actionable list.** Use scripts/get-pr-feedback.sh (GraphQL `isResolved`) — not REST `/comments` endpoints, not login-regex filters on issue comments. BugBot, CodeRabbit, Greptile, and similar post findings as inline review threads; that is the only signal that reliably tracks what's open.
- **Read thread bodies in full.** Do not act on counts or headlines. A "3 unresolved" summary with unread bodies is not progress.
- **Default to fixing bot-flagged issues.** Skip only with a concrete, articulable reason. "Subjective" / "informational" / "nit" are NOT sufficient reasons — if the bot flagged it, it's actionable until proven otherwise.
- **Every unresolved thread must be explicitly addressed by this skill run.** Either fix (push code) or skip-with-documented-reason. Silent skips are forbidden. Do NOT call `scripts/resolve-thread.sh` or `scripts/reply-to-thread.sh` — the thread stays open on the PR for the bot/human to close themselves.
- **Never post on the user's behalf.** No `gh pr comment`, no reply-to-thread, no resolve-thread, no `@cursor review` triggers. Code fixes only.
- Never push code that fails local preflight. Always fix locally first.
- Mirror CI as closely as possible locally. Read the CI workflow files, Cloud Build config, package config, and run the local equivalents.
- If a failing check maps to a package/app preview or deploy build, run that package's local production build directly instead of relying only on repo-wide preflight.
- If local preflight fails for an unrelated environment issue first, continue targeted reproduction for the failing remote check instead of stopping the investigation.
- Never suppress errors or skip checks to make CI pass (no `|| true`, no `--no-verify`).
- Never retry the exact same fix — if a fix didn't work, try a different approach.
- If a remote CI failure is clearly infrastructure/flaky (runner timeout, network error, rate limit), retry with `gh run rerun` instead of changing code. Count as an attempt.
- If a test passes locally but fails remotely, investigate environment differences (OS, language version, env vars, secrets, service dependencies). Note in any escalation.
- Each push triggers a new CI run. After pushing, adopt the new run as the target.
- Only the most recent PR check set matters. Abandon old Actions runs when newer checks supersede them.
- Never sit idle while CI runs. Use the active polling loop to check threads, merge conflicts, and run status every ~45-60s.
- When fixing issues discovered during active wait, always re-run local preflight before pushing. The push invalidates the current CI run — adopt the new run.
- Human review comments that request architectural redesigns beyond current PR scope must be flagged for the user (never replied to or resolved by this skill). Inline correctness/bug fixes should still be addressed with a code fix. In all cases, the human's thread stays open for them to close.
