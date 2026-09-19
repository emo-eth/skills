---
name: lc-north-star
disable-model-invocation: true
description: "VRD-first north-star loop. Use when the user wants to word-dump an ideal reality, capture a VRD, name a north star, or turn a settled VRD into a PRD and spec. Loop: VRD -> PRD -> Spec, with plan optional. Later stages only if asked or execution needs them. Do not override an explicit downstream skill such as plan."
---

# North Star

Lead with the VRD: the what and why of the vibe, before requirements or implementation.

```text
VRD (vrd.md) -> PRD (prd.md) -> Spec (spec.md) [-> Plan (plan.md, optional)] -> Ticket Spec
```

- **VRD** (`vrd.md`): single source of truth for the **what** (desired reality) and the **why** (problem-as-felt, stakes), plus qualitative feel clauses and anti-vibes. Void of implementation.
- **PRD** (`prd.md`): copies VRD stakes (no second original why); translates the VRD's what into observable product behavior and acceptance criteria; references feel clauses, does not absorb them.
- **Spec** (`spec.md`): technical **how** — architecture, interfaces, state, verification — to satisfy the PRD while preserving the VRD.
- **Plan** (`plan.md`): optional sequencing when execution complexity needs it. Never ritual.
- **Ticket Spec**: concrete downstream artifact produced from the Spec/Plan before dispatch to workers. A structured object living directly on the issue/ticket (.herdr-ticket / TICKET.md): Intention, Vibe, Done-when, Map.

A settled VRD makes PRD and spec questions obvious. Ask only unresolved choices at the current stage. Do not re-interview approved upstream what/why.

`vrd.md` replaces legacy `vibe.md`. In existing repositories, read legacy `vibe.md` as the VRD, but create all new contracts as `vrd.md`. When explicitly asked, rename `vibe.md` to `vrd.md`.

## Stage Cutover Sharpness

| Artifact | Core Question | What Lives Here | What NEVER Belongs Here |
|---|---|---|---|
| **VRD** (`vrd.md`) | *What & Why?* | Problem-as-felt, desired reality, stakes, qualitative feel promises (`V1`...), anti-vibes. | Technical architecture, CLI flags, APIs, execution steps. |
| **PRD** (`prd.md`) | *What does the product do?* | Observable functional requirements (`R1`...), acceptance criteria, surface expectations, copied stakes. | Technical design, internal schemas, a second original "why", feel restated as functional rules. |
| **Spec** (`spec.md`) | *How is it built?* | Technical architecture, data models, state machines, API interfaces, failure modes, traceability matrix. | Product requirement debates, re-litigating what/why, choreographing execution steps. |
| **Plan** (`plan.md`) *(Optional)* | *In what order?* | Task dependencies, checkpoints, branch/workspace choreography (only when complexity requires it). | Inventing features, product behavior, or technical redesigns. |
| **Ticket Spec** | *What is this worker doing?* | Self-contained slice: Intention (What/Why), Vibe (Feel/Borders), Done-when (Acceptance), Map (Coordinates). | Vague one-liners, raw chat dumps, re-specifying whole features. |
## Artifact Rules

- Do not force files or later stages for exploratory VRD work.
- Approve the VRD before drafting a PRD. Stakes originate on the VRD; the PRD copies them. Feel clauses stay on the VRD.
- A target that satisfies the PRD but violates the VRD is still wrong.
- VRD and PRD are immutable after approval except by explicit user request or direct user edit.
- Spec is living. Plan, when it exists, is disposable choreography.
- At most two review-and-fix rounds per contract document; the goal is one. After two failures, rewrite.
- If a behavior matters to the desired world, include it now or record an explicit scope boundary.
- Implementation belongs in spec, not VRD or PRD, unless it is a user-recognizable product constraint ("must work on mobile web").

## Tight Questions

Read local context first. Ask one compact batch of currently blocking questions for *this* stage, then wait. Prefer concrete choices.

| Stage | Ask about | Leave alone |
| --- | --- | --- |
| VRD | What hurts, what is desired, why it matters, how it must feel, what must never happen | Architecture, APIs, tasks, acceptance wording |
| PRD | Unresolved observable behaviors, scope, success signals, acceptance | Why it matters, feel restated as a new why, implementation |
| Spec | Unresolved technical how that still satisfies PRD+VRD | Product what/why already in the VRD/PRD |
| Plan | Sequencing only, and only if a plan is warranted | Product or design questions |
| Ticket Spec | Concrete boundaries, acceptance criteria mapping, workspace/worktree topology | Redefining product what/why or re-architecting spec |

If missing upstream would change this stage, capture that upstream minimum first. If it is approved, treat it as given.

## Workflow

### 1. Classify The Starting Point

Identify the stage the user is on and which artifacts already exist.

- If the user explicitly invoked a downstream skill such as `plan`, do not force this loop. Mention VRD or PRD risk only if it materially affects the requested work.
- If the user wants to suss out a north star, product taste, desired feel, or ideal reality, run a VRD interview and finish with a crisp summary. Do not require a PRD.
- If the user asks for a VRD or `vrd.md`, write that artifact from the dump.
- If the user asks for a PRD, first identify the source VRD. If it is missing or unstable, capture the minimum viable VRD first.
- If the user asks for a spec without an approved PRD, stop and ask whether to create the minimum VRD and PRD first or proceed with explicit product-risk assumptions.
- If the user asks for a plan, inspect for an approved spec. If it is missing, ask whether to spec first or proceed with explicit risk. An explicit plan request is enough reason to write a plan; do not re-ask whether sequencing is needed. If nobody asked for a plan and the spec is executable as-is, skip the plan.
- If intended behavior is already known (bounded bug fix, refactor, dependency update), say a full loop is unnecessary and capture only behavior-affecting assumptions.

Completion criterion: choose the lightest mode that will answer the user. Block a downstream artifact only when missing upstream clarity would change user-visible behavior, or when the user asked for the stricter chain.

### 2. Write The VRD

Use the VRD reference: [references/vrd.md](references/vrd.md).

The word dump is raw material. The VRD is the contract. Keep vivid user language where it carries taste.

Placement:

- Root system or operating cockpit: `./vrd.md`. If `./vibe.md` already exists there, use it as the live VRD.
- Feature or topic: `docs/prds/YYYY-MM-DD-<topic>/vrd.md` beside `prd.md`.
- If the repo already uses a flat PRD path, keep that path and place `vrd.md` beside it when possible.

Use stable feel IDs (`V1`, `V2`, ...). Keep the VRD product-facing and free of implementation.

Completion criterion for exploration: a usable north-star summary naming the problem, the desired world, the stakes, the feel, and the anti-vibes. Completion criterion for contract work: those same sections are written, implementation-free, and stable enough to derive a PRD without inventing intent.

### 3. Translate To PRD

Only write a PRD when the user asks for one or downstream work needs a durable product contract. Use the PRD reference: [references/prd.md](references/prd.md).
Placement:

- **Whole-project / repo-level PRD:** Lives at the project root alongside the root vibe/VRD: `./prd.md` (beside `./vibe.md` or `./vrd.md`). The primary contract for the whole project must be visible, prominent, and discoverable, never buried inside nested dated directories.
- **Sub-feature / scoped PRDs:** Subordinate or sub-feature PRDs can live in scoped locations (e.g. `docs/prds/YYYY-MM-DD-<topic>/prd.md` beside a scoped `vrd.md`), but the overarching project PRD belongs at the project root.
- If the repository already keeps an established flat PRD convention at root, keep that path.

Copy Problem As Felt and Why As Stakes from the VRD. Translate What Is Desired into observable requirements and acceptance criteria. Cite feel IDs for traceability; do not rewrite feel clauses as PRD functional requirements.
Before moving on, use `prd-grill` when that skill is available and the user wants a Socratic expectation check or the contract is high-stakes; otherwise grill inline against the VRD and PRD quality gates. Pass the VRD path (`vrd.md` or legacy `vibe.md`) and PRD path explicitly. Then ask the user to approve the VRD and PRD, or request amendments. Do not infer approval from silence.

Once the user has approved the contract and explicitly chosen low-touch
execution, hand downstream interpretation decisions to
`confidence-gated-review`. That policy does not approve contract changes,
irreversible actions, or a new category of decision; those still go to the
user. A PRD alone is not consent to skip review.

Completion criterion: requested PRD exists, has no placeholders, has no "Resolve Before Spec" questions, and is explicitly approved.

### 4. Write The Spec

Only create a spec when the user asks for one or the next execution step needs a technical how. Prefer `docs/prds/YYYY-MM-DD-<topic>/spec.md` beside the VRD and PRD unless repo convention already uses another spec path.

Read the codebase deeply enough to choose architecture, interfaces, state, and verification. If technical discovery reveals a product or feel decision the contract did not make, stop and ask for a VRD/PRD amendment instead of silently changing behavior.

Use the spec and plan reference: [references/spec-plan.md](references/spec-plan.md).

Completion criterion: every feel ID and PRD requirement ID maps to spec sections and proposed verification, and every technical decision exists to satisfy a contract item or explicit non-functional constraint.

### 5. Plan Only If Execution Needs It

Skip this stage when the spec is executable as-is. Write `plan.md` only when ordering, checkpoints, or parallel workstreams actually matter, or when the user asks for a plan. Prefer `plan` when that skill exists *and* a plan is warranted. The plan traces to the spec; it does not re-litigate product behavior or feel.

Completion criterion when a plan is written: every spec implementation need has a task or a deliberate non-code check, and no task implements behavior outside the VRD/PRD/spec without calling it out as a proposed amendment.

### 6. Produce The Ticket Spec (Before Dispatch)

Before dispatching work to a worker or spawning an executing workspace, produce the concrete **Ticket Spec**. Use the Ticket Spec reference: [references/ticket-spec.md](references/ticket-spec.md).

- **Intention:** The concrete **what** and **why** for this slice. Must state what problem is being solved and why now, traced directly to the VRD's What and Why-as-Stakes and the PRD.
- **Vibe:** Qualitative feel promises, stakes, and boundaries (traced to VRD feel IDs and anti-vibes). What must never happen during execution.
- **Done-when:** Observable, verifiable criteria for product acceptance (traced to PRD/Spec).
- **Map:** Explicit topology: workspace label, git worktree path, branch, and where related contracts live.

Rules:
- A ticket spec is not a title stub, not a session dump, and not a copy-pasted second PRD.
- The ticket spec must inherit its what/why directly from the VRD. A ticket spec with missing or ungrounded what/why fails the quality gate.
- Because it is a named concrete artifact, validate its structure and criteria before dispatch. Workers must never be prompted with vague one-liners or unbounded tasks.
Completion criterion: every dispatched task has a valid Ticket Spec with all four sections verified.

### 7. Grill Downstream Artifacts

After a spec, plan, or implementation claims to satisfy the contract, use `contract-audit` when that skill is available; otherwise audit inline against the VRD and PRD. Pass the VRD path (`vrd.md` or legacy `vibe.md`) and PRD path explicitly so discovery does not depend on a `vibe.md` filename. Use `prd-grill` only when grilling the human on whether the VRD and PRD themselves match expectations.

Completion criterion: no open P0/P1/P2 VRD/PRD contract violations remain, or the user has explicitly accepted the residual risk.

## Quality Gates

Before finalizing any artifact, check:

- **No ghost requirements:** nothing important is implied only by examples or raw chat context.
- **No fake completion:** no `TBD`, "etc.", "nice to have", "future phase", or "handle edge cases" without a concrete behavior.
- **No collapsed layers:** PRD does not contain execution tasks; spec does not contain work sequencing; plan does not invent product behavior.
- **No soft feel:** the VRD does not contain vague praise words without concrete feel checks, and feel violations are not downgraded to polish.
- **No prescriptive VRD:** clauses and definitions describe goals and feel; mechanisms appear only as labeled examples, never as formulas or required methods.
- **No silent narrowing:** platform, mobile, auth, permissions, empty states, errors, persistence, performance, and data visibility are either specified, explicitly irrelevant, or marked as blocking questions.
- **No unowned amendments:** any desired VRD or PRD change discovered during spec or implementation is surfaced as an amendment request before downstream docs proceed.
- **No second why:** PRD copies problem and stakes from the VRD rather than authoring an independent why.
- **No implementation in VRD:** `vrd.md` describes qualitative goals, feel, and stakes; mechanisms appear only as labeled examples if at all.
- **No review ledger in contract:** VRD and PRD remain clean normative law; review round mappings, tallies, and debate logs live in git PRs or review artifacts, not in the contract itself.
- **No re-interview:** approved VRD what/why is not asked again at PRD, spec, or plan.
- **No ritual plan:** a plan exists only because sequencing is needed or the user asked.
- **Root PRD visibility:** the primary or whole-project PRD lives at the project root (`./prd.md`) alongside the root vibe/VRD, not buried in nested dated directories.
- **Ticket Spec structure:** every dispatched ticket has a valid Ticket Spec with Intention, Vibe, Done-when, and Map before workers are prompted.
- **Ticket Spec What/Why Anchor:** Intention and Vibe must inherit directly from the VRD's What and Why-as-Stakes; no unanchored or context-free dispatch.
- **No unanchored dispatch:** workers are dispatched only with an approved Ticket Spec referencing verified worktree and contract paths.

Before finalizing an exploratory north-star or VRD pass, check:

- **No forced artifact:** a PRD, VRD, spec, or plan is created only because the user asked for it or because downstream execution truly needs it.
- **No mushy north star:** the summary names the desired experience, the user or audience, success signals, and what would feel wrong.
- **No premature pipeline:** the conversation can stop at VRD clarity without pretending the user has committed to PRD, spec, or plan.
