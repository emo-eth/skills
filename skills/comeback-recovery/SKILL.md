---
name: comeback-recovery
description: When the user returns after being away or context has been lost, quickly re-orient by reading .context/progress.md, the newest docs/log/ handoff, git state, and recent history, then propose the immediate next action. Use when the conversation resumes after a gap, after compaction, or when the user asks "where were we?" — this resumes an in-flight task; use lc-project-state status instead for a project-wide briefing of what shipped, what is left, and what is blocked on the user.
---

# Comeback Recovery

## Goal

Get the user back to productive work in under 30 seconds. No re-explaining, no "what were we doing?", no wasted cycles.

## When To Use

Use this skill when:

- The user returns after being away ("I'm back", "ok where were we", "continue", "what's next")
- Context compaction has occurred and prior conversation is lost
- The user starts a new session referencing previous work
- You sense the user has lost track of what was happening

## Recovery Workflow

### 1. Check Persistent State (5 seconds)

Read these in parallel if they exist:

```
.context/progress.md          — phase tracker state, if a task is mid-flight
docs/log/ (newest handoff)    — session handoff notes; take the latest by date
docs/STATE.md                 — project map, if the repo has one
git status                    — current branch, staged/unstaged changes
git log -5                    — recent commits
```

Handoffs are one dated file per session, so take the newest by filename rather than expecting a single fixed path.

Scope discipline: this skill resumes **the task you were on**. It does not brief on the project — no milestone accounting, no ranked queue, no what-needs-the-human. That is `lc-project-state status`, which is read-only and reads `docs/STATE.md` and `docs/DECISIONS.md` properly. If the user is asking "what's left" or "what needs me" rather than "where were we," use that instead.

### 2. Build Context (5 seconds)

From what you found, determine:

- **Where we are:** branch, phase, what was last completed
- **What is next:** the immediate next action
- **What is blocking:** any known issues or failures

### 3. Present and Propose (immediately)

Output a brief recovery summary and propose the next action:

```
## Recovery

**Branch:** feature/across-usdh
**Last completed:** Phase 3 — backend route handler implemented and tests passing
**Next up:** Phase 4 — frontend token selector integration
**Status:** Clean working tree, no failures

Ready to start Phase 4. Want me to proceed?
```

Or if there is no persistent state:

```
## Recovery

**Branch:** main
**Recent commits:** [last 3 commit messages]
**Working tree:** [clean / N files modified]

No .context/progress.md or docs/log/ handoff found. What are we working on?
```

## Rules

- Never ask "what were we doing?" if there is any persistent state to read
- Always check git state — even without .context/progress.md, the branch name and recent commits tell a story
- Propose an action, don't just summarize — the user came back to work, not to read
- Keep the summary under 10 lines
- If the previous session left known failures, mention them upfront so the user isn't surprised
- If .context/progress.md exists but is stale (all phases done, or branch has moved on), say so
