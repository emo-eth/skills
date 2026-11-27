# Technology Decisions Reference

`decisions.md` records choices made after the PRD explains what must be achieved. It names credible options, the selected approach, trade-offs, evidence, and conditions that would reopen the choice.

## Template

```markdown
---
date: YYYY-MM-DD
topic: <kebab-case-topic>
status: active
source_prd: ./prd.md
source_constraints: ./constraints.md
---

# <Product> Technology Decisions

## Decision D1: <short name>

- Status: proposed | accepted | superseded
- Need: [PRD requirement or constraint]
- Options considered:
  - [Option]: [strengths and costs]
  - [Option]: [strengths and costs]
- Choice:
- Why:
- Costs and limits:
- Reopen when:

## Open Technical Questions

## Superseded Decisions
```

A hypothesis is not a decision. Keep unmeasured claims about latency, quality, portability, or cost under experiments or open questions until evidence supports them. A decision can change without revising the VRD. If it changes product behavior, scope, or feel, request an upstream amendment first.
