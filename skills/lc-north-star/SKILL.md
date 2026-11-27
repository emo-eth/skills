---
name: lc-north-star
disable-model-invocation: true
description: "VRD-first north-star loop. Use when the user wants to word-dump an ideal reality, capture a VRD, name a north star, or derive product requirements and technical design. The five documents are VRD, constraints, PRD, decisions, and spec; execution plans and tickets remain optional downstream adapters."
---

# North Star

Lead with the VRD: the what, why, and feel before product requirements or implementation.

```text
VRD (vrd.md) -> Constraints (constraints.md) -> PRD (prd.md) -> Decisions (decisions.md) -> Spec (spec.md)
```

The pipeline answers five different questions:

- **VRD**: What hurts, what world is wanted, why does it matter, and how must it feel?
- **Constraints**: What does reality impose, and which temporary safeguards are active?
- **PRD**: What does the product do, for whom, and in this release?
- **Decisions**: Which technical approach is chosen to satisfy the approved product?
- **Spec**: How is that product enforced, recovered, and verified in software?

A plan, ticket, issue, or checklist is an execution adapter after the spec. It is not a VDD stage. Do not create one unless the repository uses it or execution actually needs it.

`vrd.md` replaces the old name `vibe.md` for new contracts. In an existing repository, read `vibe.md` as the live VRD unless the user requests a rename.

## Artifact Rules

- Do not force files or later stages for exploratory VRD work.
- Use the lightest artifact that answers the request. Routine bug fixes, refactors, dependency updates, and mechanical changes usually need only behavior-affecting assumptions.
- Keep vivid user language when it carries taste, rejection, or urgency. Park mechanisms for later stages.
- Approve the VRD before drafting the PRD. Stakes originate on the VRD; the PRD translates them rather than inventing a second why.
- A result that satisfies the PRD but violates the VRD is wrong.
- Constraints record imposed limits and active safeguards. Technology selected by engineering belongs in decisions, not constraints.
- A safeguard names its owner, enforcement seam, and condition for removal. It is temporary unless the operator says otherwise.
- Decisions may change without changing the VRD. A decision that changes user-visible behavior requires a PRD or VRD amendment first.
- The spec is living. Update it for technical design, interface, state, recovery, or verification changes.
- VRD and PRD change only through explicit user request or direct user edit after approval.
- Do not turn the VRD into a bug log. Trace implementation failures to a missing product requirement, decision, spec treatment, or code defect.
- At most two review-and-fix rounds per contract document. After two failures, rewrite rather than adding ceremony.

## Stage Cutover

| Artifact | What lives here | What does not |
| --- | --- | --- |
| VRD | Problem-as-felt, desired reality, stakes, feel clauses, anti-vibes | Architecture, commands, APIs, task order |
| Constraints | Platform and host limits, mandatory integrations, resource limits, active safeguards, graduation conditions | Chosen stack, product requirements |
| PRD | Users, jobs, journeys, observable requirements, current release, success criteria, scope boundaries | Schemas, protocols, execution tasks, a second why |
| Decisions | Options, chosen technologies, trade-offs, evidence, reopen conditions | Product debates and user promises |
| Spec | Architecture, interfaces, state, recovery, authority guards, verification, traceability | Unapproved scope and task sequencing |

## Tight Questions

Read local context first. Ask one compact batch of questions that can change the current stage, then wait.

| Stage | Ask about | Leave alone |
| --- | --- | --- |
| VRD | Pain, desired world, stakes, feel, unacceptable outcomes | Architecture, APIs, commands, tasks |
| Constraints | Imposed limits, trust controls, owners, graduation evidence | Stack preferences that are not imposed |
| PRD | Observable behavior, users, release scope, success, edge states | Why, feel restated as a new source, implementation |
| Decisions | Credible options, trade-offs, evidence, reopen conditions | Product intent already approved |
| Spec | Technical how, interfaces, state, recovery, verification | Product behavior already approved |

When two real product philosophies would produce different outcomes, present one contrast: Option A, Option B, how each feels, and what each rules out. Do not invent a menu or guess the user's preference.

## Workflow

### 1. Classify the starting point

- North-star exploration: interview lightly and finish with a clear summary. Do not require a file or PRD.
- VRD request: write the minimum VRD from the word dump.
- PRD request: locate or create the minimum stable VRD first.
- Constraints request: reuse the existing constraints document when present; add only real limits or safeguards.
- Technical choice: write or update decisions after the PRD identifies the need.
- Spec request: require an approved PRD unless the user explicitly accepts product-risk assumptions.
- Plan or ticket request: treat it as an execution adapter; inspect the spec and existing repository convention instead of adding a VDD stage.
- Known behavior change: skip the full loop and capture only assumptions that affect behavior.

### 2. Write and refine the VRD

Use [references/vrd.md](references/vrd.md). Place a repo-level VRD at `./vrd.md`; use a scoped `docs/prds/YYYY-MM-DD-<topic>/vrd.md` only for a feature with its own contract.

A useful VRD distinguishes Problem As Felt, What Is Desired, Why As Stakes, Feel Clauses, and Anti-Vibes. Each feel clause has a qualitative promise, one concrete experience, a violation, and a check. The count is driven by the product; do not pad it.

### 3. Translate the VRD into a PRD

Use [references/prd.md](references/prd.md). The PRD derives users, journeys, requirements, undesirable outcomes, current release scope, and success criteria from the approved VRD and active constraints. It may distinguish target capability from current release behavior, but it must not silently shrink the target.

### 4. Record constraints and decisions

Use [references/constraints.md](references/constraints.md) for imposed reality and safeguards. Use [references/decisions.md](references/decisions.md) for chosen technology and trade-offs. Constraints can shape release scope; decisions can shape the technical design. Neither can silently alter the VRD or PRD.

When the project is new and the order is being authored from scratch, constraints are clarified before the PRD and decisions follow the PRD. Existing project documents may be updated in the smallest order that preserves their source links.

### 5. Write the technical spec

Use [references/spec-plan.md](references/spec-plan.md). Trace every relevant VRD clause and every PRD requirement to spec sections and verification. Technical discovery that changes product behavior becomes an amendment request, not an unannounced implementation choice.

### 6. Use an execution adapter only when needed

A plan is for sequencing. A ticket is for a tracker-driven execution environment. Neither may invent product behavior. After implementation, audit the result against the approved VRD and PRD using the repository's review convention.

## Quality Gates

Before finalizing any artifact, check:

- no placeholders or fake completion claims;
- no implementation mechanics in the VRD's qualitative clauses;
- no second why in the PRD;
- no technology filed as an imposed constraint without an external reason;
- no chosen technology without a PRD requirement, constraint, or explicit operator direction;
- no silent narrowing of platform, permissions, errors, persistence, performance, visibility, or recovery;
- no unresolved product question hidden as a technical question;
- no contract change discovered downstream is implemented before approval;
- no review ledger or debate history appended to the VRD or PRD;
- no ritual plan or ticket stage added to the VDD pipeline.

Before exploratory work ends, the summary must name the desired experience, audience, success signal, and what would feel wrong. It may stop there.
