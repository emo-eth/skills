---
name: skill-iteration
description: "Trial-run a not-yet-trusted skill on a real task, logging friction as you go, then fold validated friction back into the skill. Use when a skill is new or unproven and you want to try it for real while capturing what to improve."
argument-hint: "[skill to iterate on] [real task to run it on]"
disable-model-invocation: true
---

The failure this defends against: running a new skill without watching it, so the only feedback loop is "did the output look fine," and every rough edge it hit along the way goes unrecorded and unfixed.

Boundary: this skill is the field test — does the skill survive a real task under load? For the cheaper pre-flight — does the skill's *text* survive a cold reader — run `fresh-eyes` first. A skill that hasn't passed fresh-eyes isn't worth the field test yet.

## 1. Open an iteration log

Before the target skill's first step runs, start a scratch note for friction. Nothing goes in it yet — it just has to exist before work begins, so friction gets logged live instead of reconstructed from memory afterward.

Completion: the log exists before the target skill's step 1 starts.

## 2. Run the target skill for real

Apply it to the actual task at hand, not a toy example — this only tells you the truth under real load. At every step, if the skill's instruction was unclear, wrong for this case, missing something you needed, or you deviated from what it literally says, log it the moment it happens, raw: what the skill said, what you actually did, why. Don't wait for a wrap-up pass; friction fades and gets rationalized within a few steps.

Completion: every deviation from the target skill's written instructions during this run is in the log before you move to the next step.

## 3. Finish the task before touching the skill

Don't stop mid-task to fix the skill. The log accumulates across the whole run; edits only happen after the real task is done, so they're informed by a complete pass, not a partial one.

Completion: the real task is complete before any edit to the target skill begins.

## 4. Separate signal from noise

Go through the log entry by entry. Keep friction that would hit any user landing on this step; drop anything that was a one-off fluke of this particular task. Mark each entry keep or drop, with the reason — this is the same evidence-tiering discipline as raw-first synthesis, aimed at your own notes instead of someone else's research.

Completion: every log entry has a keep/drop mark and a stated reason.

## 5. Edit the skill, pruned, not appended

Take each "keep" item through `writing-great-skills`' pruning checks — relevance, no-op, single source of truth — before writing it in. Ask whether it deserves its own step, belongs folded into an existing one, or should be pushed to disclosed reference, rather than defaulting to tacking a new paragraph onto the end. Repeated iterations that only append are how skills accumulate sediment.

Completion: the skill file changes only where a kept item required it, and each change passed the pruning checks before being written.

## 6. Report the diff

Tell the user what changed and why, one line per edit, each tied to the specific friction that caused it.

Completion: every edit made in step 5 is accounted for in the report.
