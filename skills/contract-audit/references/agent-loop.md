# Adversarial Agent Loop

Use this reference when subagent tools are available and the user has asked for adversarial agents, reviewer loops, delegation, or a similar multi-agent review.

## Persona Selection

For specs and plans, prefer:

- `nm-adversarial-document-reviewer` for premise, assumption, and decision stress.
- `nm-product-lens-reviewer` for product intent and goal-work alignment.
- `nm-scope-guardian-reviewer` for scope creep, unjustified deferral, and priority drift.
- `nm-design-lens-reviewer` when UI, workflows, interaction states, accessibility, or responsive behavior matter.
- `nm-security-lens-reviewer` when auth, permissions, data exposure, payments, PII, or external trust boundaries matter.
- `nm-coherence-reviewer` for internal contradictions that could cause divergent implementation.
- `nm-feasibility-reviewer` when technical reality may invalidate the plan.

For implementation targets, prefer:

- `nm-adversarial-reviewer` for scenario and cascade failures.
- `nm-correctness-reviewer` for intent-vs-code mismatches.
- `nm-testing-reviewer` for missing PRD-behavior proof.
- `nm-security-reviewer` when auth, permissions, public endpoints, user input, or data exposure matter.
- `nm-api-contract-reviewer` when API shapes or generated types matter.
- `nm-reliability-reviewer` when retries, timeouts, background jobs, async work, or external services matter.
- `nm-performance-reviewer` when PRD success depends on latency, scale, or data volume.

Use only personas whose lens can reveal a PRD/vibe contract discrepancy. Do not launch generic reviewers for ceremony.

## Subagent Prompt Shape

Give each reviewer the PRD, `vibe.md` when present, and the target. Do not tell them the expected findings.

```text
Review this target only for discrepancies against the product contract.

Source contract:
<path and content or exact extracted ledger>

Source vibe:
<path and content, exact extracted ledger, or "none">

Target:
<path, diff, document content, or implementation summary with relevant files>

Return findings only when you can cite:
1. PRD or vibe intent,
2. target evidence,
3. the concrete discrepancy,
4. required resolution: fix downstream, update spec, update plan, request contract amendment, or accept residual risk.

Suppress generic quality issues that do not violate PRD or vibe intent.
```

## Synthesis

After reviewers return:

1. Drop findings that lack PRD/vibe intent or target evidence.
2. Deduplicate findings by contract item plus target behavior.
3. Raise severity when multiple personas independently identify the same discrepancy.
4. Keep conflicting findings when they reveal an unresolved product decision.
5. Convert generic findings into contract-intent findings only if the PRD or `vibe.md` makes the issue product-relevant.
6. Record reviewer coverage and any failed or skipped reviewer.

## Loop Rule

After fixes:

- Rerun the same persona set for direct comparison.
- Add a specialized persona only if new risk appeared.
- Stop when the rerun produces no new P0/P1/P2 PRD/vibe findings.
- If two consecutive loops produce the same unresolved product or vibe question, stop and request a contract amendment or user decision.

The loop is satisfied by resolved intent alignment, not by reviewer silence alone.
