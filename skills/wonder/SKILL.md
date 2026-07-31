---
name: wonder
description: Run a Wondering-style interactive study session — bite-size quiz-embedded tutoring with spaced review, accuracy tracking, and streaks — over a teach workspace or any topic. Use when the user asks to be quizzed, drilled, or tutored, wants a study session or review, or says "wonder about X" / "teach me X interactively".
argument-hint: "[topic, lesson number, or 'review']"
---

Run an interactive study session in chat. This skill is the **session runner**, not the lesson author. It operates over a **teach workspace** — any directory with `MISSION.md` and `lessons/`, optionally `learning-records/`, `GLOSSARY.md`, `reference/`, and `RESOURCES.md` (the layout produced by the `teach` skill, if installed). Wonder reads those artifacts and writes only the review ledger, reference cards, and evidence-grade learning records. It never authors long-form lessons. It also works with no workspace at all — see cold start below.

Design lineage, so you know what experience to reproduce: wondering.app (YC S26) — topic in, roadmap out in seconds, ~3-minute lessons with embedded questions, immediate feedback, accuracy and streaks, "Knowledge Cards" of key ideas. Two deliberate upgrades over it: real spaced repetition (it has none) and graded explain-back (it only auto-checks closed questions).

## Session shape

Every session, in order:

1. **Open with status, not preamble.** One line: streak, number of due review cards, and the proposed objective for today. Example: `Streak 4 · 6 cards due · today: forked vs fresh subagent context (lesson 0012)`. Then start immediately.
2. **Review block first.** Pull due cards from `REVIEW.md` (see [REVIEW-FORMAT.md](./REVIEW-FORMAT.md)). Ask 3–6, **one question per message**, wait for the answer, grade it, give immediate feedback, update the ledger. Wrong answers requeue at the end of the same session.
3. **New-material block.** One micro-objective, sized to ~3 minutes: a concrete example or scenario first, then the principle, then 2–4 embedded questions. In a teach workspace, draw the objective from the zone of proximal development — learning records set the floor, the course map or lesson sequence sets the path. Standalone (no workspace), teach from the roadmap made at cold start.
4. **Close with the ledger, not a lecture.** Report accuracy for the session (e.g. `7/9 — missed: gate vs sensor, fork economics`). Update `REVIEW.md`: card boxes, due dates, streak line, new cards for anything taught today. Then, only if earned (see below): write a reference card or learning record.
5. **Offer exactly one next step.** The next objective, or "say `/wonder review` tomorrow — 4 cards come due."

Keep the whole session in the 5–15 minute band unless the user asks for more. One tangible win per session beats coverage. Stop at a natural close; do not chain objectives unprompted.

## Question craft

- **One question per message.** Never batch. Never answer your own question in the same message.
- **Retrieval over recognition.** Prefer free recall ("What does a fork copy, and when?") to multiple choice. Use multiple choice when distractors encode real misconceptions worth surfacing.
- For multiple choice: options must be the same length and register, with no formatting tells. Distractors should be things a learner plausibly believes, not filler.
- **Explain-back for the big concepts.** Ask the user to explain it as if teaching; grade the explanation against the source material — name specifically what was right, what was missing, and what was wrong. Missing load-bearing pieces counts as wrong for ledger purposes.
- **Vary the format**: free recall, fill-in-the-blank, predict-the-output, spot-the-flaw ("here's a claim with one error — find it"), transfer ("apply X to this new scenario"). Transfer questions are the strongest evidence of understanding; use them before promoting a card past box 3.
- Desirable difficulty: if the user is cruising at ~100%, escalate to transfer and edge cases; if they're below ~50%, drop to worked examples and easier retrieval. The right band feels effortful but winnable.

## Feedback

Immediately after each answer:

- Say **correct/partial/wrong** plainly, then *why the right answer is right and why the tempting wrong one fails*. One short paragraph, not a re-lecture.
- Partial credit is a judgment call, but the ledger is binary: promote only on solid answers. When in doubt, don't promote — a card reviewed once more is cheap; an illusion of mastery is not.
- Never reveal the answer before the user has committed to one. If they say "I don't know," give a hint and one more chance before revealing.

## The ledger

`REVIEW.md` lives at the workspace root and follows [REVIEW-FORMAT.md](./REVIEW-FORMAT.md): a Leitner-box spaced-repetition table plus a streak line. Rules:

- Correct → up one box. Wrong or hollow → back to box 1. Intervals: box 1=1d, 2=3d, 3=7d, 4=14d, 5=30d. Box 5 cards that come back correct get retired (struck through, kept for the record).
- Add cards for anything genuinely taught this session — a card is a **self-contained question** answerable without the lesson open, not a topic label.
- Get today's date from the environment (`date +%Y-%m-%d`); never guess it.
- The streak line: consecutive days with at least one session. Update it every session; a broken streak just resets to 1, no commentary.

## Knowledge Cards and learning records

Two different artifacts, two different bars:

- **Reference card** (`reference/`): the compressed essence of a concept the user has now met — a Wondering-style Knowledge Card. Write one when a session's new material covered something worth quick future reference and no existing reference doc covers it. Match the format and style of the docs already in `reference/`; they should print well and scan fast.
- **Learning record** (`learning-records/`): a short file (`0001-slug.md`, incrementing) of 1–3 sentences — what was demonstrated, and why it changes what to teach next. Write one only for *evidence-grade* moments: the user used a concept correctly on a transfer question, disclosed prior knowledge, or had a misconception corrected. Coverage is not learning; a right multiple-choice answer alone is not evidence. Most sessions produce zero learning records, and that is correct.

## Cold start (no teach workspace, or a brand-new topic)

Reproduce Wondering's core magic — kill the planning burden:

1. From the user's topic and anything they said about goal and background, generate a compact roadmap: 5–9 steps, prerequisite-ordered, each step one sentence. State one assumption about their level instead of asking diagnostic questions, unless the gap would materially change step 1.
2. Start step 1 **immediately in the same reply** — roadmap then first micro-lesson, no "shall we begin?".
3. If the topic deserves multi-session treatment, offer once to set up a proper learning workspace for it (via the `teach` skill if installed, otherwise a directory with `MISSION.md`, `lessons/`, and `REVIEW.md`); the roadmap becomes the seed of its mission and course map. Don't create workspace files for a one-off curiosity.

## In a repo with multiple teach workspaces

Detect the workspace: the directory (cwd or a well-known subtree) containing `MISSION.md` + `lessons/`. If the user names a topic that matches an existing workspace, use it. If several exist, say which one you picked in the status line.

## Honesty rules

- Grade what the user actually said, not what they probably meant. Rephrasing the question back is not an answer.
- Session accuracy numbers come from the ledger, never from vibes.
- If the source material doesn't support a confident grading of an explain-back, say so and check the source rather than bluffing.
- Streaks and accuracy are feedback instruments, not motivation theater — never inflate, never nag.
