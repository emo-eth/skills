# vibe.md round 1 - answers (2026-08-13)

Round: 36 items on `docs/vibe.md`, via Plannotator folder session. Numbering is
the human's. Raw snapshot: `.context/review/2026-08-13-vibe-round-1.md`.
Every item below says what changed and where. Open items are collected at the
end.

## Item-by-item

1. **"do not be prescriptive in definitions"** - Glossary now opens with
   "Definitions here describe, they do not prescribe"; the crystallization
   definition presents the chain as one common shape, not a fixed sequence.
   Recorded as D20. Landed: vibe.md Glossary.
2. **Implement/verify nuance (dependencies, sub-components in one ticket)** -
   "Apparent atomicity" rewritten to name dependencies and downstream results,
   and to say a multi-component deliverable can rightly be one ticket. V3 was
   rebuilt around this. Recorded as D26. Landed: Glossary, V3.
3. **Verify tail "not always necessary"** - Definition now reads "the habit is
   to look, not to assume." V3's does-not-mean says the split is a judgment
   call. Landed: Glossary, V3.
4. **taste.md inheritance unproven; multi-person repos; maybe a skill or
   plugin** - "Taste signal" now says the inheritance is unproven. V5 lists the
   current mechanisms as candidates, flags multi-person weirdness, and names
   the skill-or-plugin possibility. Landed: Glossary, V5.
5. **yearn exists and is general; the skill-specific thing is not yearn** -
   Agreed; my draft misnamed it. Glossary now defines yearn correctly (existing,
   human-facing, any wish) and the proposed skill-scoped logger is described as
   separate and unnamed. Recorded as D24. Landed: Glossary, V7. Naming is an
   open item below.
6. **"we also have /skill-iteration"** - V7 now names skill-iteration as the
   improvement loop such notes feed. Landed: V7.
7. **tiered heaps** - Top-k definition now notes tiered heaps as a sibling idea
   under exploration. Landed: Glossary.
8. **The goal is progress; sifting is the suspected mechanism** - The Vibe
   Promise was rewritten around this, adopting your sentence: tools should both
   feel like and actually be making progress; sifting is "what the user
   suspects works for them, not the goal." V1 is now "Progress you can feel."
   Recorded as D21. Landed: Promise, V1.
9. **gut calls "not always, only when appropriate"** - Promise, glossary, and
   V1 all now say "when appropriate." Landed: Promise, Glossary, V1.
10. **"should make things sharp enough to act on"** - Adopted into the Promise
    nearly verbatim. Landed: Promise.
11. **"need is a strong word"** - The line stays in the Ideal Reality Dump
    verbatim (that section is a verbatim record of source material by design),
    and nothing else in the doc legislates from it; the Promise no longer
    paraphrases it as a rule. Folded into D20's pattern. Landed: Dump, Promise.
12. **turn-summary quote is a communication preference, not sifting** - Both
    quotes moved to a labeled "agent-communication preferences" group in the
    Dump, and the receipt clause is now a companion clause outside V1-V7.
    Recorded as D23. Landed: Dump, Companion clause.
13. **same as 12** - Same landing.
14. **interruptions: minimal context loss is the real preference** - Use
    Circumstances rewritten: uninterrupted blocks are the ideal, near-zero
    interruption cost is the requirement. Recorded as D25. Landed: Use
    Circumstances.
15. **never delegate understanding; "raw information plus intuition plus
    iteration leads to clarity leads to understanding"** - Written down: new
    clause V4 ("Never delegate understanding"), and the sentence was added to
    the Dump. Recorded as D22. Landed: V4, Dump.
16. **pass formula too prescriptive; "an example, not a formula"** - V1's
    mechanics moved under "Example:" with the explicit line "These are
    examples, not formulas." Recorded as D20. Landed: V1.
17. **Means -> Example** - Every clause field "Means:" renamed to "Example:".
    Landed: all clauses.
18. **broad strokes, successively finer** - Added to the Promise and V1's
    example. Landed: Promise, V1.
19. **"analysis document before any item may be eliminated" - what makes you
    say this?** - Honest answer: it was aimed at heavyweight up-front triage
    processes, but written as a rule it is exactly the prescriptiveness you
    flagged. Removed; V1's violations now carry only the total-order and
    no-progress versions. Landed: V1.
20. **stage count: 3 ideal, 4-5 in practice, iterate; painless and fast while
    productive** - V2 rewritten around this, nearly in your words. Recorded as
    D29. Landed: V2.
21. **upper bound on number of reviews** - V2 now states review rounds are
    bounded so a doc cannot loop forever. The actual bound is mechanism work,
    not vibe; noted for implementation. Landed: V2.
22. **"no bureaucracy for small work" hugely important** - Kept and marked as
    such in V2's does-not-mean. Landed: V2.
23. **no stalling sessions for unneeded artifacts** - Kept in V2's
    does-not-mean. Landed: V2.
24. **lost-chat recovery systems; memex unspec'd** - V2's violation softened
    and annotated "wanted but unspec'd." Recorded as deferred decision D27
    with a revisit trigger. Landed: V2, DECISIONS.md.
25. **don't over-index on task-verify; the bigger problem is unbroken
    deliverables** - V3 retitled "Deliverables get broken down" and reframed
    around decomposition, with implement/verify as one example pattern.
    Recorded as D26. Landed: V3.
26. **lc-ticketize unproven in use; standup overlap unknown** - V3's example
    now flags lc-ticketize as "not yet proven in use." The overlap question is
    real and agent-answerable; routed to open items below. Landed: V3.
27. **taste mechanisms too prescriptive; migration path wanted but not part of
    the vibe** - V5 now says exactly that: mechanisms are candidates, an
    agnostic migration path matters eventually but is out of scope for the
    vibe. Landed: V5.
28. **no prescriptive Means** - See 17. All "Means:" are now "Example:".
    Landed: all clauses.
29. **sanity-check distillations with fresh eyes or a different model family** -
    Added to V5's example. Landed: V5.
30. **not every review round has distillations** - V5's does-not-mean now says
    so, and the violation was reworded: the failure is a decision leaving no
    trace, not a round producing no principle. Landed: V5.
31. **record loop durations; noisy signal; not necessarily in scope** - V6's
    example mentions duration-recording as attractive but noisy and not yet in
    scope. Recorded as deferred decision D28. Landed: V6, DECISIONS.md.
32. **yearn is for humans; "or is this the new thing you misnamed?"** - Yes,
    the draft misnamed it. Corrected; see item 5. Landed: Glossary, V7.
33. **skill-yearn should have a better name; your confusion noted** - The
    confusion was caused by my misnaming, and your item-5/item-30 comments
    stand as corrected by it. The logger is now described as unnamed; picking
    the name is an open item below. Landed: V7.
34. **receipt is separate from sifting but wanted** - The receipt is now a
    "Companion clause" section that quotes your scoping sentence and keeps the
    commitment. Recorded as D23. Landed: Companion clause.
35. **"Means: careful"** - The receipt clause uses "Example:" and explicitly
    says the mechanism is undecided while the feel is not. Landed: Companion
    clause.
36. **cheap -> fast** - "Fast model" and "fast passes" throughout; no "cheap"
    remains. Landed: Promise, V1, V6, Companion clause.

## Still needs you

1. **Name for the skill-scoped logger.** It is not "yearn" (taken, general,
   human-facing). Candidates: `hone`, `skill-notes`, `sandpaper`. Your call -
   or propose one.
2. **Receipt placement.** It now lives as a companion clause inside vibe.md,
   visibly separate from the sifting clauses. Alternative: its own small
   interaction-vibe file later. Keep here or split?
3. **lc-ticketize vs standup overlap audit.** You flagged you have not used
   lc-ticketize and suspect overlap with the standup skills. Agent-answerable:
   say the word and I will map which skill owns what and where they collide.
4. **Round 2 check.** The prescriptiveness purge touched every clause
   (D20). Re-review vibe.md in the same folder session
   (http://localhost:64981) - the bundle copy is refreshed, and diff view
   against round 1 should work since the filename is unchanged.
