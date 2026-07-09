---
name: prd-grill
description: "Human-facing PRD and vibe.md grill. Use after drafting or revising a PRD, vibe.md, product contract, or north-star artifact when the user wants to be questioned until the document matches their expectations; triggers include grill the PRD, grill me on this PRD, walk me through the product contract, does this capture what I mean, or before approval of high-stakes PRD/vibe docs. Do not use to audit a spec, plan, code diff, branch, or implementation against an approved contract; use contract-audit for artifact alignment."
---

# NM PRD Grill

Use this skill to help a human decide whether a PRD and optional `vibe.md` truly capture what they intend to authorize.

The grill is an expectation interview. The reviewer is the user; the target is their understanding and approval of the contract. `vibe.md` is contractual: if the user would reject the finished product for violating a vibe clause, the document must say that plainly.

## Artifacts

- **PRD:** product intent: requirements, undesirable outcomes, success criteria, scope boundaries, and explicit deferrals.
- **vibe.md:** qualitative contract: how the product must feel, when that feel matters, and what anti-vibes are forbidden.
- **Grill notes:** confirmed decisions, amendments made during review, and open questions that block approval.

## Workflow

### 1. Locate The Draft Contract

Find the draft PRD from an explicit path, current conversation, recent `docs/prds/`, or the sibling `prd.md` in a north-star bundle.

Find `vibe.md` when it exists. Use explicit paths, `source_vibe` frontmatter, a sibling `vibe.md`, a `*-vibe.md` beside a flat PRD, or ask the user if more than one vibe file plausibly applies.

If the user is asking whether a spec, plan, code diff, branch, implementation, demo, or shipped behavior satisfies an approved contract, switch to `contract-audit`.

Completion criterion: the PRD and applicable `vibe.md` are read, the review target is the contract itself, and any missing document path is resolved before questioning.

### 2. Decompose The Contract

Silently break the PRD and `vibe.md` into grillable sections:

- North-star promise and target users.
- Jobs, primary flows, and success criteria.
- Requirements and acceptance criteria.
- Undesirable outcomes, "not acceptable" clauses, and counterexamples.
- Scope boundaries and explicit deferrals.
- Platform, mobile, permissions, data visibility, empty, loading, error, persistence, and performance expectations.
- Vibe promises, anti-vibes, use circumstances, and qualitative checks.
- Open questions that block approval.

Order questions from product intent to edge cases to vibe. Grill foundational decisions before downstream details.

Completion criterion: every section that could change user-visible behavior or contract feel has a planned questioning round, unless it is obviously trivial and already explicit.

### 3. Grill Section By Section

Ask 2-4 concrete questions per round, then wait for the user's answer. Do not dump the whole questionnaire at once.

Use negative probes that reveal whether the document authorizes the wrong product:

- "Would it be acceptable if..."
- "Would you reject the finished product if..."
- "What should happen when..."
- "Who must be unable to..."
- "What would make this feel broken even if the happy path works?"
- "Does this wording make that promise contractual enough?"
- "If this is not shipped now, what exact current behavior is acceptable?"

Keep the tone Socratic and specific. Reference exact PRD requirement IDs, vibe IDs, wording, examples, and gaps. Do not manufacture objections when a section is genuinely clear; say it looks settled and move on.

Completion criterion: each questioned section is either confirmed as written, amended, marked as accepted without review at the user's request, or left with a named open question.

### 4. Amend Immediately

When the user disagrees, hesitates, or reveals a missing expectation:

1. Restate the decision in plain product language.
2. Propose the exact PRD or `vibe.md` amendment.
3. Ask for confirmation.
4. Apply the edit immediately if the document is on disk.
5. Check whether the amendment changes another requirement, vibe clause, scope boundary, success criterion, or open question.

Do not defer all edits to the end. The contract being grilled should stay current as the user clarifies intent.

Completion criterion: every confirmed user correction is reflected in the PRD or `vibe.md`, or explicitly queued as an open question because the user has not decided yet.

### 5. Sign Off

After all sections are covered, summarize:

- Confirmed as written.
- Updated during review.
- Accepted without review, if the user skipped a section.
- Open questions blocking approval.
- Whether the PRD and `vibe.md` are approved.

Use this output shape:

```markdown
## PRD Grill Complete

PRD: `path`
Vibe: `path or none`
Status: approved | not-approved

### Confirmed As Written
- [Section or ID]: [one-line decision]

### Updated During Review
- [Section or ID]: [what changed and why]

### Open Questions
- [Question and why it blocks approval]

### Accepted Without Review
- [Section or ID, if any]
```

Do not infer approval from silence. Approval must be explicit.
