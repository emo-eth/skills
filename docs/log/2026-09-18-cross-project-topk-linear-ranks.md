# Cross-project top-k with durable Linear ranks

Date: 2026-09-18
Parent: [EMO-458](https://linear.app/emo-eth/issue/EMO-458/cross-project-top-k-with-durable-linear-ranks)

## What landed

`tools/prioritize-linear-tickets.ts` can rank more than one Linear project in one top-k pass. APPLY writes a relative weight on each ticket (custom number field when Linear exposes or allows creating one; otherwise `<!-- rank: <weight> -->` in the description). Linear Urgent/High/Medium/Low is written only when the operator asks for buckets. A later run on another machine seeds overlapping comparisons from those stored weights. Adding or removing a ticket keeps prior pairs that still exist.

## Proof

- `node --experimental-strip-types --test tools/linear-ranks.test.ts tools/prioritize-core.test.ts tools/prioritize-linear-tickets.test.ts` — 47 pass.
