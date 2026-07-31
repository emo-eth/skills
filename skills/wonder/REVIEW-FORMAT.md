# REVIEW.md Format

`REVIEW.md` lives at the root of a teach workspace. It is the spaced-retrieval ledger: every card is one self-contained question, scheduled by Leitner box.

## Template

```md
# Review Ledger

Streak: 3 (last session: 2026-07-30)

<!-- Boxes: 1=1d 2=3d 3=7d 4=14d 5=30d. Correct → up one box; wrong → box 1.
     due = last review + interval for the card's box. New cards: box 1, due today.
     Box-5 card answered correctly → retire (strikethrough the row, keep it). -->

| # | concept | prompt | source | box | due | last |
|---|---------|--------|--------|-----|-----|------|
| 1 | tool definition vs execution | Who owns what the model may request, and who owns what actually runs? | 0001 | 2 | 2026-08-02 | 2026-07-30 |
| 2 | fork spawn semantics | A forked subagent "shares" the parent's context — what is the precise correction? | 0012 | 1 | 2026-07-31 | 2026-07-30 |
```

## Rules

- **Cards are questions, not topics.** "Sessions" is not a card; "What does resume restore that a fresh start doesn't?" is. The prompt must be answerable with the lesson closed.
- **`concept`** is a short stable slug used in session summaries ("missed: fork spawn semantics").
- **`source`** points at where the answer lives: a lesson number, a reference doc, or a resource. Enough to re-teach from.
- **`box`/`due`/`last`** drive scheduling. A card is due when `due` ≤ today. Never backdate; get today from `date +%Y-%m-%d`.
- **Ordering**: keep rows in card-creation order; `#` never changes or gets reused. Retired cards stay in place, struck through (`~~...~~` on every cell).
- **One table.** No per-lesson sections — the `source` column carries that, and one table keeps due-scanning trivial.
- Keep prompts under ~25 words. If a question needs a scenario longer than that, the scenario belongs in the session, generated fresh; the card holds the durable kernel.

## What earns a card

- A concept taught in a session's new-material block.
- A question the user got wrong or hollow anywhere (including explain-backs — distill the miss into a card).
- A key idea from a lesson the user has actually read (seeding a deck from existing lessons is fine; seed from their retrieval questions, made self-contained).

## What does not

- Material the user hasn't met yet (cards are review, not a syllabus).
- Duplicates of an existing card's kernel — sharpen the existing prompt instead.
- Trivia that doesn't serve the mission.
