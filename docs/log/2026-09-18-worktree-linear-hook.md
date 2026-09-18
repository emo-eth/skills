# Worktree Linear hook (2026-09-18)

`plugins/ticket-bound-attention/` is a Herdr plugin that creates or binds a Linear ticket when a worktree is created or opened. No form. Linear stays the only tracker.

- Events: `worktree.created`, `worktree.opened` → `node --experimental-strip-types src/capture.ts`
- Dispatcher fallback: `herdr plugin action invoke ticket-bound-attention.capture` (or `src/capture.ts <workspace_id>`)
- Ticket face: Intention, Vibe, Done-when, Map (`Herdr: <label> (<id>)` plus path)
- Bind locations: `GOAL.md` Linear parent line; workspace metadata tokens `ticket` and `ticket_url`
- Standing rule encoded in the hook: rewrite Linear only when those face fields change; map-only patch if the chair moved
- Human names: Linear title from the Herdr label; never rename chairs to ticket ids
- Skip create for the command center (standup worktree, primary scratch checkout). Rebind if a ticket is already in GOAL.md
- Linked enabled from `/Users/emo/.herdr/worktrees/skills/ticket-bound-attention/plugins/ticket-bound-attention`
- Focused tests: 10 pass (`bun test tests/bind.test.ts`)
- Live smoke (no focus steal, no worktree remove, Linear not closed): capture `w3Y` bound EMO-426, `linear_updated: false`, workspace tokens set

Not in this slice: desk orphan listing, shelve, funeral / worktree remove.
