# Ticket-bound attention — slice 4 desk and shelve

Date: 2026-09-18
Parent: [EMO-426](https://linear.app/emo-eth/issue/EMO-426/ticket-bound-attention)

## What landed

Herdr plugin actions `desk` and `shelve`:

- `desk` lists open chairs versus bound tickets. Orphans: no ticket, empty checkout path, Map worktree path missing on disk.
- `shelve` writes or appends `SITTING.md` when git is dirty or an agent is working, then `herdr workspace close`. Never `worktree remove`. Ticket stays open.
- Funeral gate lives in the plugin CLI for slice 5; it is not a Herdr action yet.

## Proof

- Package `npm test` (24) and `npm run check` pass.
- Live `desk`: 41 chairs, two orphans (`w2A` map-path-missing, `w30` no-ticket). This chair `w3Y` bound EMO-426, clean.
- Reopened disposable `/tmp/tba-disposable-capture-proof` as `w44`, dirtied README, ran `shelve --workspace w44`. Chair gone, tree remains, `SITTING.md` written, [EMO-453](https://linear.app/emo-eth/issue/EMO-453/disposable-capture-proof) still open.
