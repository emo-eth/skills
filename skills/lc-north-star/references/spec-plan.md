# Spec And Plan Reference

The spec is the technical how. It sits downstream of the product contract: VRD first, then the PRD derived from it. It can add architecture, interfaces, state, and verification, but it cannot change the contract silently.

The plan is optional execution sequencing. Write it only when ordering, checkpoints, or parallel workstreams actually matter, or when the user asks. A straightforward spec goes to implementation without a plan.

Ask only unresolved technical or sequencing questions. Do not re-interview approved VRD what/why or PRD behavior.

## Spec Contract

Prefer `docs/prds/YYYY-MM-DD-<topic>/spec.md` beside the VRD and PRD unless repo convention already uses another spec path.

The spec is living. Update it when the implementation approach changes, when a refactor changes boundaries, or when verification strategy changes. If a change would alter product behavior or feel, create a contract amendment request instead.

### Spec Template

```markdown
---
date: YYYY-MM-DD
topic: <kebab-case-topic>
status: draft
source_prd: docs/prds/YYYY-MM-DD-<topic>/prd.md
source_vrd: docs/prds/YYYY-MM-DD-<topic>/vrd.md
---

# <Product Or Feature> Spec

## Source

- PRD: `docs/prds/YYYY-MM-DD-<topic>/prd.md`
- PRD status: approved
- VRD: `docs/prds/YYYY-MM-DD-<topic>/vrd.md`
- VRD status: approved

## Technical Goal

[How the system will satisfy the PRD while preserving the VRD.]

## Requirement Traceability

| Contract Item | Spec Section | Verification |
| --- | --- | --- |
| R1 | [Section name] | [Test, review, demo, or operational check] |
| V1 | [Section name] | [Qualitative review, demo check, screenshot review, user-flow check, or test] |

## Architecture

[Boundaries, components, data flow, ownership, and important tradeoffs.]

## Interfaces

[Routes, components, jobs, APIs, events, or CLI surfaces. Include contracts, not implementation choreography.]

## Data And State

[Models, persistence, state machines, cache behavior, migrations, and rollback concerns if relevant.]

## UX And Product Behavior Details

[Technical details needed to implement the PRD and VRD accurately: state transitions, validation, error handling, permissions, accessibility, responsive behavior, qualitative feel checks.]

## Verification

- Unit:
- Integration:
- E2E:
- Manual or operational checks:

## Risks And Open Technical Questions

- [Question that can be resolved without changing the PRD or VRD]

## Contract Amendment Requests

- [Only include when technical discovery suggests the PRD or VRD should change. Do not implement these until the contract is amended.]
```

## Spec Quality Bar

Before implementation or planning, verify:

- Every PRD requirement appears in the traceability table.
- Every VRD feel clause appears in the traceability table or is explicitly irrelevant to the target.
- Every behavior-changing technical choice points back to a PRD requirement.
- Every feel-changing technical choice points back to a VRD feel clause.
- Every user-visible edge case from the PRD has a technical treatment.
- Every unresolved question is technical, not product-level.
- Every proposed PRD or VRD change is isolated under `Contract Amendment Requests`.

## Plan Contract

A plan is not a stage in the default loop. Skip it when the spec is small enough to execute directly.

Write `plan.md` beside the spec only when:

- Multiple workstreams need an explicit order
- Checkpoints, commit strategy, or risky sequencing matter
- The user asks for a plan

If a plan skill such as `plan` is available, use it only in those cases. Do not invoke it as ritual.

The plan is disposable execution choreography. It may include task ordering, file paths, test commands, checkpoints, and commit strategy. It must not invent product behavior.

When a plan is written, verify before execution:

- Every spec section with implementation work has at least one task.
- Every task references the spec behavior it implements.
- No task changes PRD behavior or VRD feel without a named amendment.
- The plan says when the spec must be updated during implementation.

## Downstream Change Rule

When implementation reveals new information:

- Update the plan (if it exists) for sequencing or task detail changes.
- Update the spec for technical design, interfaces, tests, or refactors.
- Ask for a contract amendment for product behavior, scope, user promise, platform support, success criteria, undesirable outcomes, or feel.
