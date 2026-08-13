---
name: understand
disable-model-invocation: true
description: "Build a working model of a task or system, test it with teach-back, and map the gaps and unexamined areas before delegating or changing it."
argument-hint: "[topic, system, branch, task, or delegated report]"
---

# Understand

## Glossary

- **Working model**: a short explanation of what the thing is for, what is inside its boundary, how it behaves, what it depends on, and how its behavior is proved.
- **Coverage map**: an inventory of the areas around the target that may contain relevant facts, including areas not yet inspected.
- **GAP**: a missing, conflicting, or unverified fact that may change the next decision or make the result unsafe or unprovable.
- **Evidence tier**: the strength of support for a claim: `verified-live` means observed in a run or test, `documented` means stated by an authoritative source but not run here, and `inferred` means reasoned from incomplete or indirect evidence.
- **Teach-back**: the user, as the decision owner, explains the current model in their own words so missing or false understanding becomes visible.
- **Decision owner**: the person who must make or accept the next decision; in this skill, that is the user unless they explicitly name someone else.

The failure this skill prevents is delegated certainty: another person or agent returns a clean conclusion, but you cannot state the boundary, moving parts, assumptions, failure paths, or proof yourself. A summary is not your working model.

Use this skill before changing an unfamiliar system, assigning work that depends on system knowledge, accepting a delegated report, or making a decision when you suspect you do not know which questions are missing. It is not a replacement for a tutorial on a settled topic or for turning complete research into an audience-specific summary.
This skill is user-invoked. Start it explicitly with `understand` and an optional target; it does not run automatically.
If no target is supplied, inspect the current context first. If it is still missing, ask one bounded question for the target and decision; do not silently invent them.

## Operating contract

- Delegate evidence collection. Keep the target, boundary, working model, decisions, and proof that the result is correct in your session.
- Inspect primary sources before trusting a report. Treat a delegated report as a lead and claim list, not as evidence.
- Mark uncertainty where it appears. Use `GAP` when evidence is missing, keep `documented` for authoritative but untested claims, and label interpretations `inferred`; never turn a plausible explanation into a fact.
- Scan the space around the target. An area that has not been checked is itself a visible gap; do not hide it under "everything else."
- Keep the user in the loop with teach-back. Do not call understanding complete from a polished explanation alone.
- Do not ask the user for information that available tools, files, history, or runtime checks can provide.
- Delegation is allowed only for evidence about a named question after the gate. Do not delegate framing, synthesis, decisions, or acceptance of proof.

## 1. Name the target and decision

Write one sentence for each:

- **Target**: the task, system, branch, concept, or report to understand.
- **Decision**: what the understanding will let the user decide or do.
- **Boundary**: what is inside this pass and what is outside it.
- **Depth**: the smallest level of detail needed for that decision.

If the request is broad, choose the smallest useful slice and state the assumption. Do not turn "understand the system" into an unbounded tour. List the sources that can answer the question: tickets or briefs, state maps, docs, code, callers, tests, runtime behavior, external records, and history as relevant.

If the starting input is a delegated report, do not summarize it first. Break it into claims, copy its cited sources, and mark every conclusion that has no source as `GAP` or `inferred`.

Completion: the target, decision, boundary, depth, and available evidence sources are written down; the pass has no unbounded goal.

## 2. Build the coverage map

Inspect the target and its surroundings. Use this map for every pass; mark an area `not applicable` with a reason when it truly does not matter.

| Area | Establish |
| --- | --- |
| Purpose | Who needs this, what problem it solves, and what result counts as useful |
| Terms | Words, types, states, and business rules that change the interpretation |
| Shape | Components, actors, data, ownership, and relationships |
| Flow | The normal path, state changes, and handoffs |
| Boundary | Callers, dependencies, permissions, environment, and the first layer outside the target |
| Failure | Empty, invalid, partial, duplicate, slow, unauthorized, unavailable, and recovery behavior |
| Constraints | Existing decisions, invariants, non-goals, tradeoffs, and compatibility requirements |
| Proof | Tests, live checks, measurements, logs, or observations that establish behavior |
| History | Why the current shape exists and whether recent changes affect the model; required when a choice is unexplained, recently changed, regressed, migrated, compatibility-sensitive, or contradicted by another source |

For each area, record the current model, the source, and the evidence tier. Read enough of each source to understand its claim. For every decision-changing behavior, continue until you have one primary source and a corroborating caller, test, live observation, or explicit `GAP`; stop when new sources only repeat known claims and no unresolved source could change the decision. A filename, report headline, or changed-line count is not understanding. Trace important behavior through its callers, dependencies, tests, and failure path rather than reading only the named file.

Completion: every area has a concrete note, an evidence source and tier, or an explicit `not applicable` reason. Uninspected areas are visible as `GAP`.

## 3. Re-derive the important claims

Make a claim table for anything that could change the decision:

| Claim | Source or observation | Evidence tier | What it does not establish |
| --- | --- | --- | --- |
| one concrete statement | file, line, test, command, or observation | `verified-live`, `documented`, or `inferred` | remaining limit or missing check |

For a delegated report, re-check the claims that carry the recommendation first. Then check the claims that define scope, permissions, failure behavior, and proof. A report can save search time; it cannot supply the user's understanding.

When sources disagree, preserve both statements and record the contradiction as a `GAP`. When a source is authoritative but untested, keep it `documented`; do not upgrade it to `verified-live`. To obtain `verified-live`, run the smallest check that exercises the behavior and record the command or target, environment, result, and date. That live run may be the corroborating check; one run is sufficient for the behavior it exercises, not for neighboring claims. If that check cannot run, keep the weaker tier and record the missing check as a `GAP`. When the model depends on an interpretation, label it `inferred` and state what observation would confirm or reject it.

Completion: every decision-changing claim has a source or an explicit `GAP`, a visible evidence tier, and a stated limit. Contradictions are listed instead of silently resolved.

## 4. Sweep for missing questions

Use the coverage map to look for areas that are absent, thin, or supported only by inference. Ask these questions, adapting them to the target:

- What exists immediately outside the boundary, and what calls or depends on the target?
- What enters, leaves, persists, or changes state?
- Which part of the normal path is assumed rather than observed?
- What is the first meaningful failure, and what happens after it?
- What happens for empty, duplicate, partial, slow, unauthorized, or unavailable input?
- Which constraint or earlier decision would make the next action wrong if misunderstood?
- Who owns the behavior, the data, the environment, and the proof?
- Which claim came from a delegated conclusion rather than a primary source?
- What would a competent person reasonably ask that this pass has not asked?
- What exact check would prove the model wrong or confirm it in the real environment?

Record each gap:

| GAP | Area | Why it matters | Next check or owner | Severity | Status |
| --- | --- | --- | --- | --- | --- |
| missing, conflicting, or unverified fact | coverage-map area | decision or proof at risk | one concrete resolution | `blocking`, `important`, or `background` | `open`, `resolved`, or `accepted` |

`blocking` gaps could change the target, decision, scope, safety, or proof. `important` gaps could change implementation or risk but still allow a reversible next check. `background` gaps do not affect the current decision or proof. Never use an `everything else` row; split it until each gap has a clear question.

Completion: every gap has an area, consequence, severity, and next check or explicit acceptance. There is no unexamined category hidden behind a general statement.

## 5. Run the teach-back

Stop explaining before the user has to do any work.

The user is the decision owner for this pass. A delegate cannot stand in for this check; if no human is participating, mark teach-back `not run`.

Ask the five prompts below one at a time. A full pass answers all five; mark a prompt `not applicable` only with a reason.

1. What is the target for, and what is outside its boundary?
2. Walk through the normal path from input to result.
3. Name one important failure path and its recovery or terminal outcome.
4. Which parts are verified, documented only, or inferred?
5. What remains unknown, and why does each open gap block or not block the decision?

Compare the answers with the coverage map. If the user skips an area, uses a wrong relationship, or treats an inference as fact, correct the map and add the missing item as a `GAP`; do not silently repair the user's model in the final prose. Repeat only the failed questions.

Completion: the decision owner can state the purpose, boundary, normal flow, one important failure, evidence tiers, and open gaps in their own words, or the report clearly says teach-back is pending and understanding is not complete.

## 6. Gate delegation or change

Understanding is ready for a bounded next action only when:

- the target, decision, and boundary are explicit;
- the coverage map has no hidden area relevant to the decision;
- decision-changing gaps are resolved or explicitly accepted with their risk;
- the decision owner passes teach-back;
- the next action has one output and one observable proof.

If teach-back is unavailable, label the gate `provisionally ready - teach-back pending`. This permits evidence collection only; do not implement, decide, or claim understanding complete.

Understanding is complete only when the decision owner passes teach-back and the other gate conditions hold.

If delegating remains useful, delegate one named question, not "understand X":

```text
Question: <one fact or comparison to establish>
Why now: <the decision or proof it affects>
Boundary: <what to inspect and what not to inspect>
Sources: <named files, records, commands, or environment>
Return: <evidence with citations, conflicts, limits, and new GAPs>
Do not decide: <choice that stays with the owner>
Proof: <the observation that answers the question>
```

The delegate returns evidence and uncertainty. The decision owner updates the coverage map, re-derives the claim, and makes the decision. If a gap is blocking, keep the work in this skill instead of handing the gap to an agent under a vague request.
If delegated evidence conflicts with the current map, preserve both accounts, add the contradiction as a `GAP`, and pause the dependent decision. Run the smallest targeted check that can resolve it. If the delegate returns a new blocking gap, mark the assignment blocked and update the map; do not silently widen the assignment or continue as if the original question was answered.

Completion: every delegated assignment or implementation step points to a known gap or decision, has one bounded output and proof, and leaves decision ownership explicit.

## Report shape

Use the lightest report that still exposes the unknown space:

```text
## Target
- Target:
- Decision:
- Boundary:
- Depth:

## Working model
[Short explanation supported by the map. Mark claims with evidence tiers.]

## Coverage map
[One row for each relevant area, including GAPs and not-applicable areas.]

## Gaps
[One row per gap with consequence, severity, and next check.]

## Teach-back
[Answers, failed questions, corrections, or `not run`.]

## Gate
[Ready for one bounded next action, or the exact blocking GAPs.]

## Next check
[One concrete observation, question, or proof.]
```

Understanding is complete only after the user can explain the model, every relevant area has been checked or named as a gap, decision-changing uncertainty is resolved or accepted, and the next action has a clear proof. If teach-back is not run, the strongest allowed status is `provisionally ready - teach-back pending`, and only evidence collection may proceed. Anything else is `not ready`.
