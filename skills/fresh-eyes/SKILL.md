---
name: fresh-eyes
description: Validate that a prose artifact or an unstated product idea survives a cold reader, by spawning a clean-context agent given ONLY the artifact or a neutral idea brief and quizzing it with scenario questions that require line citations or explicit GAP declarations. Use before choosing an implementation, after writing or heavily editing a document meant to instruct a reader with zero prior context, before shipping or trusting it, or when the user asks to "cold-read this", "test this with a fresh agent", or "would a fresh agent understand this". Failures are the artifact or brief's fault, never the reader's.
---

# Fresh Eyes

The failure this defends against: prose that only works when the author is
hovering nearby explaining it. An author reviewing their own text always
passes — they already know what it means, so the gaps are invisible to
them. The cheapest verification that exists for a prose artifact is a
reader with zero context and no way to ask questions.

When to use: before choosing an implementation when only the underlying idea
exists, or after writing or heavily editing a skill, doc, plan, or spec meant
to instruct — before shipping or trusting it. Not for code (tests do that
job), not for trivial edits.

## Choose the input

Use **artifact mode** when a deliverable already exists. Test the artifact's
instructions directly.

Use **idea mode** when the goal exists but the solution does not. Give the
validator a neutral brief containing only the desired outcome, who needs it,
the situation that triggers it, observable success, constraints, and explicit
non-goals, where those facts are known. A short or incomplete goal is valid
input: mark unknowns as unknown or leave them for the validator to report as
GAPs. Do not invent missing requirements while preparing the brief.

Do not include a proposed skill, hook, runtime, tool, architecture, workflow,
implementation, or distribution plan. Do not include the author's preferred
solution as a supporting file. The validator must test the need without
inheriting a solution.

If both an idea and an artifact exist, run two separate passes. First run idea
mode against the neutral brief. Then run artifact mode against the deliverable.
Never use the artifact or its design proposal as context for the idea pass.

## The protocol

1. **Isolate.** In artifact mode, hand the validator ONLY the artifact plus
   an explicit short list of supporting files. In idea mode, hand it ONLY
   the neutral idea brief plus explicit domain definitions that the brief
   requires. Forbid reading anything else. This simulates a fresh install,
   not a fresh chat — if the validator answers from context the input does
   not contain, the test proves nothing.
2. **Write scenario questions, never review questions.** In artifact mode,
   ask "X just happened — walk through exactly what you do, in order" to
   force the reader to traverse the actual text. In idea mode, ask what the
   user wants, what success looks like, and what should happen in concrete
   situations. Do not ask the validator to design the solution. "Does this
   look good?" invites a vibe-check, and vibe-checks always pass.
3. **Quote-or-GAP.** Every answer must cite the line it relied on, or
   declare `GAP:` plus what a fresh reader would get wrong there. This is
   the load-bearing constraint: an agent that can't cite a line is
   pointing at an ambiguity it would otherwise paper over with confident
   reasoning. Without it, you get reassurance instead of findings.
4. **Failures are the input's fault, never the reader's.** If the
   validator floundered, asked for context, answered from the wrong section,
   or invented a solution in idea mode, the artifact or brief is ambiguous,
   missing, contaminated, or contradictory. Fix the input or restart with a
   neutral brief. Never argue with a GAP ("any reasonable agent would
   infer…") — the next reader won't.
5. **Fix and re-run until cold pass.** Re-validate after fixing: fixes
   routinely introduce NEW contradictions with untouched sections. One
   pass finds the gaps; the second pass finds what the fixes broke.

To create the isolated reader, start a separate agent with no copied or
forked conversation history and give it only the selected input files and the
validator brief. Use the available clean-context agent mechanism; do not
simulate isolation by asking the current agent to forget its context. If the
environment cannot create an isolated reader, report that fresh-eyes could
not run instead of claiming a pass.

## Validator brief template

The shape that works, from practice:

```text
You are validating whether <artifact> is self-sufficient. Read ONLY these
files — do not read anything else, so you simulate a fresh install:
<explicit file list>

This is a RESEARCH task — do not write or edit anything. Answer these
scenario questions strictly from what the text says, quoting the lines you
rely on. Where the text is silent or ambiguous, say "GAP:" and explain
what a fresh reader would get wrong.

<scenario questions, each one a concrete situation the artifact claims to
cover>

Return: answers, then a list of every GAP found.
```

For idea mode, use a separate brief. Keep the input free of solution
language, and make the prohibition explicit:

```text
You are validating whether this product idea is clear enough to take to
design. Read ONLY these files — do not read anything else:
<neutral idea brief>
<explicit domain definitions, if any>

This is a RESEARCH task — do not write or edit anything. Do not propose a
skill, hook, runtime, tool, architecture, workflow, implementation, or
distribution plan. Do not fill gaps with a design you already know. Answer
these concrete scenario questions strictly from what the brief says,
quoting the lines you rely on. Where the brief is silent or ambiguous, say
"GAP:" and explain what two reasonable readers could get wrong.

<scenario questions about the desired outcome, trigger, success, boundaries,
and important edge cases>

Return: your plain-language interpretation, the scenario answers, every GAP
found, and the decisions that must be made before design. Do not solve the
GAPs.
```

The idea pass is a requirements check, not a feasibility study or a design
review. Its purpose is to preserve the user's actual goal before an author or
agent adds solution baggage. In this pass, "decisions before design" means
unresolved choices about the user, trigger, desired outcome, success measure,
constraints, non-goals, or important edge behavior. It does not mean choices
about tools, architecture, implementation, or distribution; those belong to
later design work.

Include a domain definition only when the brief uses a term whose meaning is
needed to answer a scenario. Define that term in plain language in the brief.
Do not use a domain definition to smuggle in a solution or outside context.

Scenario questions should cover the artifact's main flow end-to-end plus
its advertised edge cases — one question per claim you'd be embarrassed
to discover is unwritten.

## Boundary with skill-iteration

Fresh-eyes is the cheap pre-flight: does the idea or artifact survive a cold
reader? `skill-iteration` is the expensive field test: does the skill survive
a real task under load? Run the idea pass before designing when the goal is
still unsettled, then run the artifact pass before you spend a real task
discovering ambiguity or contradiction. A skill that passes the artifact
pass is ready to be trial-run; a skill that has not passed it is not worth the
field test yet.

## Failure modes

- **Review questions** — "any thoughts on this doc?" Fix: scenarios, each
  demanding a walkthrough with citations.
- **Contaminated reader** — validator reads the whole repo and answers
  from context the artifact lacks. Fix: explicit file list, forbid the
  rest, say why.
- **Citation-free answers** — confident prose with no quoted lines. Fix:
  reject the run; quote-or-GAP is the mechanism, not a nicety.
- **Arguing with GAPs** — explaining to the validator what it should have
  inferred. Fix: the GAP is the finding; edit the artifact.
- **Ship after one pass** — fixing gaps without re-validating. Fix:
  re-run; the second pass is where fix-introduced contradictions surface.
