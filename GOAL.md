## Intention

Upgrade lc-north-star PRD specification to decouple multi-tier standards, incorporate real-world PRD structure (user journeys, state matrix, NFRs), and enforce downstream referencing to docs/specs/ticket-lifecycle.md rather than inlining raw ticket templates.

## Vibe

A PRD must feel like a genuine product contract defining user reality, not a unit-test matrix or an inlined ticket stub.

## Done-when

- `skills/lc-north-star/references/prd.md` defines the decoupled multi-tier document structure (VRD -> PRD -> Spec -> Ticket Spec).
- `references/prd.md` incorporates synthesized problem narrative, user personas, end-to-end user journeys, UX & system state matrix, and dedicated NFRs.
- `references/prd.md` mandates referencing `docs/specs/ticket-lifecycle.md` for ticket field specifications instead of inlining raw ticket markdown templates.
- `skills/lc-north-star/SKILL.md` aligns with the updated PRD definition.
- `docs/STATE.md` records the updated PRD contract.

## Map

- Herdr: fix-prd-if-necessary (w5W)
- Worktree: `/Users/emo/.herdr/worktrees/skills/fix-prd-if-necessary`
- Branch: `fix-prd-if-necessary`
