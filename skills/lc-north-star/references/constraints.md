# Constraints Reference

`constraints.md` is the reality filter between the VRD and PRD. It records what is imposed or currently unavoidable: platform and host limits, legal or security requirements, mandatory integrations, resource ceilings, and active safeguards introduced because trust or proof is not sufficient.

It does not choose the engineering stack. A selected database, protocol, library, model, or workspace tool belongs in `decisions.md` unless an external party mandates it.

## Template

```markdown
---
date: YYYY-MM-DD
topic: <kebab-case-topic>
status: provisional
source_vrd: ./vrd.md
---

# <Product> Constraints & Safeguards

## Purpose

## Hard Constraints

| Constraint | Why imposed | Consequence |
| --- | --- | --- |

## Active Safeguards

| Dimension | VRD ambition | Current control | Why it exists | Graduation gate | Owner |
| --- | --- | --- | --- | --- | --- |

## Assumptions To Validate

| Assumption | Evidence needed | Effect if false |
| --- | --- | --- |

## Proportionality

## Approval
```

Every safeguard names its owner, enforcement seam, and condition for removal. If a safeguard changes current user behavior, the PRD states that release behavior while this document records the reason and graduation gate. The VRD remains pure ambition.

Do not create this document for a routine fix. Reuse the project's existing constraints and add a row only when a new external limit, trust control, or material assumption changes downstream work.
