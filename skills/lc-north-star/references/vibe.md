# Vibe Reference

`vibe.md` is the upstream north-star contract. It is the single source of truth for the problem-as-felt, why-as-stakes, qualitative feel promises, and anti-vibes.

Stakes live on the vibe. The PRD copies stakes from the vibe rather than originating a second why. The vibe is void of implementations: definitions and clauses describe goals, tension, and feel; mechanisms appear only as labeled examples if at all. A vibe that reads as an implementation or procedure is a spec in the wrong document.

Vibe is not advisory. The PRD translates the vibe into observable product requirements, while feel clauses remain in the vibe. If the finished product violates `vibe.md`, it violates the contract even when the PRD's functional requirements technically pass.

## Vibe Template

```markdown
---
date: YYYY-MM-DD
topic: <kebab-case-topic>
status: draft
source_material: user ideal-reality dump, conversation, notes, or linked artifact
---

# <Product Or Feature> Vibe

## Problem As Felt

[What hurts, who feels the friction, and what is broken in the current world. Expressed in user and product terms, void of implementation mechanisms.]

## Why As Stakes

[The single source of truth for why this work matters: what happens if nothing changes, what success unlocks, and what is at risk. The PRD copies these stakes rather than authoring a second why.]

## Vibe Promise

[One paragraph describing how the product must feel in use, in the circumstances where it matters most.]

## Ideal Reality Dump

- [Raw or lightly edited fragments from the user about the world they want to exist.]
- [Keep vivid user language when it carries taste, intent, or rejection energy.]

## Use Circumstances

- [Context where this must work well: rushed, distracted, mobile, high-stakes, repeated daily, first-time use, operator under pressure, etc.]

## Vibe Clauses

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
- Amendment rule: This vibe changes only by explicit user request or direct user edit.
(Note: Keep vibe.md as pure normative law. Do not append review round ledgers, tallies, or audit logs here; review histories belong in git PRs and review artifacts.)
```

## Vibe Quality Bar

Each vibe clause must be:

- Qualitative but assessable.
- Non-prescriptive: it describes the goal and the feel; any mechanism is a labeled example.
- Strong enough to reject a technically-correct-but-wrong-feeling implementation.
- Grounded in use circumstances, not generic positivity.
- Written without implementation details, libraries, file paths, or UI prescriptions unless the feel contract truly depends on them.
- Stable enough that it should not drift during normal implementation.

Good vibe clauses say:

- "It should just work: users should not need to understand the underlying provider, chain, job, or state machine."
- "It should feel forgiving: refresh, retry, or back navigation should not make users wonder whether they broke something."
- "It should feel calm under pressure: the primary next action and current status should be obvious even when the user is distracted."

Bad vibe clauses say:

- "Make it delightful."
- "Use a clean UI."
- "Should be intuitive."

Those can become good clauses only after naming what would prove or violate them.

## Vibe Pressure-Test Prompts

Use these when drafting `vibe.md`:

- What should this feel like when everything is working?
- What should this feel like when something is slow, empty, partial, or failing?
- What should the user not have to understand?
- What should the user never worry about?
- What would make the product technically correct but still feel wrong?
- Where should the product feel invisible, boring, obvious, powerful, calm, forgiving, or precise?
- What circumstances matter most: mobile, rushed, distracted, repeated daily, high-value, first-time, operator incident, executive review?
- What anti-vibe would make you reject the implementation even if all acceptance criteria passed?

## Completeness Check

Before approval, verify:

- Every major feel promise has a violation example.
- Every use circumstance is covered by at least one vibe clause or explicitly rejected as not important.
- Every clause has a check that can be applied to a finished product, demo, screenshot, or code path.
- No clause is merely a synonym for a PRD requirement.
- No clause is secretly an implementation instruction.
- The document is rich enough for a PRD to be derived from it without inventing product intent.
- Problem-as-felt and why-as-stakes are articulated clearly without mentioning implementation mechanisms.
- The document is clean normative law and contains no review audit ledgers or changelogs.
