# Ticket-bound attention — slice 1 capture

Date: 2026-09-18
Parent: [EMO-426](https://linear.app/emo-eth/issue/EMO-426/ticket-bound-attention)

## What landed

Herdr plugin `plugins/ticket-bound-attention/` action `capture`:

- Input: `--workspace` id or `--path` (plugin action uses `HERDR_WORKSPACE_ID`).
- Bind if GOAL.md or `.herdr-ticket` already names a Linear id. Write Map. Do not mint a second ticket.
- Else create a team EMO issue with Intention, Vibe, Done-when, and Map. Title is the human work name.
- `herdr workspace report-metadata --source ticket-bound-attention --token ticket=EMO-n`.
- Refuse ticket-number chair/work names.
- No `worktree.created` / `worktree.opened` hooks yet (slice 2).
- No `herdr worktree remove`. No Linear close. No focus steal.

## Proof

- `cd plugins/ticket-bound-attention && npm test` — 10 pass, including bind vs create and ticket-number refuse.
- `npm run check` — clean.
- Live: `node --experimental-strip-types src/main.ts --workspace w3Y` bound EMO-426, did not create.
- `herdr plugin link …/plugins/ticket-bound-attention --enabled` — plugin enabled with `capture` only.
