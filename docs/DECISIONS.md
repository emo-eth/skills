# Decisions

One append-only log for the whole repo. D1-D16 are wall-clock scoped; D20 onward include the repo-philosophy (sieve vibe) round.

## Glossary

- **Decision**: A rule that changes future implementation behavior.
- **Load-bearing**: A decision that is expensive to reverse or affects several modules.

## D1 - 2026-08-05 - Store design outside skills

Decision: Keep wall-clock design, research, and experimental implementation outside `skills/` until the plugin is ready for skill distribution.
Why: The user asked to keep design and future-work documents separate and ensure they are not installed with skills.
Consequences: `npx skills` will not discover the proposal or plugin directories. Native OMP and Pi distribution will be added later.
Status: active
Scope: v0
Load-bearing: yes

## D2 - 2026-08-05 - Budgets are ceilings

Decision: An assignment budget is a maximum guardrail, not a target. A child should finish as soon as its acceptance target is met.
Why: "sessions should not strive to fill the allotted time; short tasks should not take longer; they should finish early whenever possible" - Plannotator annotation.
Consequences: The controller records completion explicitly and never creates extra work to consume unused time.
Status: active
Scope: v0
Load-bearing: yes

## D3 - 2026-08-05 - Host proof is required

Decision: Every enforcement claim must name a host mechanism, failure mode, and test evidence. Model instructions are not enforcement.
Why: "how do we enforce that it does?" - Plannotator annotation.
Consequences: The implementation blocks new tool calls at the host pre-tool seam and labels unsupported child stopping as guidance.
Status: superseded-by D4
Scope: v0
Load-bearing: yes

## D4 - 2026-08-11 - No guidance-only activation

Decision: Wall-clock may activate only when the selected host can enforce the requested expiry policy. A package that provides only prompts, timers, skills, or MCP must reject activation rather than run a guidance-only limit.
Why: "a limit should always be an enforcement. if we can't do that with a plugin, we shouldn't try"
Alternatives: Guidance-only activation (rejected because it is equivalent to saying "hurry up"); package discovery without activation (accepted for unsupported clients).
Consequences: Native host enforcement is a prerequisite for an active session. Unsupported activation fails closed. D3's former guidance fallback is superseded.
Status: active
Scope: v0
Load-bearing: yes

## D5 - 2026-08-11 - Measured context replaces estimates

Decision: Every parent and child turn receives measured current time, total elapsed time, latest inference elapsed time, latest tool-call elapsed time, remaining time, and actual assignment elapsed time. Agents do not estimate task duration.
Why: "parent and children are also acutely aware at every turn how much time remains and how long each task has taken" and "i suspect agents will be very poor at estimating how long a task takes. they should not attempt to estimate"
Alternatives: A deadline-only context (rejected because it hides elapsed work); an agent-provided duration estimate (rejected because the user expects measured time, not guesses).
Consequences: Host adapters must measure and inject the fields at each model turn. Assignment and report contracts use actual elapsed time.
Status: active
Scope: v0
Load-bearing: yes

## D6 - 2026-08-11 - Pi and OMP are first enforcement targets

Decision: Build and prove native enforcement for Pi and OMP first. Codex and Claude may discover the package but cannot activate wall-clock until an open, tested enforcement seam exists. Claude proprietary systems are out of scope.
Why: "only harnesses i am considering: codex, pi, omp, claude (do not target claude's proprietary system). favor pi and omp"
Alternatives: Treat every package-loading client as equally supported (rejected because package discovery does not prove enforcement); target Claude proprietary systems (rejected by scope).
Consequences: Pi and OMP host tests are the first release gate. Codex and Claude remain package targets only until their open runtime seams are proven.
Status: active
Scope: v0
Load-bearing: yes

## D7 - 2026-08-11 - Expiry policy is user-selected

Decision: Activation requires one expiry policy: `block-new`, which rejects new work while admitted work may finish, or `abort-running`, which rejects new work and aborts every wall-clock-owned running action through an observed executor signal.
Why: "i'd like to be able to decide whether or not this is the case"
Alternatives: Always allow admitted work to finish (rejected because it removes the user's choice); always abort admitted work (rejected because some executors cannot safely abort).
Consequences: The selected policy is stored, visible in status and reports, and enforced at the host boundary. A host must reject `abort-running` when it cannot observe an abortable executor.
Status: active
Scope: v0
Load-bearing: yes

## D8 - 2026-08-11 - Compression preserves a working vertical slice

Decision: When time contracts, wall-clock reduces scope toward the smallest working vertical slice and reports the skipped work, validation, shortcuts, risks, and unknowns.
Why: "vertical slice"
Alternatives: Describe any incomplete result as merely usable partial work (rejected because it does not promise an end-to-end working result); hide skipped validation (rejected because it would mislead the parent).
Consequences: Reports and acceptance targets must identify the working path, not only a list of completed files or investigations.
Status: active
Scope: v0
Load-bearing: yes

## D9 - 2026-08-11 - MCP is optional

Decision: MCP is an optional Agent Plugins component and an optional wall-clock control and inspection surface. It is never required by the package standard and never supplies deadline enforcement.
Why: "is mcp required by plugin standard?"
Alternatives: Require MCP for every client (rejected because the standard permits skills-only clients); use MCP as the enforcement boundary (rejected because MCP does not define host pre-action hooks).
Consequences: The root manifest and Agent Skill remain the portable floor. Native Pi and OMP adapters enforce deadlines independently of MCP.
Status: active
Scope: v0
Load-bearing: yes

## D10 - 2026-08-11 - Defer unsupported-harness activation

Decision: Keep Codex and Claude package discovery available, but defer active wall-clock sessions on those hosts until an open, tested enforcement seam exists. Claude proprietary systems remain excluded.
Why: "only harnesses i am considering: codex, pi, omp, claude (do not target claude's proprietary system). favor pi and omp"
Consequences: v0 implementation work stays focused on Pi and OMP. Revisit activation support when v1 host scoping identifies a public lifecycle boundary and its tests prove the selected expiry policies.
Status: deferred
Revisit: when v1 host scoping starts or an open Codex or Claude enforcement seam becomes available
Scope: v1+
Load-bearing: yes

## D11 - 2026-08-11 - Serialize actions by native abort domain

Decision: Under `abort-running`, admit only one running action in each native host session. Permit an OMP parent task and its child action to coexist because they are separate native sessions with separate abort functions.
Why: Pi and OMP expose a session-wide abort function, not an action-specific abort function. Concurrent actions in one session would make a deadline abort stop unrelated work. Global serialization would instead make an admitted task block all useful child tools.
Alternatives: Permit concurrent same-session work (rejected because cancellation would have collateral effects); serialize the full parent and child tree (rejected because the child could not do work while its parent task was active).
Consequences: The adapter tracks the direct native session for each admitted action. A second action in the same session is blocked until the first ends. Parent and child deadline timers can abort their separately owned actions.
Status: active
Scope: v0
Load-bearing: yes

## D12 - 2026-08-11 - Newest durable state is authoritative

Decision: Restore only the newest wall-clock custom entry and deeply validate version 3. If it is malformed, belongs to another session, or has an obsolete version, disable wall-clock for that session instead of loading an earlier entry.
Why: Falling back to older valid state can silently restore a stale deadline, plan, policy, or assignment after a newer write became invalid.
Alternatives: Search backward for the latest valid entry (rejected because it hides corruption and revives stale obligations); migrate older states (rejected because the project does not preserve obsolete contracts).
Consequences: Restore fails closed and reports the error. Other sessions remain isolated. Runtime timers and timing fields are rebuilt from valid absolute state and the current clock.
Status: active
Scope: v0
Load-bearing: yes

## D13 - 2026-08-12 - Native command has a direct-start form

Decision: The native `/wallclock` command accepts `[start] <deadline> [block-new|abort-running] [prompt]`. `start` is optional, an omitted policy defaults to `abort-running`, and `abort` is an accepted short spelling. The adapter activates the contract before it submits a trailing prompt. An idle host starts a turn; a running host receives normal steering input.
Why: The required command words made initialization clumsy and prevented one command from both starting enforcement and starting the requested work.
Alternatives: Require `start` and an explicit policy every time (rejected because it adds ceremony to the common case); submit the prompt before activation (rejected because its first tool call could escape the contract); use one delivery mode in every host state (rejected because Pi and OMP distinguish idle turn start from active steering).
Consequences: D7 still requires every active contract to carry an enforceable policy, but its requirement for an explicit user choice at native slash-command invocation is superseded. Native operation tools keep their explicit canonical policy field. Prompt delivery fails before activation when the host has no user-message API.
Status: active
Scope: v0
Load-bearing: no

## D14 - 2026-08-12 - Give fast lanes two minutes

Decision: The native do-it-now and wrap-it-up lanes use a two-minute hard deadline, `abort-running`, bounded delegation through one wall-clock assignment while active, and 12 ordinary tool calls. Wrap-up still blocks new delegation and destructive work.
Why: Two minutes leaves margin for host and model startup plus one slow external operation. Bounded delegation can reduce uncertainty or finish independent work faster without weakening the phase gate.
Alternatives: Keep no delegation (rejected because it prevents useful parallel work); remove the hard limit (rejected because it would recreate the delay these lanes are meant to prevent).
Consequences: Fast-lane delegation may use any number of independently bounded inline batch items. Nested delegation remains blocked. The 15-second pre-deadline interval is unchanged.
Status: active
Scope: v0
Load-bearing: no

## D15 - 2026-08-12 - Default native expiry policy to block-new

Decision: The native `/wallclock` command defaults an omitted expiry policy to `block-new`; users must opt into `abort-running` or its `abort` short spelling.
Why: The safe default must reject new work at expiry without stopping work that was already admitted. Aborting running work requires an explicit choice and a host that can prove safe cancellation.
Alternatives: Keep `abort-running` as the default (rejected because it can stop admitted work without an explicit user choice); require an explicit policy (rejected because the direct-start command should remain concise).
Consequences: Direct-start commands without a policy use `block-new`; explicit operation-tool inputs and explicit native policies remain unchanged. Documentation and focused native-command tests must show the new default.
Status: active
Scope: v0
Load-bearing: yes

## D16 - 2026-08-13 - Clear temporary fast lanes after terminal settlement

Decision: The native do-it-now and wrap-it-up guards stop automatically only
after the host reports a terminal agent run. Pi uses `agent_settled`; OMP uses
the terminal `agent_end` event. An expired guard remains active through
post-run continuations so late work cannot bypass the deadline.
Why: A fast lane belongs to one explicit request and should not require a
manual `/wallclock stop` after the request ends, but expiry must remain
enforced until the host has no continuation left to run.
Alternatives: Stop on every `agent_end` (rejected because Pi can still retry,
compact, or continue); keep an expired lane until manual stop (rejected because
it leaks the temporary guard into the next normal request).
Consequences: Terminal settlement persists a stopped fast-lane state and clears
its deadline and status-refresh timers. D17 extends the same cleanup to every
explicit native wall-clock contract.
Status: superseded-by D17
Scope: v0
Load-bearing: no

## D17 - 2026-08-13 - Clear every explicit contract after terminal settlement

Decision: Every native wall-clock contract started by an explicit
`/wallclock` command or `wallclock_start` stops after terminal agent
settlement. Pi uses `agent_settled`; OMP uses terminal `agent_end`. Expiry
enforcement remains active through retries and continuations. If a child action
is still running, cleanup waits for that child to finish.
Why: A user may need to send a follow-up because the task is unfinished. A
completed agent turn must not leave a stale contract that forces the user to
type `/wallclock stop` before the follow-up.
Alternatives: Keep ordinary contracts session-scoped (rejected because it
leaks the time boundary into the next normal request); clear at every
`agent_end` (rejected because Pi and OMP can still schedule continuation work).
Consequences: Follow-ups run normally after settlement. A follow-up that needs
its own time limit must start a new contract. Active child work retains its
deadline until its terminal lifecycle event.
Status: active
Scope: v0
Load-bearing: no
## D18 - 2026-08-13 - Child deadlines inherit the parent hard stop

Decision: Every child assignment is bounded by the earlier of its requested
budget and the parent session's hard deadline. A child action must have a
host action identifier and a tested abort seam before admission. When a child
deadline expires, the host aborts running child actions even if the parent's
expiry policy is `block-new`; that policy controls only work admitted directly
in the parent. When the parent deadline expires, all running child actions
are aborted.
Why: A child that can continue after its parent budget ends violates the
parent's time contract and can keep the overall task alive past its deadline.
Alternatives: Let `block-new` children finish (rejected because parent time
would not be a hard bound); rely on child instructions only (rejected because
instructions cannot stop an already-running executor).
Consequences: Child work fails closed on hosts without a proven abort path.
Cancellation is reported only after the host observes the native abort result.
Status: active
Scope: v0
Load-bearing: yes

## D19 - 2026-08-13 - Inline batch delegation

Decision: An active parent may choose any number of independent child tasks in one OMP `task` call. Each item carries its own `wallClock` assignment contract; the host validates the full batch before creating assignments or children, then maps each item to one assignment and one child session.
Why: The user explicitly wants agents to choose how many delegations they need, and one parent dispatch should not require one setup call per child.
Alternatives: Pre-create assignments in separate calls (rejected because it adds agent-facing round trips); share one assignment across children (rejected because it loses per-child budgets, scope, reports, and lifecycle boundaries).
Consequences: Batch delegation is supported in the parent session. Nested delegation remains deferred. Under `abort-running`, the native host still serializes parent actions within one abort domain.
Status: active
Scope: v0
Load-bearing: yes

## D20 - 2026-08-13 - Vibe docs describe, never prescribe

Decision: Vibe and contract docs in this repo describe goals and feel; they never prescribe formulas. Mechanisms appear only as labeled examples ("Example:", never "Means:"), and definitions describe rather than legislate.
Why: "do not be prescriptive in definitions" and "this is too prescriptive for a vibe. this is an example, not a formula" and "no prescriptive stuff in vibes" - Plannotator annotations, vibe.md round 1 (items 1, 16, 28).
Alternatives: Keep prescriptive means in vibes (rejected because the human reads them as rules, making the vibe a straitjacket); strip all mechanism detail from vibes (rejected because labeled examples carry taste).
Consequences: Every clause in docs/vibe.md uses "Example:". Future vibe drafts are checked against this rule before review. Strong words like "need" are quoted as source material, never paraphrased into requirements.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: active
Scope: v0
Load-bearing: yes

## D21 - 2026-08-13 - The goal is progress; sifting is the suspected mechanism

Decision: Tools and skills in this repo are judged by whether they produce real, felt progress toward action. The sieve is the current hypothesis for how, not the goal, and is replaceable if it stops producing progress.
Why: "working with the tools and skills should both feel like and crucially ACTUALY BE making progress... the goal is not sifting. sifting is what i suspect works for me" - Plannotator annotation, vibe.md round 1 (item 8).
Alternatives: Keep sifting as the stated goal (rejected because a metaphor cannot be a success criterion); drop the sieve metaphor entirely (rejected because it remains the best current hypothesis).
Consequences: V1 is "Progress you can feel": after one sitting, the user can name what moved. Sieve-style tooling (passes, gut calls, top-k) is a mechanism under test.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: active
Scope: v0
Load-bearing: yes

## D22 - 2026-08-13 - Never delegate understanding

Decision: Agents fetch, filter, rank, and propose; the user owns understanding. Skills build the user's working model rather than substituting for it, and conclusions must carry provenance.
Why: "never delegate understanding... 'raw information plus intuition plus iteration leads to clarity leads to understanding' write that down" - Plannotator annotation, vibe.md round 1 (item 15).
Alternatives: Let agent conclusions stand in for user understanding when the user is busy (rejected because it erodes exactly the compounding the toolchain exists to support).
Consequences: V4 added to docs/vibe.md. lc-ticketize tickets only what is already understood. Any tool whose output cannot be explained back by the user violates the vibe.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: superseded-by D32
Scope: v0
Load-bearing: yes

## D23 - 2026-08-13 - Turn receipts are a companion concern, not part of the sifting strategy

Decision: The end-of-turn receipt is an agent-communication preference tracked separately from the sieve philosophy; it lives in docs/vibe.md as an explicitly labeled companion clause.
Why: "this is my overall vibe for interacting with the agent but i fear this is separate from the sifting strategy. but i do want this." - Plannotator annotation, vibe.md round 1 (item 34); also items 12 and 13.
Consequences: Receipt work (standing instruction, possible pi/omp extension) proceeds on its own track and is not evidence for or against sieve tooling.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: active
Scope: v0
Load-bearing: no

## D24 - 2026-08-13 - "yearn" is taken; the skill-scoped logger needs its own name

Decision: The proposed papercut-style logger for skill invocations must not be named "yearn". Yearn already exists, is human-facing, and captures anything the user yearns for.
Why: "yearn exists. it's anything the user yearns for. not necessarily about a skill. i proposed a skill-specific version; it is not yearn" and "should have a better name" - Plannotator annotations, vibe.md round 1 (items 5, 33).
Consequences: Proposal P4 in docs/log/2026-08-13-sieve-vibe.md is renamed-pending. Nothing in this repo ships a skill-scoped tool called "yearn". Naming is an open question returned to the user.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: active
Scope: v0
Load-bearing: no

## D25 - 2026-08-13 - Optimize for resumability, not for uninterrupted blocks

Decision: Tools are designed so interruptions cost as little as possible: state saved after every decision, passes resumable mid-pile, minimal context loss on return. Uninterrupted blocks are the ideal; resumability is the requirement.
Why: "i have adhd. ideally i have uninterrupted blocks. but i think the real preference is - interruptions cost as little as possible; i can continue sifting with minimal context loss." - Plannotator annotation, vibe.md round 1 (item 14).
Consequences: Use Circumstances in docs/vibe.md rewritten around interruption cost. Review and triage tools must not lose state when interrupted.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: active
Scope: v0
Load-bearing: no

## D26 - 2026-08-13 - Decomposition targets deliverables; implement/verify is one pattern, not a dichotomy

Decision: Ticket decomposition attacks unbroken deliverables. The implement-plus-verify split is one common pattern, applied with judgment, not a rule imposed on every task; dependencies between tasks are named, and a multi-component deliverable can remain one ticket.
Why: "i think our bigger problem is simply that we haven't been breaking down deliverables. don't over-index on the 'task-verify' dichotomy" and "'create a model eval framework' is a deliverable but has several sub-components not captured by the deliverable, which should still be a single ticket" and "not always necessary" - Plannotator annotations, vibe.md round 1 (items 25, 2, 3).
Alternatives: Mandate an implement/verify sub-task split for every ticket (rejected as over-indexing on one axis of hidden work).
Consequences: V3 rewritten as "Deliverables get broken down". Proposal P1 for lc-ticketize changes shape: no mandated split; instead decomposition guidance plus named proof.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: superseded-by D31
Scope: v0
Load-bearing: yes

## D27 - 2026-08-13 - Defer lost-chat recovery spec

Decision: Recovery of word dumps and decisions from session history (memex or similar) is wanted but unspec'd; defer until the mechanism is understood.
Why: "ideally we have systems that can recover from this; memex plugin is useful but unsure how to use/spec" - Plannotator annotation, vibe.md round 1 (item 24).
Consequences: docs/vibe.md V2 notes the aspiration without promising a mechanism. initiative-standup already starts from a Memex session ledger and is the natural proving ground.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: deferred
Revisit: when Memex usage matures beyond the standup ledger, or the next time a word dump is lost
Scope: v1+
Load-bearing: no

## D28 - 2026-08-13 - Defer loop-duration recording

Decision: Recording how long iteration loops take (to learn whether changes help) is attractive but noisy and not yet in scope.
Why: "would be great to record how long loops take so we can iterate on skills/approaches etc and see us make progress and/or rollback bad progress. really hard to say with certainty though lots of noise in the signal. also not necessarily in scope" - Plannotator annotation, vibe.md round 1 (item 31).
Consequences: docs/vibe.md V6 mentions the idea as not yet in scope; no instrumentation is built now.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: deferred
Revisit: when skill-iteration is next revised, or when a second loop feels too slow
Scope: v1+
Load-bearing: no

## D29 - 2026-08-13 - Few stages, settled by iteration

Decision: Clarity pipelines stay small: three stages is ideal, four or five in practice, settled by iterating rather than by rule; the pipeline should be as painless and fast as possible while still productive.
Why: "20 stages isn't better than nothing-at-all. 3 stages is idealy; probably 4 or 5, but we have to iterate... should be as painless and fast as possible while also as productive as possible" - Plannotator annotation, vibe.md round 1 (item 20).
Consequences: docs/vibe.md V2 adopts this framing. Any proposed pipeline with more than five stages carries the burden of proof.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: active
Scope: v0
Load-bearing: no

## D30 - 2026-08-13 - The vibe is the source of truth; the artifact chain is a facet

Decision: docs/vibe.md is the source of truth for this repo's philosophy. The lc-north-star artifact chain (dump, vibe, PRD, spec, plan, tickets) is one downstream facet of it, not a separate or fixed system, and is updated or replaced as the vibe iterates.
Why: "i think ideally we replace/update this chain. it's not a source of truth or a separate system; it's a facet of the system/vibe we are cultivating (one that will need updating as we iterate on this vibe, which is the source of truth)" - Plannotator annotation, vibe.md round 2 (item 1).
Alternatives: Treat the chain as fixed infrastructure the vibe must fit into (rejected because it inverts the authority); treat chain and vibe as independent systems (rejected because the chain is downstream).
Consequences: After vibe approval, lc-north-star and docs/lifecycle.md are revised to declare the vibe upstream. All skills and tools answer to the vibe.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: active
Scope: v0
Load-bearing: yes

## D31 - 2026-08-13 - Deliverables are one ticket plus enumerated sub-tickets

Decision: Decomposition targets deliverables. A deliverable is one ticket; its components are sub-tickets that must also be tracked and enumerated. Implement/verify remains one common split, applied with judgment, not a dichotomy; dependencies between tasks are named.
Why: "the deliverable is one ticket; the components are sub-tickets that must also be tracked and enumerated" - Plannotator annotation, vibe.md round 2 (item 2).
Alternatives: A multi-component deliverable as a single flat ticket with no tracked sub-tickets (rejected because components then hide); forcing every component into a separate top-level ticket (rejected because the deliverable loses its single handle).
Consequences: Supersedes D26, carrying forward its decomposition intent. lc-ticketize's eventual revision must model deliverable ticket plus enumerated sub-tickets.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: active
Scope: v0
Load-bearing: yes

## D32 - 2026-08-13 - Understanding is symbiotic

Decision: The user strives for understanding; the system strives to measure and ensure it, and the system has failed if it cannot guide the user there. Once the user has full understanding, the user guides the system. Understanding is never delegated away; conclusions carry provenance; agents fetch, filter, and propose.
Why: "the user does not own understanding; the user strives for understanding, and the system strives to measure and ensure their understanding. the system has failed if it cannot guide the user to understanding. once the user has full understanding, the user can guide the system. it is symbiotic." - Plannotator annotation, vibe.md round 2 (item 4); probing/measurement from item 6.
Alternatives: The user owns understanding unaided (rejected: the system then has no failure mode when the user is lost); the system owns understanding (rejected: that is delegation).
Consequences: Supersedes D22, carrying forward "never delegate understanding" and provenance. V4 rewritten around symbiosis; the system needs probing and measurement mechanisms (teach-back, spot questions) as first-class features.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: active
Scope: v0
Load-bearing: yes

## D33 - 2026-08-13 - Existing skills are seeds, not fixtures

Decision: Existing skills and tools are seeds and context - works in progress, some to be scrapped. Nothing is load-bearing merely because it exists, and iterations on any of them (ticketize included) are downstream of this vibe. Do not be poisoned by existing context and history.
Why: "do not over-index on existing skills; if the skills worked, we would not need this vibe doc or to plan this system. they are seeds and context. they are works in progress, or (often) work that should be scrapped. crucial: do not be poisoned by existing context and history" - Plannotator annotation, vibe.md round 2 (item 5); item 3 on ticketize.
Alternatives: Treat shipped skills as the baseline to preserve (rejected because it anchors the new system to the old one's assumptions).
Consequences: docs/vibe.md carries the seed caveat above its clauses. Future skill work may scrap and rebuild rather than amend.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: active
Scope: v0
Load-bearing: yes

## D34 - 2026-08-13 - At most two fix rounds per doc; aim for one

Decision: Review of a written doc converges fast: at most two fix rounds, and the goal is one. A doc needing a third fix round signals the draft process failed, not that a third round should happen.
Why: "minimal fix-rounds. i want to say max 2. avoid 2 if possible" - Plannotator annotation, vibe.md round 2 (item 8).
Consequences: Drafts are written to converge (self-contained, glossary first, non-prescriptive per D20). lc-review-capture's rounds stay bounded per D29's stage discipline.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: active
Scope: v0
Load-bearing: no

## D35 - 2026-08-13 - Ticketize's refusal to ticket vibes stands provisionally

Decision: lc-ticketize's hard rule against ticketing ununderstood work ("refuses to ticket vibes") stands for now on the grounds that it minimizes noise for coworkers. The user is not sure they agree; the rule is provisional and revisited when lc-ticketize is revised.
Why: "not sure i agree. but good to minimize noise for coworkers, so can stand for now" - Plannotator annotation, vibe.md round 3 (item 1, anchored to the V4 example). Reading: the target is the ticketize line, since "minimize noise for coworkers" fits keeping half-baked work off a shared board; if the disagreement was with the symbiosis framing instead, the user can reopen V4.
Consequences: No text change to docs/vibe.md (the annotation says the line can stand). The uncertainty is on the record so a future revision does not mistake the rule for settled.
Source: plannotator round on docs/vibe.md, 2026-08-13
Status: active (provisional)
Revisit: when lc-ticketize is revised under D31, or if the user reopens it
Scope: v0
Load-bearing: no

## D36 - 2026-08-13 - The skill-scoped notes tool is named skiterate and is a plugin

Decision: The papercut-style capture scoped to skill invocations (proposal P4) is named `skiterate` and will be built as an Agent Plugins package with native Pi and OMP adapters, following the wall-clock pattern, rather than as a skill-plus-script.
Why: "yes, it would be a plugin like yearn or wallclock here. call it idk 'skiterate'" - user in chat, 2026-08-13.
Consequences: Resolves the open naming from D24. Name sits adjacent to the existing skill-iteration skill (skiterate is the logger; skill-iteration is the loop it feeds); flagged to the user and accepted provisionally ("idk"), so rename while unbuilt is free.
Source: user chat message, 2026-08-13
Status: active (provisional name)
Revisit: on any rename request before first ship
Scope: v0
Load-bearing: no

## D37 - 2026-08-13 - Turn receipts ship as a plugin in three stages

Decision: The turn receipt is delivered as an Agent Plugins package, not as a standing instruction in a global instructions file. v1 injects a succinct per-turn receipt reminder through the host turn-context seam, the same mechanism wall-clock uses to inject measured time. v2 adds collapsible above-the-fold UI in the harness. v3 adds a companion model that writes the receipt content.
Why: "think that is also best as a plugin since wallclock injects the time left etc after each turn. succinct reminder culd be nice. longterm would be nice to have collapsible arrows for above-the-fold stuff and/or a companion model (v2 and v3)" - user in chat, 2026-08-13.
Alternatives: Standing instruction in the global instructions file first, extension later (rejected: the plugin owns delivery from v1, and the wall-clock turn-context seam is already proven on this machine).
Consequences: The earlier layer-1/layer-2 split (log doc P5) is superseded. v1 needs no model call. v3's cheap-model call path must be verified against the installed omp/pi before implementation, same discipline as wall-clock's capability checks.
Source: user chat message, 2026-08-13
Status: active
Scope: v0 (v1); v1+ (v2, v3)
Load-bearing: no

## D38 - 2026-08-13 - Turn summary replaces turn receipt as the current name

Decision: The current product name, package name, native command, and user-facing reminder use "summary" instead of "receipt". The package is `turn-summary`, the command is `/summary on|off`, and the old package and command are removed rather than kept as aliases. Historical decision and review records retain their original wording.

Why: The user requested "change name to summary;replace" after asking what "receipt" meant.

Consequences: Current code and current contract documents use summary terminology. Existing Pi and OMP processes must restart after the package replacement; new processes load the renamed package.

Source: user chat message, 2026-08-13
Status: active
Scope: v0 (v1)
Load-bearing: no
