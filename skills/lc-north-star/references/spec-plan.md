# Spec And Plan Reference

The spec and plan are downstream of the product contract: `vibe.md` first, then the PRD derived from it. They can add technical detail, but they cannot change the contract silently.

## Spec Contract

Write the spec to `docs/specs/YYYY-MM-DD-<topic>.md` unless repo convention says otherwise.

The spec is living. Update it when the implementation approach changes, when a refactor changes boundaries, or when verification strategy changes. If a change would alter product behavior or vibe, create a contract amendment request instead.

### Spec Template

```markdown
---
date: YYYY-MM-DD
topic: <kebab-case-topic>
status: draft
source_prd: docs/prds/YYYY-MM-DD-<topic>/prd.md
source_vibe: docs/prds/YYYY-MM-DD-<topic>/vibe.md
---

# <Product Or Feature> Spec

## Source

- PRD: `docs/prds/YYYY-MM-DD-<topic>/prd.md`
- PRD status: approved
- Vibe: `docs/prds/YYYY-MM-DD-<topic>/vibe.md`
- Vibe status: approved

## Technical Goal

[How the system will satisfy the PRD and vibe contract.]

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

[Technical details needed to implement the PRD and vibe accurately: state transitions, validation, error handling, permissions, accessibility, responsive behavior, qualitative feel checks.]

## Verification

- Unit:
- Integration:
- E2E:
- Manual or operational checks:

## Risks And Open Technical Questions

- [Question that can be resolved without changing the PRD]

## Contract Amendment Requests

- [Only include when technical discovery suggests the PRD or vibe should change. Do not implement these until the contract is amended.]
```

## Spec Quality Bar

Before planning, verify:

- Every PRD requirement appears in the traceability table.
- Every vibe clause appears in the traceability table or is explicitly irrelevant to the target.
- Every behavior-changing technical choice points back to a PRD requirement.
- Every feel-changing technical choice points back to a vibe clause.
- Every user-visible edge case from the PRD has a technical treatment.
- Every unresolved question is technical, not product-level.
- Every proposed PRD or vibe change is isolated under `Contract Amendment Requests`.

## Plan Contract

Write the plan only after the spec exists. In the Native Markets workspace, prefer `nm-plan` for plan generation.

The plan is the execution artifact. It may include task ordering, file paths, test commands, checkpoints, and commit strategy. It must not invent product behavior.

Before execution, verify:

- Every spec section with implementation work has at least one task.
- Every task references the spec behavior it implements.
- No task changes PRD behavior or vibe without a named amendment.
- The plan says when the spec must be updated during implementation.

## Downstream Change Rule

When implementation reveals new information:

- Update the plan for sequencing or task detail changes.
- Update the spec for technical design, interfaces, tests, or refactors.
- Ask for a contract amendment for product behavior, scope, user promise, platform support, success criteria, undesirable outcomes, or vibe.
