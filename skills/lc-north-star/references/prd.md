# Canonical Industry Standard PRD Reference

The **PRD (Product Requirements Document)** is the authoritative contract for product behavior. It defines **what** problem is being solved, **who** it is for, **why now**, the **end-to-end user experience**, **prioritized system capabilities**, **state and edge behaviors**, **non-functional requirements (NFRs)**, and **measurable success metrics**.

Grounded in industry-standard product management frameworks (Silicon Valley Product Group / Marty Cagan, Reforge, Lenny's PM Framework, Amazon PR-FAQ, and Stripe/Linear product specs), this specification establishes a rigorous, professional standard for software and agentic products.

---

## The Decoupled Multi-Tier Architecture

To eliminate both vague requirements and bloated templates, documents adhere to a strict separation of concerns:

```text
VRD (Ambition & Feel) -> PRD (Product Contract) -> Spec (Technical How) [-> Plan (Optional Sequencing)]
```

1. **`vrd.md` (Ambition & Feel):** Single source of truth for pure ambition, ideal reality, problem-as-felt, qualitative feel promises (`V1`...), and anti-vibes. Void of technical architecture or implementation mechanics.
2. **`prd.md` (Product Definition & Functional System Requirements):** Synthesizes VRD stakes into an integrated product narrative. Defines target personas, Jobs-to-be-Done, end-to-end user journeys, prioritized functional requirements (**P0 / P1 / P2**), UX and system state matrices, NFRs, guardrail metrics, and scope boundaries.
3. **`spec.md` (Technical Architecture):** Defines technical implementation: system architecture, API contracts, data models, state machines, and requirement traceability matrices.
4. **`plan.md` (Optional Sequencing):** Task dependencies and technical milestones when execution complexity warrants ordering.

---

## PRD Placement Rules

- **Whole-Project / Root PRD:** For repo-level or whole-project contracts, the primary PRD belongs at the project root alongside the root vibe/VRD: `./prd.md` (beside `./vibe.md` or `./vrd.md`). The project PRD must be immediately visible and discoverable at the top level, never buried inside nested dated directories.
- **Sub-Feature / Scoped PRDs:** Sub-feature, sub-topic, or subordinate PRDs live in scoped locations (e.g. `docs/prds/YYYY-MM-DD-<topic>/prd.md` beside their scoped `vrd.md`), but the overarching project PRD remains at the project root.
- If the repository already maintains an established flat PRD convention at root, maintain it.

---

## Canonical PRD Template

```markdown
---
date: YYYY-MM-DD
topic: <kebab-case-topic>
status: draft | in-review | approved
source_vrd: ./vrd.md (or docs/prds/YYYY-MM-DD-<topic>/vrd.md for scoped feature PRD)
---

# <Product Or Feature> PRD

## 1. Executive Summary & Problem Narrative

### 1.1 Elevator Pitch
[2-3 crisp sentences: What is this product/feature, who is it for, what unique capability does it unlock, and what core friction does it eliminate?]

### 1.2 Problem Statement & Customer Friction
[Synthesize the source VRD's Problem As Felt into an authoritative narrative. Describe the user's daily reality without this product, the specific friction points, and the current broken workarounds. Ground the problem in user evidence rather than abstract theory.]

### 1.3 Why Now & Strategic Alignment
[Why is this being tackled now? What is the cost of doing nothing? How does this advance the team's North Star goals and higher-level vision?]

---

## 2. Target Users, Personas & Jobs-to-be-Done (JTBD)

### 2.1 Personas
- **[Primary User / Persona]**:
  - *Context*: [Who they are, their environment, frequency of use, technical proficiency.]
  - *Current Pain*: [What frustrates them most about existing workflows.]
  - *Desired Outcome*: [What a 10x better experience looks like for them.]
- **[Secondary User / Operator]**:
  - *Role & Needs*: [Operational oversight, debugging, permissions, configuration.]

### 2.2 Core Jobs-to-be-Done (JTBD)
- **Job 1**: When [situation/trigger], I want to [motivation/action], so that I can [desired outcome/value].
- **Job 2**: When [situation/trigger], I want to [motivation/action], so that I can [desired outcome/value].

---

## 3. User Journeys & End-to-End Scenarios

### 3.1 Current Reality vs. New Product Reality
| Stage | Current Broken Workflow | New Product Workflow |
|---|---|---|
| **Trigger** | [Friction, manual steps, context hunt] | [Seamless entry point, automatic context] |
| **Execution** | [Slow, uncertain, fragmented tools] | [Unified, fast, visible progress] |
| **Verification**| [Manual guessing, hidden failures] | [Immediate proof, explicit provenance] |

### 3.2 Primary Flow (Happy Path)
1. **Entry & Discovery**: [How the user initiates or accesses the feature.]
2. **Core Interaction**: [Step-by-step progression through the primary experience.]
3. **Value Delivery**: [The exact point where the user's job is accomplished.]
4. **Feedback & Confirmation**: [What the user sees to confirm success.]

### 3.3 Alternative & Edge Scenarios
- **Degraded / Offline Flow**: [What happens when an upstream service, remote machine, or network is unavailable.]
- **Error & Recovery Flow**: [Step-by-step recovery when an operation fails; how context and progress are preserved.]
- **Permission / Denied Flow**: [Experience when unauthorized or unauthenticated.]

---

## 4. Product Surfaces, Information Architecture & Shape

- **Entry Points**: [CLI commands, slash commands, MCP tools, web views, desktop shortcuts.]
- **Information Architecture**: [Core concepts, mental models, and relationships presented to the user.]
- **Required Surfaces**: [Commands, panels, modal dialogs, status lines, output shapes.]
- **Platform Expectations**: [Supported operating systems, terminal environments, browser versions, model harnesses.]
- **Data Visibility Boundaries**: [Tenant isolation, local vs remote machine visibility, agent vs human boundaries.]

---

## 5. Functional Requirements (Prioritized)

Requirements are partitioned into strict priority tiers:
- **P0 (Must Have / MVP)**: Hard release blocker. Without this, the product does not solve the core problem.
- **P1 (Should Have / Fast Follow)**: Essential for complete experience; targeted immediately post-MVP.
- **P2 (Nice to Have / Delighter)**: Valued enhancements, optimizations, or future explorations.

### P0 — Must Have (MVP)

#### R1. <Requirement Title>
- **Priority**: P0
- **Requirement**: [The user can... / The system must... Observable product behavior.]
- **User Story / JTBD**: [References Persona and Job-to-be-Done from Section 2.]
- **Source & Traceability**: [Traced to source VRD feel ID (e.g. V1, V2) or explicit user stakes.]
- **Acceptance Criteria**: [Exact, observable condition proving this requirement is met.]
- **Not Acceptable**: [Concrete bad behavior, failure mode, or anti-pattern forbidden by this requirement.]

#### R2. <Requirement Title>
- **Priority**: P0
- **Requirement**:
- **User Story / JTBD**:
- **Source & Traceability**:
- **Acceptance Criteria**:
- **Not Acceptable**:

### P1 — Should Have (Fast Follow)

#### R3. <Requirement Title>
- **Priority**: P1
- **Requirement**:
- **User Story / JTBD**:
- **Source & Traceability**:
- **Acceptance Criteria**:
- **Not Acceptable**:

### P2 — Nice to Have (Future Enhancements)

#### R4. <Requirement Title>
- **Priority**: P2
- **Requirement**:
- **User Story / JTBD**:
- **Source & Traceability**:
- **Acceptance Criteria**:
- **Not Acceptable**:

---

## 6. UX & System State Matrix

Every core surface must define behavior across all fundamental states:

| Surface / Flow | State | Condition / Trigger | System Behavior | User Feedback / Presentation |
|---|---|---|---|---|
| [Core Surface] | **Empty** | First run / no data exists | [Provide guidance, prompt onboarding] | [Helpful onboarding guidance] |
| [Core Surface] | **Loading** | Asynchronous or streaming task | [Stream partial results or show progress] | [Clear progress indicator] |
| [Core Surface] | **Degraded** | Partial outage / remote offline | [Return retained data + named warning] | [Clear gap notification] |
| [Core Surface] | **Error** | Unrecoverable exception / failure | [Fail fast, preserve state, no silent drop] | [Actionable error message + next action] |
| [Core Surface] | **Permission**| Unauthenticated / unauthorized | [Fail closed, explain requirement] | [Explicit denial with remediation steps] |

---

## 7. Non-Functional Requirements (NFRs)

### 7.1 Performance & Latency SLAs
- **Interactive Response**: [e.g. p95 < 200ms for CLI feedback or UI interactions.]
- **Batch / Heavy Operations**: [e.g. Hard ceiling of < 2s for hybrid search or background compilation.]
- **Throughput & Concurrency**: [Simultaneous operations or sessions supported without degradation.]

### 7.2 Security, Authentication & Privacy
- **Authentication**: [Auth model, token validation, credential storage.]
- **Least Privilege**: [Access control rules, sandboxing boundaries.]
- **Data Isolation & Privacy**: [Zero leakage across workspaces, sensitive data redaction, ephemeral storage.]

### 7.3 Reliability, Freshness & Resilience
- **Freshness Targets**: [e.g. New material searchable or synchronized within 5 minutes.]
- **Sync Checkpoints**: [Interval and mechanism for saving in-flight state.]
- **Outage Resilience**: [Offline tolerance, local cache retention when remotes fail.]
- **Crash Recovery**: [Resumable state, clean process exit without orphaned handles.]

### 7.4 Observability & Diagnostics
- **Audit Logging**: [Structured logs for key user actions, security checks, and state transitions.]
- **Health Reporting**: [Explicit diagnostics command or endpoint for operational health.]

---

## 8. Measurement Framework & Success Metrics

### 8.1 North Star Metric
- **[Metric Name]**: [The single quantitative or observable qualitative metric that defines whether the product delivers its core value.]

### 8.2 Supporting Metrics
| Category | Metric | Target | Measurement Method |
|---|---|---|---|
| **Leading Indicator** | [e.g. Daily active usage, workflow initiation] | [Target value] | [Log telemetry / session counts] |
| **Lagging Indicator** | [e.g. Task completion time reduction, error drop] | [Target value] | [User evaluation / benchmark suite] |
| **Guardrail Metric** | [e.g. System memory footprint, p99 latency] | [Must not exceed X] | [Continuous benchmark / CI check] |

---

## 9. Scope Boundaries & Phased Rollout

### 9.1 In-Scope (v0 / MVP)
- [Explicit capability included in initial delivery.]

### 9.2 Out-of-Scope (Strict Non-Goals)
- [Explicit feature deliberately excluded, and why omitting it does not compromise the North Star.]

### 9.3 Explicitly Deferred
- [Feature deliberately postponed to subsequent releases, noting the acceptable current workaround.]

### 9.4 Release Phasing & Gating
- **Phase 1: Dogfood / Internal Alpha**: [Direct developer testing; verification against core scenarios.]
- **Phase 2: Limited Beta**: [Controlled deployment across representative machines/environments.]
- **Phase 3: General Availability (GA)**: [Default enabled, documentation complete, all P0 acceptance criteria verified.]

---

## 10. Risks, Critical Assumptions & Dependencies

### 10.1 Critical Assumptions
- [Assumption 1: Core belief about user workflow or environment that must hold true.]
- [Assumption 2: Platform capability or API behavior relied upon.]

### 10.2 Dependencies
- **Upstream Dependencies**: [Libraries, runtime engines, local daemons.]
- **Downstream Consumers**: [Skills, tools, or agents relying on this contract.]

### 10.3 Risk Mitigation Matrix
| Identified Risk | Likelihood | Impact | Mitigation Strategy |
|---|---|---|---|
| [e.g. Remote machine network partition] | Med | High | [CASS-backed retained corpus with local query fallback] |
| [e.g. Model context overflow] | High | Med | [Strict citation compression and turn summarization] |

---

## 11. Downstream Handoff & Technical Spec Traceability

- **Handoff to Technical Spec**: The PRD defines what the product does and how it behaves. Technical architecture, component boundaries, APIs, data models, and verification strategies are defined in the downstream Technical Spec (`spec.md`).
- **Execution & Task Breakdown**: Slicing deliverables into tracked tasks and assigning work to workers belongs downstream (via tracker tools or task decomposition skills like `lc-ticketize`), not inside the PRD.

## 12. Open Questions & Approvals

### 12.1 Resolve Before Spec
- [Open question that alters product behavior, scope, UX, or success criteria.]

### 12.2 Deferred to Spec
- [Technical implementation question that does not alter product behavior.]

### 12.3 Approval Sign-off
- **Approved by**: [Operator / Human Reviewer Name]
- **Approved on**: [YYYY-MM-DD]
- **Amendment Rule**: This PRD is immutable after approval except by explicit user request or direct user edit.
```

---

## Requirement Quality Bar & Evaluation Rubric

Before submitting a PRD for human approval, verify every requirement against this 7-point rubric:

1. **Observable**: Expressed in terms of user-observable behavior or system outputs, not internal code mechanics.
2. **Prioritized**: Categorized explicitly as P0, P1, or P2 with clear justification.
3. **Traceable**: Traced directly to an approved VRD feel clause (`V1`...), problem stake, or user JTBD.
4. **Disambiguated**: Contains both an **Acceptance** standard and a concrete **Not Acceptable** constraint ruling out bad implementations.
5. **Decoupled**: Focuses strictly on product behavior; contains zero technical architecture (deferred to `spec.md`) and zero task tracking or ticket dispatch stubs.
6. **State-Complete**: Every required product surface defines its behavior across Empty, Loading, Degraded, Error, and Permission states.
7. **NFR-Rigorous**: Non-functional requirements (latency, security, freshness) specify concrete thresholds, not vague adjectives.

---

## Common Anti-Patterns & Remediations

| Anti-Pattern | Symptom | Remediation |
|---|---|---|
| **The Task / Ticket Dump** | PRD is cluttered with developer task lists, sprint checkboxes, or execution stubs. | Keep the PRD focused on product behavior; delegate task breakdown to downstream spec and tracker stages. |
| **The Hollow Copy-Paste** | North Star & Stakes are a mindless copy of raw VRD bullets without cohesive product synthesis. | Synthesize the Problem As Felt into an executive summary, persona pain points, and JTBD statements. |
| **Missing User Experience** | Jumps directly from goals to bulleted requirements without walking through how a user actually uses it. | Include Section 3: Before vs After table, Happy Path walkthrough, and Edge/Recovery scenarios. |
| **Flat Priority Laundry List** | 30 requirements listed with equal weight, making MVP scope impossible to determine. | Group requirements strictly into P0 (Must Have), P1 (Should Have), and P2 (Nice to Have). |
| **The "Happy Path Only" Blindspot** | System behavior is specified only when everything works; errors, empty states, and offline modes are ignored. | Complete Section 6 (UX & System State Matrix) covering Empty, Loading, Degraded, Error, and Permission. |
| **NFR Camouflage** | Latency, throughput, and security are hidden as vague sentences inside functional requirements. | Pull all operational constraints into Section 7 (Dedicated NFRs) with explicit measurable targets. |
| **Architecture Bleed** | PRD specifies database schemas, internal class hierarchies, file paths, or private function names. | Move internal mechanics into `spec.md`; keep the PRD focused strictly on observable product behavior. |

---

## PRD Completeness Checklist

Before requesting human review or approval, verify:

- [ ] Executive summary and synthesized problem statement clearly establish why this matters now.
- [ ] At least one primary persona and structured Job-to-be-Done (JTBD) are documented.
- [ ] End-to-end user journeys describe the Primary Flow (Happy Path) and Alternative/Edge flows.
- [ ] Every requirement is prioritized (P0, P1, P2) and traced to a VRD clause or user job.
- [ ] Every requirement includes both an Acceptance criterion and a "Not Acceptable" constraint.
- [ ] UX & System State Matrix defines Empty, Loading, Degraded, Error, and Permission behaviors.
- [ ] Non-Functional Requirements establish concrete SLAs for Latency, Security, and Reliability.
- [ ] Measurement framework identifies a North Star metric, leading/lagging indicators, and guardrails.
- [ ] Scope boundaries clearly define In-Scope, Out-of-Scope (Non-Goals), and Explicitly Deferred items.
- [ ] Technical architecture is deferred to `spec.md`, and task tracking is left to downstream execution stages.
- [ ] All "Resolve Before Spec" questions are resolved before proceeding to Technical Spec.
