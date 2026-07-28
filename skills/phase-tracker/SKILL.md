---
name: phase-tracker
description: Track progress through multi-step tasks by maintaining a .context/progress.md checklist. Read it before each action, confirm context, and update after completing each phase. Use when a task has 3+ sequential phases, involves multiple accounts/environments, or spans enough work that context could drift.
---

# Phase Tracker

## Goal

Prevent context loss during multi-step work by maintaining a persistent checklist that survives context drift and conversation compaction.

## When To Use

Use this skill when:

- A task has 3 or more sequential phases
- Work involves switching between accounts, directories, or environments
- The task will take long enough that earlier context may be forgotten
- You are following an implementation plan with numbered steps
- The user has provided a multi-phase workflow to execute

Do NOT use for simple, single-action tasks.

## Setup

At the start of a multi-phase task, create `.context/progress.md`.

This is per-machine runtime state, not project history: it is mutable, it tracks one task, and it is discarded when that task ends. So it lives under `.context/` and is **not committed** — a checklist that ships in commits causes churn and conflicts across machines. Ensure the repo's `.gitignore` contains `.context/`; if it does not, add it in the same commit as the first write.

Never place it at the repo root. Durable session artifacts — handoffs, findings, status — belong in `docs/log/YYYY-MM-DD-<name>.md` instead, and those *are* committed.

```markdown
# Progress: [Task Name]

**Branch:** [current branch]
**Directory:** [working directory]
**Account/Environment:** [if applicable]
**Started:** [date]

## Phases

- [ ] Phase 1: [description]
- [ ] Phase 2: [description]
- [ ] Phase 3: [description]
...

## Context Notes

[Any important context: addresses, config values, decisions made]

## Log

[Append brief notes as phases complete]
```

## Before Each Phase

Before starting any phase, read .context/progress.md and state:

1. **Which phase is next** — by reading the checklist
2. **Current context** — branch, directory, account
3. **Any prerequisites** — what the previous phase produced that this phase depends on

If the context has drifted (wrong branch, wrong directory), fix it before proceeding.

## After Each Phase

After completing a phase:

1. Mark it complete in .context/progress.md: `- [x] Phase N: [description]`
2. Append a brief log entry with what was done and any notable output
3. Note any decisions or discoveries that affect later phases

## Rules

- Always read .context/progress.md before acting, even if you think you remember the state
- Never skip the context confirmation step
- If a phase fails or needs to be retried, note it in the log
- If the plan changes mid-execution, update the remaining phases in .context/progress.md
- Keep log entries brief — one or two lines per phase
- If the user corrects your context (wrong account, wrong branch), update .context/progress.md immediately

## Cleanup

When all phases are complete:

- Mark all items checked
- Add a final log entry summarizing the outcome
- Ask the user if they want to keep or delete .context/progress.md

If anything in the log is worth keeping beyond this task — a decision, a discovered constraint — it does not belong here. Route decisions to `docs/DECISIONS.md` (via `review-capture`) and durable findings to `docs/log/`, then let the checklist be discarded.
