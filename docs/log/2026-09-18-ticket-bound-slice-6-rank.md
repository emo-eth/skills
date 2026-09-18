# Ticket-bound attention — slice 6 rank to desk

Date: 2026-09-18
Parent: [EMO-426](https://linear.app/emo-eth/issue/EMO-426/ticket-bound-attention)

## What landed

Action `rank` wraps Linear priorities written by `tools/prioritize-linear-tickets.ts` (same assigned-issue query). It proposes sit (priority 1–2), hide (3–4), ask (unranked / no ticket), and could-sit (ranked now, no chair, not nested). `applied` is always false. It does not open, close, or remove chairs. It does not rewrite pairwise ranking.

## Proof

- Package `npm test` (27) and `npm run check` pass.
- Live `rank`: sit 2 (`w2E` EMO-425, `w3Y` EMO-426), hide 2 (`w2D` EMO-449, `w3Q` EMO-239), ask 36, could_sit 14. No chairs changed. Operator still confirms before any hide or seat.
