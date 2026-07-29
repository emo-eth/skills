---
name: fresh-eyes
description: Validate that a prose artifact — a skill, doc, plan, spec, STATE.md, onboarding guide — survives a cold reader, by spawning a clean-context agent given ONLY the artifact and quizzing it with scenario questions that require line citations or explicit GAP declarations. Use after writing or heavily editing any document meant to instruct a reader with zero prior context, before shipping or trusting it, or when the user asks to "cold-read this", "test this with a fresh agent", or "would a fresh agent understand this". Failures are the artifact's fault, never the reader's.
---

# Fresh Eyes

The failure this defends against: prose that only works when the author is
hovering nearby explaining it. An author reviewing their own text always
passes — they already know what it means, so the gaps are invisible to
them. The cheapest verification that exists for a prose artifact is a
reader with zero context and no way to ask questions.

When to use: after writing or heavily editing a skill, doc, plan, or spec
meant to instruct — before shipping or trusting it. Not for code (tests do
that job), not for trivial edits.

## The protocol

1. **Isolate.** Hand the validator ONLY the artifact plus an explicit
   short list of supporting files. Forbid reading anything else. This
   simulates a fresh install, not a fresh chat — if the validator answers
   from context the artifact doesn't contain, the test proves nothing.
2. **Write scenario questions, never review questions.** "X just happened
   — walk through exactly what you do, in order" forces the reader to
   traverse the actual text. "Does this look good?" invites a vibe-check,
   and vibe-checks always pass.
3. **Quote-or-GAP.** Every answer must cite the line it relied on, or
   declare `GAP:` plus what a fresh reader would get wrong there. This is
   the load-bearing constraint: an agent that can't cite a line is
   pointing at an ambiguity it would otherwise paper over with confident
   reasoning. Without it, you get reassurance instead of findings.
4. **Failures are the artifact's fault, never the reader's.** If the
   validator floundered, asked for context, or answered from the wrong
   section, the writing is ambiguous, missing, or contradictory there.
   Fix the text. Never argue with a GAP ("any reasonable agent would
   infer…") — the next reader won't.
5. **Fix and re-run until cold pass.** Re-validate after fixing: fixes
   routinely introduce NEW contradictions with untouched sections. One
   pass finds the gaps; the second pass finds what the fixes broke.

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

Scenario questions should cover the artifact's main flow end-to-end plus
its advertised edge cases — one question per claim you'd be embarrassed
to discover is unwritten.

## Boundary with skill-iteration

Fresh-eyes is the cheap pre-flight: does the artifact's TEXT survive a
cold reader? `skill-iteration` is the expensive field test: does the skill
survive a real task under load? Run fresh-eyes first — it catches
ambiguity and contradiction before you spend a real task discovering
them. A skill that passes fresh-eyes is ready to be trial-run; a skill
that hasn't passed it isn't worth the field test yet.

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
