---
date: 2026-08-13
topic: skills-repo-philosophy
status: draft
source_material: user word dump 2026-08-13 (sieve-vibe worktree), plus round-1 review corrections
---

# Repo vibe: progress through sifting

## Glossary

Definitions here describe, they do not prescribe. Where a term names a pattern, the pattern is one good shape, not a required formula.

- **Sieve**: the working metaphor of this repo: knowledge, options, and tasks as material poured through a stack of filters, where each filter removes some of what does not matter. It is a metaphor for a concept still being articulated, not an end goal and not a rule.
- **Pass**: one run of the pile through one filter. Often the same question applied to each item, one item at a time: keep or drop, left or right, more or less important.
- **Gut call**: a fast decision made on intuition. A valid input when appropriate, not the only acceptable kind of decision.
- **Crystallization**: the staged sharpening of a fuzzy idea into artifacts with edges. One common shape is word dump, vibe, PRD, spec, plan, tickets; the point is the sharpening, not the count or order of stages.
- **Apparent atomicity**: the look a task has of being one indivisible unit when it is not. Sometimes the hidden part is verification; sometimes it is a dependency on another task, or on downstream results of one. A deliverable with several sub-components can still rightly be a single ticket.
- **Verify tail**: the prove-it work that can hide inside an apparently atomic task. Not every task has one; the habit is to look, not to assume.
- **Proof needed**: existing repo term (lc-ticketize, standup): the observable check that closes a ticket.
- **Taste signal**: a recorded gut call, such as one pairwise comparison or one keep/drop decision, kept so that future agents might inherit the user's judgment. Whether the current mechanisms actually achieve that inheritance is unproven.
- **Turn summary**: a fixed short block at the end of an agent turn: what happened, what the agent needs, open questions, what is next.
- **Yearn**: an existing user-facing capture for anything the user yearns for; not specific to skills. A skill-scoped variant has been proposed but is a separate, not-yet-named thing; it is not yearn.
- **Papercut**: existing repo term: a small, likely-to-recur workflow friction with a concrete fix in code, configuration, documentation, an owned tool, or an agent process, logged when it happens.
- **Top-k**: picking the best k items out of a pile without ordering the whole pile. A sibling idea under exploration: tiered heaps, dropping items into a few coarse tiers instead of a precise order.

## Vibe Promise

Working with the tools and skills in this repo should both feel like and actually be making progress: fuzzy material - ideas, tickets, options, feedback - becomes sharp enough to act on. Sifting is the suspected mechanism: fast passes over the pile, gut calls when appropriate, broad strokes that can become successively finer. But sifting is what the user suspects works for them, not the goal. The goal is progress. A tool that makes the user sift without producing progress has failed, whatever it feels like.

The user's attention is the scarcest resource in the system. Everything here is built around that.

## Ideal Reality Dump

User language, kept verbatim where it carries taste. From the 2026-08-13 dump:

- "i need to treat knowledge and understanding and tasks and prioritization almost like a sieve/sifter"
- "binary-search-towards-clarity (don't over index on the binary aspect)"
- "filter and refine things through very simple categorization, and maybe importantly, gut intuition"
- "if a ticket can't be closed until it's verified, it should have (at least) two sub-tasks: implement, and verify. only then can the task (which maybe appeared outwardly atomic) be considered completed"
- "going from vibe -> prd -> spec -> plan - that's a deliberate coalescing and crystallization of thoughts"
- "plannotator also helps this crystallization - it helps give edges to the fuzzy pictures in my head"
- "i wish there were some way for agents to learn my thinking process and develop their own intuition around my own intuition based on those iterations"
- "we might need a tighter loop; that might mean faster models or using wallclock to time iterations"
- "part of this is figuring out how to make word dumps like this actionable and useful"

Added in round-1 review, same status:

- "raw information plus intuition plus iteration leads to clarity leads to understanding"
- "interruptions cost as little as possible; i can continue sifting with minimal context loss"
- "working with the tools and skills should both feel like and crucially ACTUALLY BE making progress... sifting is what i suspect works for me"

Agent-communication preferences from the same dump (deliberately filed under the companion clause, not the sifting clauses):

- "it ends each turn with a summary of the turn and hides the rest of the turn above the fold"
- "a lightweight model summarize every turn and emphasize questions and action items as the final section"

## Use Circumstances

- Triaging a large pile (tickets, skills, options) in one sitting, fast.
- Working with ADHD: ideally in uninterrupted blocks; in practice interruptions happen, so what matters is that an interruption costs as little as possible and sifting resumes with minimal context loss.
- Reading agent output while distracted. Most turns, only the summary gets read.
- Iterating on a skill inside a single sitting.
- Receiving an unstructured word dump and needing it to become actionable without heavy process.
- Running parallel agents across worktrees, where decisions must survive context death.

## Vibe Clauses

One caveat applies to every example below: the tools and skills named are seeds and context - works in progress, some of which should be scrapped. Nothing is load-bearing merely because it already exists; each is downstream of this vibe and subject to rewrite as the vibe iterates.

### V1. Progress you can feel

- Promise: working with a tool here moves the pile toward action, and the user can feel it moving. Anything that produces motion without progress is a failure, however busy it looks.
- Example: sifting is the mechanism currently under test - fast passes where each decision is easy, gut calls accepted when appropriate, broad strokes first that can become successively finer. Existing shapes: `tools/prioritize-linear-tickets.ts` (pairwise top-k, about two comparisons to bin one ticket), `decision-wizard` (keep/drop cards), the `--bin` triage mode. These are examples, not formulas.
- Does not mean: every decision must be a gut call, or that sifting is the only legitimate way to make progress.
- Violation: a tool that demands a total ordering of a pile when only the best few will ever matter; a tool whose output leaves the user no closer to acting than when they started.
- Check: after one sitting with a tool, the user can name what moved: what got decided, eliminated, or sharpened.

### V2. Clarity arrives in a few stages

- Promise: fuzzy thought sharpens in stages, and the number of stages stays small and deliberate: three is ideal, four or five in practice, settled by iterating rather than by rule. The whole pipeline should be as painless and fast as possible while still being productive.
- Example: the lc-north-star chain (dump, vibe, PRD, spec, plan, tickets) is one current shape - a facet of this system, not a source of truth. It will be updated or replaced as this vibe iterates; this vibe is the source of truth. Plannotator gives edges to fuzzy pictures by making them annotatable. lc-review-capture records each sharpening round. Review rounds are bounded: a doc gets at most two fix rounds, and the goal is one.
- Does not mean: bureaucracy for small work (hugely important: bounded fixes skip the chain). It also does not mean stalling a session to force artifacts the work does not need.
- Violation: demanding acceptance criteria during a vibe dump; writing code from an unsettled vibe when behavior is undecided; a word dump that evaporates as lost chat. (Recovery systems for lost chat - session-history search such as memex - are wanted but unspec'd; see open questions.)
- Check: a word dump ends its session as a distilled artifact under review, or as an explicit no-artifact exploration outcome.

### V3. Deliverables get broken down

- Promise: work is decomposed far enough that nothing closes while part of it is still hiding. The historical failure is not any one missing step; it is deliverables that were never broken down at all.
- Example: a task that cannot close until it is verified carries at least an implement part and a verify part, whether or not they are separate tickets. Some tasks are really dependencies: "score opus 5" is downstream of "create a model eval framework". That framework is one deliverable ticket, and its components are sub-tickets that must also be tracked and enumerated. lc-ticketize's proof needed is one mechanism (not yet proven in use, and itself downstream of this vibe).
- Does not mean: an implement/verify dichotomy imposed on every task, or splitting for its own sake. The verify work is named; whether it is a separate ticket is a judgment call.
- Violation: a ticket that reads "add X" with no way to tell when it is done; a deliverable closed while a sub-component everyone knows about is still unbuilt.
- Check: pick any closed ticket at random. What closed it is visible - evidence, or a named judgment call.

### V4. Never delegate understanding

- Promise: understanding is symbiotic. The user strives for understanding; the system strives to measure and ensure it, and the system has failed if it cannot guide the user there. Once the user has full understanding, the user guides the system. Raw information plus intuition plus iteration leads to clarity leads to understanding - and the compounding must happen in the user's head, never delegated away.
- Example: a system that probes the user's understanding (teach-back, spot questions) and gives the user a way to measure it. This sits somewhat outside sifting, but is core to the broad system. Skills like `understand` and `synthesize` are seeds in this direction, not fixtures. lc-ticketize only tickets what is already understood, and refuses to ticket vibes.
- Does not mean: agents stop doing legwork, or the user re-reads every primary source. Legwork is delegated; understanding is not.
- Violation: a tool that hands back a conclusion with no way to see how it got there; a workflow where the agent's model of the problem silently replaces the user's.
- Check: the system has a way to probe the user's understanding, and the user has a way to measure it. After using a tool, the user can say why its output is right, not only that it is right.

### V5. Judgment is recorded so it can be inherited

- Promise: when the user makes calls - in sieve passes, in review rounds - the record survives, so that future agents can learn to make the call the user would have made.
- Example: `docs/taste.md`, `docs/DECISIONS.md`, and agent memory are the current candidate mechanisms; whether they actually transmit judgment is unproven, and multi-person repos may need a different shape (possibly a skill or plugin). Comparison logs from prioritize runs and keep/drop outcomes from decision-wizard runs are candidate inputs. Distillations are worth sanity-checking with fresh eyes or a second agent from a different model family. An agnostic migration path between mechanisms matters eventually; it is noted here on purpose, while remaining out of scope for this vibe.
- Does not mean: every review round produces a distillation; many rounds are just fixes. And recording never interrupts a pass to ask why.
- Violation: a 200-comparison ranking whose results vanish into a tool's state file; a decision that changed a doc but left no trace anywhere an agent would look.
- Check: after a ranking or review session, whatever the user decided exists somewhere durable, in their words.

### V6. Loops are short enough to stay in

- Promise: iteration loops (skill-iteration, triage passes, review rounds) fit inside one sitting. A loop that is too slow gets redesigned, not endured.
- Example: wall-clock can time an iteration so its real cost is a number rather than a feeling; fast models can take the mechanical steps inside a loop. Recording how long loops take over time - to see whether changes actually help - is attractive but noisy, and not yet in scope.
- Does not mean: rushing verification to keep a loop short (V3 keeps its own time), or putting a deadline on every activity.
- Violation: a skill-iteration cycle that spans days because each pass costs an hour of setup; a review tool that loses state when interrupted.
- Check: one full skill iteration - run it, log friction, prune, report the diff - fits in one timed sitting, and the elapsed time is known.

### V7. Actionable friction and wishes are logged in the moment

- Promise: when a tool or skill friction is likely to affect another agent or future session and points to a concrete change in a system we control, the note is captured at the moment of use with its context and proposed action. It is never reconstructed later from memory.
- Example: papercut captures actionable tool friction. Yearn exists for anything the user yearns for; it is human-facing and general. A papercut-style logger scoped to skill invocations has been proposed as a separate tool with its own name (undecided; it is not yearn). Such notes feed skill-iteration, the existing improvement loop.
- Does not mean: logging every annoyance. A third-party command's unusual output or exit code is not a papercut unless our documentation, wrapper, or automation depends on it and needs a specific change. One or two sentences with the action is the whole format.
- Violation: a concrete setup-document fix is mentioned in chat and lost; or a harmless third-party quirk is logged without any action that the user or agent can take.
- Check: each papercut was written during the task, names the changeable component and proposed action, and is likely to help another agent or future session.

## Companion clause: every turn ends with a summary

This one is an agent-communication preference, not part of the sifting strategy. It is recorded here because it governs every agent working in this repo, and the user wants it held: "this is my overall vibe for interacting with the agent but i fear this is separate from the sifting strategy. but i do want this."

- Promise: every agent turn ends in a fixed, short block: what happened, what the agent needs from the user, open questions, what happens next. The user can read only that block and lose nothing.
- Example: a standing instruction in the files every agent reads is one candidate mechanism; a pi/omp extension that builds the summary with a fast model at turn end is another. The mechanism is undecided; the feel is not.
- Does not mean: hiding detail the user asked for. The summary is the default ending, not a cap on what a turn may contain.
- Violation: a turn that trails off in prose, buries its question in paragraph four, or scatters action items through the transcript.
- Check: pick any turn at random. The last screen alone answers: what happened, what do you need from me, what is next.

## Anti-Vibes

| Anti-vibe | Why it violates the contract | Clause |
| --- | --- | --- |
| Motion without progress: busy tooling that leaves the pile unmoved | The goal is progress; sifting is only the suspected mechanism | V1 |
| Total-order ranking when top-k would do | Burns gut calls on items that will never matter | V1 |
| Word dumps that evaporate in chat | The raw material of every future contract is lost | V2 |
| Stage sprawl: twenty stages where three would do | More process is not more clarity; the pipeline must stay painless | V2 |
| "Add X" tickets with no way to tell they are done | Hides unbuilt work behind a closed status | V3 |
| Conclusions without provenance | If the user cannot see how an answer was reached, understanding was delegated | V4 |
| Decisions that live only in the transcript | The user's judgment never becomes inheritable | V5 |
| Loops too slow to finish in one sitting | Unmeasured, slow loops get abandoned; skills accumulate sediment | V6 |
| "Remind me to fix that later" | Friction logged nowhere is friction kept forever | V7 |
| Walls of text with the question buried somewhere inside | The user cannot find what the agent needs from them | Summary |

## Approval

- Approved by: pending
- Approved on: pending
- Review status: three rounds applied (36 + 8 + 1 items); rounds closed at the user's direction under the two-round bound [D34]. No further re-review will be requested; the user edits directly when something is wrong.
- Provisional: D35 (ticketize's refusal to ticket vibes) stands but the user is unsure; revisited when lc-ticketize is revised.
- Amendment rule: this vibe changes only by explicit user request or direct user edit.
