---
name: lc-north-star
disable-model-invocation: true
description: "Vibe-first north-star clarification. Use when the user wants to word-dump an ideal reality, suss out vibes, name a north star, explore product taste, write a vibe.md, or translate a settled vibe into a PRD; also use when product feel, failure modes, users, success criteria, or scope boundaries are vague. Does not require a PRD unless the user asks for one or downstream execution needs one. Do not override an explicit downstream skill invocation such as plan; mention vibe/PRD risk only if material."
---

# North Star

Lead with ideal reality before requirements.

A north star starts as a word dump about the user's ideal reality: what should exist, how it must feel, what must never happen, and what would count as success. Let that be messy at first. Help the user get the vibe out of their head before turning it into requirements.

Use the formal artifact chain only when the user is moving toward specs, plans, implementation, or another artifact that needs a stable contract:

```text
Ideal-reality dump -> vibe.md -> PRD -> Spec -> Plan -> Implementation
```

Treat this chain as one current shape, not a fixed system. When the project keeps a repo-level philosophy vibe (convention: `docs/vibe.md`), that vibe is the source of truth and this chain is a downstream facet of it, updated as the vibe iterates. Keep stages few: three is ideal, four or five in practice, and the whole pipeline should be as painless and fast as possible while still productive. Do not add stages, and do not treat the chain's form as settled.

The ideal-reality dump is the raw material. `vibe.md` distills the desired feel, taste, anti-vibes, and north star. The PRD is downstream of the vibe: it translates the settled ideal into observable product behavior, scope, requirements, and acceptance criteria. The spec defines **how the product will satisfy the PRD and preserve the vibe**. The plan defines **how the agent will execute the spec**.

## Artifact Rules

- Do not require a PRD, create files, or force a product/feature pipeline for exploratory north-star or vibe work.
- Capture or approve the vibe before drafting a PRD. The PRD should read as a product-requirements translation of the vibe, not a parallel source of truth invented from scratch.
- Treat `vibe.md` as the upstream product-feel source when it exists. A target that technically satisfies the PRD but violates `vibe.md` is still wrong.
- Treat the PRD and `vibe.md` as immutable after approval. Change either only when the user explicitly asks to amend it or edits it directly.
- Treat the spec as living when it exists. Update it when implementation research, design changes, or refactors change the technical approach.
- Treat the plan as disposable execution choreography when it exists. Rewrite it when the spec changes materially.
- Bound the fix rounds. A contract document gets at most two review-and-fix rounds, and the goal is one. A document that seems to need a third means the draft failed: rewrite or re-interview instead of opening round three.
- Do not hide product work in "phase 2". If a behavior matters to the golden ideal, either include it now or record an explicit scope boundary with the acceptable current behavior.
- Do not let implementation details leak into north-star or PRD work unless they are product constraints the user would recognize, such as "must work on mobile web" or "must not require an installed app".

## Workflow

### 1. Classify The Starting Point

Identify what kind of clarity the user is asking for and what artifacts, if any, already exist.

- If the user explicitly invoked a downstream skill such as `plan`, do not force this workflow. Mention serious vibe or PRD ambiguity as a planning risk only if it materially affects the requested work.
- If the user wants to suss out a vibe, north star, product taste, positioning, desired feel, ideal reality, or early direction, run a lightweight interview and finish with a crisp summary instead of requiring a PRD.
- If the user asks for `vibe.md`, create or finish the vibe artifact from the user's ideal-reality dump.
- If the user asks for a PRD, requirements, acceptance criteria, or durable contract, first identify the source vibe. If the vibe is missing or unstable, capture the minimum viable vibe before drafting the PRD.
- If the user asks for a spec without an approved PRD, stop and ask whether to create the minimum necessary vibe and PRD first or proceed with explicit product-risk assumptions.
- If the user asks for a plan without an approved spec, stop and ask whether to create the spec first or proceed with explicit product-risk assumptions.
- If the request is a bounded bug fix, test plan, refactor, dependency update, or other work where intended behavior is already known, state that a full PRD is unnecessary and capture only behavior-affecting assumptions.

Completion criterion: choose the lightest mode that will answer the user. Block downstream artifacts only when the missing upstream clarity would materially change user-visible behavior, or when the user has asked for the stricter artifact chain.

### 2. Run The North-Star Interview

Read enough local context to avoid asking questions the repo already answers, but keep the interview at product level. Ask one blocking question at a time and wait for the answer. Prefer concrete choices when possible. Probe understanding, not just requirements: a successful interview leaves the user able to explain the product back, not merely a document that captures it.

Pressure-test every important behavior with negative probes:

- "Would it be acceptable if..."
- "What should happen when..."
- "Who must be unable to..."
- "What would make this feel broken even if the happy path works?"

Use the vibe reference when turning ideal reality into `vibe.md`: [references/vibe.md](references/vibe.md).
Use the PRD reference only when translating a settled vibe into requirements: [references/prd.md](references/prd.md).

Completion criterion for exploration: the user has a usable ideal-reality or north-star summary, concrete vibe rails, unacceptable outcomes, success signals, and the most important open questions. Completion criterion for contract work: the vibe is stable enough to derive requirements, every major behavior has a positive requirement, at least one unacceptable outcome or counterexample, a success signal, and no unresolved product question that would change scope or user-visible behavior.

### 3. Write And Approve The Contract

Only write contract files when the user asks for a durable artifact, approves escalation from exploration, or needs a contract before spec/plan/implementation.

For formal contract work, prefer vibe first, then PRD:

- Vibe: `docs/prds/YYYY-MM-DD-<topic>/vibe.md`
- PRD: `docs/prds/YYYY-MM-DD-<topic>/prd.md`

If the repo already uses a flat PRD convention, keep the PRD path and place the source `vibe.md` beside it when possible. Use stable vibe IDs (`V1`, `V2`, ...) and PRD requirement IDs (`R1`, `R2`, ...). Keep both product-facing and free of implementation choreography.

Before moving on, use `prd-grill` when the user wants a Socratic expectation check or the contract is high-stakes enough that approval needs pressure-testing. Then ask the user to approve the `vibe.md` and PRD, or request amendments. Do not infer approval from silence.

Once the user has approved the contract and explicitly chosen low-touch
execution, hand downstream interpretation decisions to
`confidence-gated-review`. That policy does not approve contract changes,
irreversible actions, or a new category of decision; those still go to the
user. A PRD alone is not consent to skip review.

Completion criterion for formal contract work: requested contract files exist, have no placeholders, have no "Resolve Before Spec" questions, and are explicitly approved by the user.

### 4. Create The Spec From The Contract

Only create a spec when the user asks for one or the next execution step requires one. After `vibe.md` and PRD approval, create or update the spec from the contract. Read the codebase deeply enough to choose architecture, interfaces, data flow, and tests. If technical discovery reveals a product or vibe decision the contract did not make, stop and ask for an amendment instead of silently changing product behavior.

Use the spec and plan reference for the downstream contract: [references/spec-plan.md](references/spec-plan.md).

Completion criterion: every vibe ID and PRD requirement ID maps to spec sections and proposed verification, and every technical decision exists to satisfy a contract item or explicit non-functional constraint.

### 5. Create The Plan From The Spec

Only create a plan when the user asks for one or is ready to execute. After the spec is ready, create an implementation plan from the spec. In this repo, prefer `plan` when available. The plan must trace to the spec rather than re-litigating product behavior or vibe.

Completion criterion: every spec requirement has an implementation task or a deliberate non-code verification step, and no task implements behavior outside the PRD/vibe/spec without calling it out as a proposed amendment.

### 6. Grill Downstream Artifacts

After a spec, plan, or implementation claims to satisfy the contract, use `contract-audit` to audit it against PRD and `vibe.md` intent before calling it complete. Use `prd-grill` only when grilling the human on whether the PRD and `vibe.md` themselves match expectations.

Completion criterion: no open P0/P1/P2 PRD/vibe contract violations remain, or the user has explicitly accepted the residual risk.

## Quality Gates

Before finalizing any artifact, check:

- **No ghost requirements:** nothing important is implied only by examples or raw chat context.
- **No fake completion:** no `TBD`, "etc.", "nice to have", "future phase", or "handle edge cases" without a concrete behavior.
- **No collapsed layers:** PRD does not contain execution tasks; spec does not contain work sequencing; plan does not invent product behavior.
- **No soft vibe:** `vibe.md` does not contain vague praise words without concrete feel checks, and vibe violations are not downgraded to polish.
- **No prescriptive vibe:** clauses and definitions describe goals and feel; mechanisms appear only as labeled examples, never as formulas or required methods.
- **No silent narrowing:** platform, mobile, auth, permissions, empty states, errors, persistence, performance, and data visibility are either specified, explicitly irrelevant, or marked as blocking questions.
- **No unowned amendments:** any desired PRD or vibe change discovered during spec or implementation is surfaced as an amendment request before downstream docs proceed.

Before finalizing an exploratory north-star or vibe pass, check:

- **No forced artifact:** a PRD, `vibe.md`, spec, or plan is created only because the user asked for it or because downstream execution truly needs it.
- **No mushy north star:** the summary names the desired experience, the user or audience, success signals, and what would feel wrong.
- **No premature pipeline:** the conversation can stop at clarity without pretending the user has committed to a whole product or feature flow.
