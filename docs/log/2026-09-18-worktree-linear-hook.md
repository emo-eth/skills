# Worktree Linear hook

Date: 2026-09-18
Parent: [EMO-426](https://linear.app/emo-eth/issue/EMO-426/ticket-bound-attention)

## What landed

`plugins/ticket-bound-attention/` now runs the same `capture` path on:

- `worktree.created`
- `worktree.opened`

Payload comes from `HERDR_PLUGIN_EVENT` + `HERDR_PLUGIN_EVENT_JSON` (workspace id, checkout path, human label). Idempotent: an already-bound tree binds, it does not mint a second ticket. Plugin processes resolve `linear` via Homebrew/`~/.local/bin` because Herdr's plugin PATH does not include it.

## Proof

- Package `npm test` (17) and `npm run check` pass.
- `herdr plugin link … --enabled` registers both events.
- First `worktree.created` on a temp tree failed `spawn linear ENOENT`; after PATH resolution a later `worktree.created` succeeded.
- `worktree.opened` on disposable tree `/tmp/tba-disposable-capture-proof` bound [EMO-453](https://linear.app/emo-eth/issue/EMO-453/disposable-capture-proof) (`action: bound`). Four face sections present. Chair hidden with `workspace close` (git remains). Funeral is slice 5.
