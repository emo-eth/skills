---
date: 2026-08-13
topic: skills-repo-philosophy
status: draft
source_material: user word dump, 2026-08-13 session in the sieve-vibe worktree
---

# Repo vibe: the sieve

## Glossary

- **Sieve**: the working metaphor of this repo. Knowledge, options, and tasks are material poured through a stack of filters. Each filter removes some of what does not matter. What comes out the bottom is clear enough to act on.
- **Pass**: one run of the pile through one filter. A pass asks the same cheap question about every item, one item at a time: keep or drop, left or right, more or less important.
- **Gut call**: a fast decision made on intuition. In this repo a gut call is valid input. It is recorded, not second-guessed.
- **Crystallization**: the staged sharpening of a fuzzy idea into artifacts with edges: word dump, then vibe, then PRD, then spec, then plan, then tickets. Each stage adds edges to the picture.
- **Apparent atomicity**: the look a task has of being one indivisible unit when it is not. If a task cannot close until someone verifies it, it is at least two tasks: implement and verify.
- **Verify tail**: the hidden prove-it work inside an apparently atomic task.
- **Proof needed**: existing repo term (lc-ticketize, standup): the observable check that closes a ticket.
- **Taste signal**: a recorded gut call, such as one pairwise comparison or one keep/drop decision, that can be distilled into `docs/taste.md` so future agents inherit the user's judgment.
- **Turn receipt**: the fixed short block at the end of every agent turn: what happened, what the agent needs, open questions, what is next. The only part of a turn the user must read.
- **Yearn**: a note about a skill written at the moment of use: what you wished it did, what felt off. The skill-level sibling of a papercut.
- **Papercut**: existing repo term: a small tool or workflow friction logged in the moment it happens.
- **Top-k**: picking the best k items out of a pile without ordering the whole pile.

## Vibe Promise

Working with the tools and skills in this repo should feel like sifting: you pour in a fuzzy pile - ideas, tickets, options, feedback - and run it through cheap filters, one gut call at a time, until what remains is sharp enough to act on. The user's attention is the scarcest resource in the system. A tool succeeds when one pass costs minutes and its output can be trusted; it fails when it demands analysis up front, when it makes the user hold two decisions in their head at once, or when it lets work look done before it is proven.

## Ideal Reality Dump

User language from the 2026-08-13 session, kept verbatim where it carries taste:

- "i need to treat knowledge and understanding and tasks and prioritization almost like a sieve/sifter"
- "binary-search-towards-clarity (don't over index on the binary aspect)"
- "filter and refine things through very simple categorization, and maybe importantly, gut intuition"
- "if a ticket can't be closed until it's verified, it should have (at least) two sub-tasks: implement, and verify. only then can the task (which maybe appeared outwardly atomic) be considered completed"
- "going from vibe -> prd -> spec -> plan - that's a deliberate coalescing and crystallization of thoughts"
- "plannotator also helps this crystallization - it helps give edges to the fuzzy pictures in my head"
- "i wish there were some way for agents to learn my thinking process and develop their own intuition around my own intuition based on those iterations"
- "we might need a tighter loop; that might mean faster models or using wallclock to time iterations"
- "it ends each turn with a summary of the turn and hides the rest of the turn above the fold"
- "a lightweight model summarize every turn and emphasize questions and action items as the final section"
- "part of this is figuring out how to make word dumps like this actionable and useful"

## Use Circumstances

- Triaging a large pile (tickets, skills, options) in one sitting, fast, with interruptions likely.
- Reading agent output while distracted. Most turns, only the receipt gets read.
- Iterating on a skill inside a single session, where the loop must fit the sitting.
- Receiving an unstructured word dump and needing it to become actionable without heavy process.
- Running parallel agents across worktrees, where decisions must survive context death.

## Vibe Clauses

### V1. Filter beats analyze

- Promise: tools reduce a pile through successive cheap passes. Each pass asks one question per item and accepts a gut call as the answer.
- Means: one item on screen at a time; one keypress per decision; state saved after every decision so a pass survives interruption; asking for the top few, never the total order. Existing embodiments: `tools/prioritize-linear-tickets.ts` (pairwise top-k, binary insertion into a frontier, about two comparisons to bin one ticket), `decision-wizard` (keep/drop cards), the `--bin` triage mode.
- Does not mean: literally binary search. The binary part is the cheapness of each comparison, not the algorithm. It also does not mean shallow: passes stack until the material is clear enough to act on.
- Violation: a tool that demands a full ranking of every item, a form with ten fields per item, or an analysis document before any item may be eliminated.
- Check: the user can clear a 50-item pile in minutes, one decision at a time, and resume mid-pile after an interruption.

### V2. Clarity arrives in stages, on purpose

- Promise: fuzzy thought becomes sharp through deliberate stages (dump, vibe, PRD, spec, plan, tickets). Each stage is allowed to be exactly as fuzzy as that stage permits: no sharper demanded early, no fuzzier tolerated downstream.
- Means: lc-north-star's artifact chain. Plannotator as the device that gives edges to fuzzy pictures by making them annotatable. lc-review-capture so every sharpening round is recorded.
- Does not mean: bureaucracy for small work. lc-north-star already skips the chain for bounded fixes. It also does not mean stalling a session to force artifacts the work does not need.
- Violation: demanding acceptance criteria during a vibe dump; writing code from an unsettled vibe when behavior is undecided; a word dump that ends the session as lost chat.
- Check: a word dump from the user ends its session as a distilled artifact under review, or as an explicit no-artifact exploration outcome. Never as transcript only.

### V3. No task is atomic until proven

- Promise: apparently atomic tasks are suspect. The default decomposition is implement plus verify, and nothing counts as done without its named proof.
- Means: lc-ticketize's proof needed on every ticket; its rule that a merge does not close a parent whose proof needs live behavior; the readiness ladder that keeps declared rows from masquerading as verified; branch-closure's hunt for unfinished proof.
- Does not mean: splitting tasks forever. A task closes when its named proof passes, not at a fixed subtask count. It also does not mean the verify step is always a separate ticket; it means the verify work is always named.
- Violation: a ticket that reads "add X" with no proof needed; closing work because it compiled, or because the happy path was clicked once in dev.
- Check: pick any closed ticket at random. It names the evidence that closed it.

### V4. The user's judgment is recorded and inherited

- Promise: every sieve pass and every review round produces decision data, and that data is distilled into durable taste (`docs/taste.md`, `docs/DECISIONS.md`, agent memory) so future agents make the call the user would have made.
- Means: comparison logs from prioritize runs, keep/drop outcomes from decision-wizard runs, plannotator rounds distilled by lc-review-capture. The record is the training signal for intuition transfer.
- Does not mean: interrupting a pass to ask why. Recording happens at capture points, silently. It also does not mean the agent imitates the user on novel decisions: known patterns are inherited, novel ones still go to the user.
- Violation: a 200-comparison ranking whose results vanish into a tool's state file; a review round whose decisions were applied but never distilled.
- Check: after any ranking or review session, the distilled lessons exist in a place agents read by default, not only in the tool's state.

### V5. Loops are short enough to stay in

- Promise: iteration loops (skill-iteration, triage passes, review rounds) are sized and timed so the user finishes them in one sitting. A loop that is too slow gets redesigned, not endured.
- Means: wall-clock to time iterations so their real cost is known; fast models for the mechanical steps inside a loop; friction logged live (papercut, yearn) instead of remembered.
- Does not mean: rushing verification to keep the loop short. The verify tail keeps its own time (V3). It also does not mean every loop needs a deadline; it means every loop's duration is measured and known.
- Violation: a skill-iteration cycle that spans days because each pass costs an hour of setup; a review tool that loses state when interrupted.
- Check: one full skill iteration (run the skill, log friction, prune, report the diff) fits in one timed session, and the elapsed time is recorded.

### V6. Friction and wishes are logged in the moment

- Promise: when a tool or skill annoys or falls short, the note is captured at the moment of use, with its context, never reconstructed later from memory.
- Means: papercut for tool friction; yearn for skill-level wishes: what the skill was, what you wished it did, with datetime, session, worktree, and project attached.
- Does not mean: stopping the work to write the perfect note. One or two raw sentences is the whole format. It also does not mean every note gets fixed; logging and fixing are separate passes.
- Violation: "I should remember to fix that skill" said in chat and lost; friction reconstructed in a weekly retro that half-remembers what hurt.
- Check: the logs show entries written mid-task, timestamped, naming the tool or skill, one or two sentences each.

### V7. Every turn ends with a receipt

- Promise: every agent turn ends in a fixed, short block: what happened, what the agent needs from the user, open questions, what happens next. The user can read only that block and lose nothing.
- Means: a standing instruction in the files every agent reads; later, a pi/omp extension that builds the receipt with a cheap model on turn end, so the main model spends no effort on it and the block sits at the bottom of the screen where the eyes already are.
- Does not mean: hiding detail the user asked for. The receipt is the default ending, not a cap on what a turn may contain. Long turns still carry their full content above it.
- Violation: a turn that trails off in prose, buries its question in paragraph four, or scatters action items through the transcript.
- Check: pick any turn at random. The last screen alone answers: what happened, what do you need from me, what is next.

## Anti-Vibes

| Anti-vibe | Why it violates the contract | Clause |
| --- | --- | --- |
| Form-driven tooling: many fields per item, analysis up front | Spends the scarcest resource (user attention) on data entry instead of decisions | V1 |
| Total-order ranking when top-k would do | Burns gut calls on items that will never matter | V1 |
| Word dumps that evaporate in chat | The raw material of every future contract is lost | V2 |
| Precision demanded before the stage needs it | Forced early crystallization produces fake certainty | V2 |
| "Add X" tickets with no proof needed | Hides the verify tail; work looks done before it is | V3 |
| Done claims without evidence | A declaration grading itself as verified | V3 |
| Review decisions that live only in the transcript | The user's intuition never becomes inheritable | V4 |
| Loops too slow to finish in one sitting | Unmeasured, slow loops get abandoned; skills accumulate sediment | V5 |
| "Remind me to fix that later" | Friction logged nowhere is friction kept forever | V6 |
| Walls of text with the question buried somewhere inside | The user cannot find what the agent needs from them | V7 |

## Approval

- Approved by: pending
- Approved on: pending
- Amendment rule: this vibe changes only by explicit user request or direct user edit.
