# VRD Reference

A **VRD** (Vibe Requirements Document) is the upstream north-star contract, written to `vrd.md`. It is the single source of truth for the problem-as-felt, what is desired, why-as-stakes, qualitative feel promises, and anti-vibes.

Stakes live on the VRD. The PRD copies stakes from the VRD rather than originating a second why. The VRD is void of implementations: definitions and clauses describe goals, tension, and feel; mechanisms appear only as labeled examples if at all. A VRD that reads as an implementation or procedure is a spec in the wrong document.

VRD is not advisory. The PRD translates what is desired into observable product requirements, while feel clauses remain in the VRD. If the finished product violates the VRD, it violates the contract even when the PRD's functional requirements technically pass.

Feel promises are immutable. Operational procedures named as examples are replaceable and are not the contract.

Legacy `vibe.md` files are VRDs under the old name. Read them as the VRD. Write new contracts as `vrd.md`. Do not rename an existing `vibe.md` unless the user asks.

## VRD Template

```markdown
---
date: YYYY-MM-DD
topic: <kebab-case-topic>
status: draft
source_material: user ideal-reality dump, conversation, notes, or linked artifact
---

# <Product Or Feature> VRD

## Problem As Felt

[What hurts, who feels the friction, and what is broken in the current world. Expressed in user and product terms, void of implementation mechanisms.]

## What Is Desired

[The world that should exist when this is done: who it is for, what becomes true, and the circumstances where it must hold. Keep vivid user language. Not a solution design.]

## Why As Stakes

[The single source of truth for why this work matters: what happens if nothing changes, what success unlocks, and what is at risk. The PRD copies these stakes rather than authoring a second why.]

## Feel Clauses

### V1. <Clause Title>

- Promise: [Qualitative behavior that must be true.]
- Example: [One concrete shape this promise can take. An example, not a formula.]
- Does not mean: [Misreadings or overextensions.]
- Violation: [Concrete product shape that would break the promise.]
- Check: [How a reviewer can assess this in the finished product.]

### V2. <Clause Title>

- Promise:
- Example:
- Does not mean:
- Violation:
- Check:

## Anti-Vibes

| Anti-vibe | Why it violates the contract | Clause |
| --- | --- | --- |
| [How the product must not feel] | [Why that matters] | [V-id] |

## Approval

- Approved by:
- Approved on:
- Amendment rule: This VRD changes only by explicit user request or direct user edit.
(Note: Keep the VRD as pure normative law. Do not append review round ledgers, tallies, or audit logs here; review histories belong in git PRs and review artifacts.)
```

## VRD Quality Bar

Each feel clause must be:

- Qualitative but assessable.
- Non-prescriptive: it describes the goal and the feel; any mechanism is a labeled example.
- Strong enough to reject a technically-correct-but-wrong-feeling implementation.
- Grounded in use circumstances, not generic positivity.
- Written without implementation details, libraries, file paths, or UI prescriptions unless the feel contract truly depends on them.
- Stable enough that it should not drift during normal implementation.

Good feel clauses say:

- "It should just work: users should not need to understand the underlying provider, chain, job, or state machine."
- "It should feel forgiving: refresh, retry, or back navigation should not make users wonder whether they broke something."
- "It should feel calm under pressure: the primary next action and current status should be obvious even when the user is distracted."

Bad feel clauses say:

- "Make it delightful."
- "Use a clean UI."
- "Should be intuitive."

Those can become good clauses only after naming what would prove or violate them.

## VRD Pressure-Test Prompts

Use these when drafting the VRD. They are VRD-stage questions only.

- What hurts right now, and who feels it?
- What should be true in the world this product creates?
- What happens if nothing changes? What does success unlock?
- What should this feel like when everything is working?
- What should this feel like when something is slow, empty, partial, or failing?
- What should the user not have to understand?
- What should the user never worry about?
- What would make the product technically correct but still feel wrong?
- Where should the product feel invisible, boring, obvious, powerful, calm, forgiving, or precise?
- What circumstances matter most: mobile, rushed, distracted, repeated daily, high-value, first-time, operator incident, executive review?
- What anti-vibe would make you reject the implementation even if all acceptance criteria passed?

Do not use this pass to choose architecture, APIs, file layout, or task order.

## Completeness Check

Before approval, verify:

- Problem-as-felt, what is desired, and why-as-stakes are articulated clearly without mentioning implementation mechanisms.
- Every major feel promise has a violation example.
- Circumstances that matter are covered by at least one feel clause or explicitly rejected as not important.
- Every clause has a check that can be applied to a finished product, demo, screenshot, or code path.
- No clause is merely a synonym for a PRD requirement.
- No clause is secretly an implementation instruction.
- The document is rich enough for a PRD to be derived from it without inventing product intent.
- The document is clean normative law and contains no review audit ledgers or changelogs.
