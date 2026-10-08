# PRD Reference

The PRD is downstream of the VRD. It translates what is desired into observable product behavior, user journeys, functional system requirements, UX states, non-functional requirements (NFRs), and acceptance criteria.

## Decoupled Multi-Tier Document Structure

1. **`vrd.md` (Ambition & Feel):** Single source of truth for pure ambition, ideal reality, problem-as-felt, core stakes, qualitative feel promises (`V1`...), and anti-vibes. Void of implementation or ticket mechanics.
2. **`prd.md` (Product Definition & Functional System Requirements):** Synthesizes VRD stakes into cohesive product context; defines user journeys, high-level functional system requirements (`R1`... such as Units of Work or Specification Sufficiency Gates), UX/system state matrices, and NFRs. **Never bloats itself with raw ticket markdown templates or execution schemas.**
3. **`spec.md` (Technical Architecture):** Defines technical how — architecture, interfaces, data models, state machines, and verification.
4. **Ticket Specs & Lifecycle (`docs/specs/ticket-lifecycle.md`, `references/ticket-spec.md`):** Concrete ticket schemas, the canonical 7-question standard, 'One What Per Ticket' rule, multi-ticket workspaces, and local `TICKET.md` are canonically specified downstream. The PRD references `docs/specs/ticket-lifecycle.md` and `docs/specs/eval-ticket-spec.md` rather than inlining or redefining ticket field templates.

The PRD copies and synthesizes stakes from the VRD; it does not author a second competing why. Feel clauses remain in the VRD and are preserved through traceability, not rewritten into PRD functional rules. Downstream specs and plans must satisfy the PRD while preserving the source VRD.

Ask only unresolved product-behavior questions. Do not re-ask approved VRD what/why.

## PRD Placement

- **Whole-Project / Root PRD:** For repo-level or whole-project contracts, the primary PRD belongs at the project root alongside the root vibe/VRD: `./prd.md` (beside `./vibe.md` or `./vrd.md`). The project PRD must be immediately visible and discoverable at the top level, never buried inside nested dated directories.
- **Sub-Feature / Scoped PRDs:** Sub-feature, sub-topic, or subordinate PRDs may live in scoped locations (e.g. `docs/prds/YYYY-MM-DD-<topic>/prd.md` beside their scoped `vrd.md`), but the overarching project PRD remains at the project root.
- If the repository already keeps an established flat PRD convention at root, maintain it.

## PRD Template

```markdown
---
date: YYYY-MM-DD
topic: <kebab-case-topic>
status: draft
source_vrd: ./vrd.md (or docs/prds/YYYY-MM-DD-<topic>/vrd.md for scoped feature PRD)
---

# <Product Or Feature> PRD

## Product Overview & Problem Narrative

[Synthesize the source VRD's Problem As Felt and Why As Stakes into an integrated product context: who this is for, what pain is eliminated, why now, and what is at risk. Do not author an independent competing why; ground the narrative directly in the VRD.]

## Desired Outcomes

[Translation of the VRD's What Is Desired into product-facing outcomes. Observable goals, not a new why, and not implementation.]

## Source VRD Summary

- Feel promises: [VRD feel IDs referenced for traceability, e.g. V1, V2. Feel clauses stay in vrd.md.]
- Anti-vibes: [What must not happen or how it must not feel, traced to V-ids.]

## Target Users & Jobs

- **[Primary user / persona]**: [Job-to-be-done, context of use, and what success looks like.]
- **[Secondary user / operator]**: [Job-to-be-done, operational expectations.]

## User Journeys & Scenarios

### 1. Primary Flow (Happy Path)
- **Trigger**: [What initiates the interaction.]
- **Progression**: [Step-by-step experience through the product from start to value delivery.]
- **Resolution**: [Observable outcome and feedback to the user.]

### 2. Alternative & Edge Scenarios
- **Degraded / Partial State**: [What happens when a source, network, or subsystem is unavailable.]
- **Recovery**: [How the user or system corrects errors without losing context or progress.]

## Product Shape & Interfaces

- Entry points: [CLI, MCP tool, Web UI, slash command]
- Core flow: [Sequence of visible product surfaces]
- Required surfaces: [Views, commands, tools]
- Platform expectations: [Supported harnesses, OS, runtime environments]
- Data visibility expectations: [Who sees what; isolation boundaries]

## High-Level Functional Requirements

### R1. <Requirement Title>

- Requirement: [Observable system or product behavior.]
- Source & Rationale: [Which VRD stakes, desired outcome, or feel ID this serves. Do not author a new why.]
- Acceptance: [How someone can tell this requirement is satisfied.]
- Not acceptable: [A concrete bad behavior or failure mode this requirement forbids.]

### R2. <Requirement Title>

- Requirement:
- Source & Rationale:
- Acceptance:
- Not acceptable:

## UX & System State Matrix

| State | Trigger / Condition | Expected Product Behavior | User Feedback |
|---|---|---|---|
| **Empty** | First run / no data exists | [Clear guidance, onboarding or prompt] | [Helpful guidance] |
| **Loading / In-Progress** | Long-running operation | [Progress signal, non-blocking if possible] | [Status indicator] |
| **Degraded / Partial** | Subsystem/remote offline | [Usable retained data + explicit warning] | [Clear gap report] |
| **Error / Failure** | Unrecoverable error | [Fail fast, preserve state, no silent drop] | [Actionable message] |
| **Permission / Denied** | Unauthenticated / unauthorized | [Fail closed, explain requirement] | [Explicit denial] |

## Non-Functional Requirements (NFRs)

### Performance & Latency
- [Hard response time boundaries, interactive limits, batch ceilings.]

### Security, Auth & Privacy
- [Authentication requirements, tailnet boundaries, token handling, sensitive data isolation.]

### Reliability & Freshness
- [Data freshness targets, sync checkpoints, offline tolerance, crash recovery.]

## Scope Boundaries

### In Scope

- [Included behavior]

### Out Of Scope

- [Excluded behavior and why excluding it does not break the north star]

### Explicitly Deferred

- [Only include if the user deliberately accepts this deferral. Name the acceptable current behavior.]

## Downstream Execution & Ticket Specifications

- **Ticket Schema & Lifecycle Reference**: Downstream units of work, ticket field specifications, execution modes (Slice vs Ratchet), the 7-question standard, and multi-ticket workspaces are canonically specified in `docs/specs/ticket-lifecycle.md` (and `docs/specs/eval-ticket-spec.md` / `references/ticket-spec.md`).
- **No Inlined Ticket Templates**: This PRD must not inline or redefine raw ticket markdown schemas or dispatch templates.

## Success Criteria

- [User-visible or business-visible signal of success]
- [Telemetry, usage signals, or observable qualitative checks]

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
- Free of raw ticket markdown templates, ticket field definitions, or execution dispatch stubs.
- Stable enough that it should not change during normal implementation.
- Traced to the VRD rather than inventing independent motivation.

Prefer "The user can..." or "The system must..." over vague goals like "make it easy".

## Anti-Patterns & Failure Modes

| Anti-Pattern | Description | Correction |
|---|---|---|
| **Ticket Template Bloat** | Inlining raw `.herdr-ticket` / `TICKET.md` markdown templates into the PRD. | Reference `docs/specs/ticket-lifecycle.md` instead of inlining ticket schemas. |
| **Hollow Copy-Paste** | Mindlessly copying disconnected VRD bullets with no synthesized product narrative. | Synthesize Problem-as-Felt into a coherent product overview and user personas. |
| **Missing User Journey** | Defining isolated requirements without any step-by-step walkthrough of how a user interacts. | Add Primary and Alternative User Journeys before listing `R-id`s. |
| **Missing State Coverage** | Specifying only the happy path while omitting empty, error, or degraded behaviors. | Complete the UX & System State Matrix. |
| **NFR Camouflage** | Hiding performance SLAs or security constraints as vague functional requirements. | Put SLAs and security rules into dedicated NFR subsections. |

## Pressure-Test Prompts

Use these to uncover hidden requirements. Ask only prompts that match unresolved PRD-stage choices. Do not re-ask VRD what/why.

- Who owns making this happen, and who acts on it?
- Who verifies the outcome before operator escalation?
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

- North Star & Problem Narrative are synthesized faithfully from the source VRD without originating a competing why.
- Desired Outcomes translate What Is Desired without becoming a new problem statement or a technical spec.
- Target users and jobs are explicitly identified.
- At least one end-to-end User Journey walkthrough (happy path) is provided.
- Every required surface has behavior defined in the UX & System State Matrix (empty, loading, error, degraded).
- Dedicated Non-Functional Requirements (Performance, Security, Reliability) are stated.
- Downstream ticket schemas are referenced via `docs/specs/ticket-lifecycle.md` rather than inlining raw ticket templates.
- Every undesirable outcome is either forbidden by a requirement or intentionally allowed by a scope boundary.
- Any qualitative promise that is contractual but not an observable product requirement remains in the VRD.
- Every requirement is traceable to the source VRD, an explicit user correction, or a stated product constraint.
- Every "Resolve Before Spec" question is answered.
- There are no phases masquerading as scope.
- Feel clauses remain in the VRD and are referenced for traceability, not rewritten or replaced by PRD requirements.
- The primary or whole-project PRD lives at the project root (`./prd.md`) alongside the root vibe/VRD, not buried in nested dated directories.
