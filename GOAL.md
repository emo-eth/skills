## Intention

Upgrade lc-north-star PRD specification to canonical industry standards (SVPG / Reforge / Stripe), incorporating executive summary, synthesized problem narrative, user personas & JTBD, end-to-end user journeys, prioritized requirements (P0/P1/P2), UX/system state matrix, NFRs, and guardrails, while strictly decoupling downstream ticket execution slicing.

## Vibe

A PRD must feel like a genuine product contract defining user reality, not a unit-test matrix or an inlined ticket stub.

## Done-when

- `skills/lc-north-star/references/prd.md` defines the decoupled multi-tier document structure (VRD -> PRD -> Spec -> Ticket Spec).
- `references/prd.md` incorporates synthesized problem narrative, user personas, end-to-end user journeys, UX & system state matrix, and dedicated NFRs.
- `references/prd.md` establishes a strict anti-bloat rule keeping execution ticket slicing in downstream spec and ticket stages without inlining ticket schemas.
- `skills/lc-north-star/SKILL.md` aligns with the updated PRD definition.
- `docs/STATE.md` records the updated PRD contract.

## Map

- Herdr: fix-prd-if-necessary (w5W)
- Worktree: `/Users/emo/.herdr/worktrees/skills/fix-prd-if-necessary`
- Branch: `fix-prd-if-necessary`
