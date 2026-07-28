---
name: session-handoff
description: Write a structured handoff document at the end of a session so the next conversation can continue without re-orientation. Use when ending a session with unfinished work, when the user asks to wrap up, or when context is too valuable to lose to compaction.
---

# Session Handoff

## Goal

Capture session state so a fresh conversation can pick up exactly where this one left off, without the user needing to re-explain context.

## When To Use

Use this skill when:

- The user says they are done for now, wrapping up, or ending the session
- There is unfinished work that will continue in a future session
- Significant decisions were made that a future session needs to know
- The user explicitly asks for a handoff document
- Context compaction is imminent and critical state would be lost

## Handoff Document

Write to `docs/log/YYYY-MM-DD-handoff.md`, dated from today. Never the repo root — the root holds only README, AGENTS/CLAUDE, and config, and a handoff is a dated session artifact like any other.

Use this structure:

```markdown
# Session Handoff — [Date]

## Current State

- **Branch:** [branch name]
- **PR:** [PR number/URL if open]
- **Phase:** [which step of any plan was completed]
- **Build/Test status:** [passing/failing, which tests]

## What Was Done

[2-5 bullet points summarizing completed work this session]

## Next Steps

[Ordered list of exactly what to do next, with specific commands, file paths, or actions]

1. ...
2. ...
3. ...

## Decisions Made

[Key architectural or scoping decisions with brief rationale]

- Decision: [what] — Rationale: [why]

## Known Issues

[Bugs, test failures, or unresolved friction points]

- [ ] [issue description]

## Context

[Any important runtime context: active accounts, environment configs, addresses, deployed contract addresses, etc.]
```

## Rules

- Be specific. "Continue implementing the bridge" is useless. "Run `forge test --match-test test_bridgeFee` to verify the fee fix, then update the reconciler in `pkg/reconciler/across.go` to handle the new token" is useful.
- Include exact file paths, not package names.
- Include exact commands where applicable.
- Only include decisions that a fresh session wouldn't be able to derive from the code.
- Do not include information that is already in CLAUDE.md or the codebase.
- If a .context/progress.md exists from the phase-tracker skill, reference it rather than duplicating its content.
- Keep it concise. A fresh session should be able to read this in under 30 seconds and know exactly what to do.

## Prior handoffs

One file per session, each dated — so there is nothing to archive and nothing to overwrite. Write a new `docs/log/YYYY-MM-DD-handoff.md` and leave every earlier one intact.

- **Never delete or prune old handoffs.** The dated log *is* the history of how the work proceeded; trimming it destroys the evidence a future session needs to understand why things are the way they are.
- If today already has a handoff, append to it under a `## Later that day` heading rather than starting a second file for the same date.
- If the previous handoff's "Next Steps" were completed, do not restate them — the new handoff describes the current frontier only. A reader who wants the trail reads the earlier files.

If the repo has a `docs/STATE.md`, a handoff is not a substitute for updating it. The handoff carries *session* continuity; `STATE.md` carries *project* currency, and per `project-state` it must be updated in the same commit as the work.
