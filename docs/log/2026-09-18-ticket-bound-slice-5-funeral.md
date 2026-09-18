# Ticket-bound attention — slice 5 funeral

Date: 2026-09-18
Parent: [EMO-426](https://linear.app/emo-eth/issue/EMO-426/ticket-bound-attention)

## What landed

Herdr plugin action `funeral`:

- Refuse unless Linear is Done, the worktree is clean, and any GOAL.md Done / Acceptance / Validation sections are operator-approved.
- Then `herdr worktree remove`. Does not mark Linear Done.
- Skill already forbids raw `herdr worktree remove`. Herdr has no pre-remove intercept; this action is the gate.

## Proof

- Package `npm test` (24) and `npm run check` pass.
- Relinked plugin; actions include `funeral`.
- Disposable `/tmp/tba-disposable-capture-proof` chair `w45` bound [EMO-453](https://linear.app/emo-eth/issue/EMO-453/disposable-capture-proof):
  - Funeral while Backlog + dirty → refused; Linear stayed Backlog.
  - Operator marked EMO-453 Done (funeral did not). Dirty still refused.
  - Clean git, then funeral → buried. Tree gone, chair gone, Linear still Done.
