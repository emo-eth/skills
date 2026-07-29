# PRD Reference

The PRD is downstream of the vibe. It translates the user's ideal-reality dump and `vibe.md` into observable product behavior, scope, requirements, and acceptance criteria. Downstream specs and plans must satisfy the PRD while preserving the source vibe.

## PRD Template

```markdown
---
date: YYYY-MM-DD
topic: <kebab-case-topic>
status: draft
source_vibe: docs/prds/YYYY-MM-DD-<topic>/vibe.md
---

# <Product Or Feature> PRD

## North Star

[One paragraph distilled from the source vibe: who this is for, what ideal reality exists when the work is done, and why it matters.]

## Source Vibe Summary

- Ideal reality: [What the user wants to be true.]
- Feel promises: [Vibe IDs or summary.]
- Anti-vibes: [What must not happen or how it must not feel.]

## Users And Jobs

- [Primary user]: [job they are trying to accomplish]
- [Secondary user if relevant]: [job]

## Product Shape

- Entry points:
- Core flow:
- Required surfaces:
- Platform expectations:
- Data visibility expectations:

## Requirements

### R1. <Requirement Title>

- Requirement: [Observable product behavior.]
- Rationale: [Why this matters to the user or business.]
- Acceptance: [How someone can tell this requirement is satisfied.]
- Not acceptable: [A concrete bad behavior this requirement forbids.]

### R2. <Requirement Title>

- Requirement:
- Rationale:
- Acceptance:
- Not acceptable:

## Undesirable Outcomes

| Outcome | Decision | Requirement |
| --- | --- | --- |
| [Bad behavior or degraded product shape] | [Allowed, forbidden, or explicitly out of scope] | [R-id] |

## Scope Boundaries

### In Scope

- [Included behavior]

### Out Of Scope

- [Excluded behavior and why excluding it does not break the north star]

### Explicitly Deferred

- [Only include if the user deliberately accepts this deferral. Name the acceptable current behavior.]

## Success Criteria

- [User-visible or business-visible signal of success]

## Open Questions

### Resolve Before Spec

- [Question that changes product behavior, scope, user expectations, or success criteria]

### Deferred To Spec

- [Technical question that can be answered without changing the PRD]

## Approval

- Approved by:
- Approved on:
- Amendment rule: This PRD changes only by explicit user request or direct user edit.
```

## Requirement Quality Bar

Each requirement must be:

- Observable by a user, operator, or external system.
- Singular enough that a spec can trace to it.
- Strong enough to rule out at least one bad implementation.
- Free of implementation tasks, file paths, libraries, database schemas, and sequencing.
- Stable enough that it should not change during normal implementation.

Prefer "The user can..." or "The system must..." over vague goals like "make it easy".

## Pressure-Test Prompts

Use these to uncover hidden requirements. Ask only the prompts that match the product.

- Would it be acceptable if this only worked on desktop?
- Would it be acceptable if this only worked as an installed app or PWA?
- Would it be acceptable if mobile users could view but not complete the flow?
- Would it be acceptable if users lost progress on refresh, logout, or navigation?
- Would it be acceptable if empty states, errors, or loading states were generic?
- Would it be acceptable if admins and normal users saw the same controls?
- Would it be acceptable if data updated only after a manual refresh?
- Would it be acceptable if this worked for one item but not bulk cases?
- Would it be acceptable if users could complete the happy path but could not undo, edit, cancel, or recover?
- Would it be acceptable if the feature silently skipped unavailable data?
- Would it be acceptable if this exposed partial, stale, or sensitive data to the wrong audience?
- Would it be acceptable if the product worked locally but not in production-like latency, permissions, or failure conditions?

## Completeness Check

Before approval, verify:

- Every major user/job has at least one requirement.
- Every required surface has behavior for empty, loading, error, and permission states, or a clear reason those states do not apply.
- Every undesirable outcome is either forbidden by a requirement or intentionally allowed by a scope boundary.
- Any qualitative promise that is contractual but not an observable product requirement is captured in `vibe.md`.
- Every requirement is traceable to the source vibe, an explicit user correction, or a stated product constraint.
- Every "Resolve Before Spec" question is answered.
- There are no phases masquerading as scope.
