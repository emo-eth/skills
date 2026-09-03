---
date: 2026-09-02
topic: agent-memory
status: approved
source_material: user ideal-reality dump and north-star interview (mnemopi-shaped memory across agents; deliberately thinner than session-history)
---

# Glossary

- **Agent memory**: Sticky judgment and facts that should survive context death and be available across agents.
- **Session history**: What was said/done in sessions; searchable plot. Not memory.
- **Wiki-brain**: Aggregated knowledge from external sources. Not memory.
- **Mnemopi-shaped**: The user's shorthand for memory that works across agents the way mnemopi-style memory feels — shared sticky recall, not a second wiki.
- **Provenance**: Where and when a memory came from, including the source session or user statement that supports it.
- **Scope**: Where a memory applies: globally to the user's personal taste, or within a project, role, or context.

# Agent Memory Vibe

## Vibe Promise

Agent memory should feel like *us* — the sticky judgments and facts worth keeping — surviving across agents and context death. It is not a trash heap of every session, and it is not wiki-brain's external synthesis. Trusted agents can selectively promote clearly reusable, stable facts or judgments automatically, with provenance, while the user remains in charge of what endures. When something has been remembered, relevant future agents can inherit it without the user re-teaching the same call.

## Ideal Reality Dump

- Wishlist bundled "central agent memory" with wiki and session history; later split: memory, wiki-brain, session history are three things.
- "mnemopi across agents" as the memory shape.
- Wiki-brain = aggregated knowledge from external sources (nearly done elsewhere).
- Session history is the current build focus; memory vibe is "not that complicated" and can ship as a short companion contract.
- Memory: judgment and sticky facts survive context death; not a second wiki.
- A trusted agent may notice a clearly reusable stable fact or judgment and promote it automatically instead of requiring a ceremony every time.
- Promotion carries provenance, and routine transcript content stays in session history rather than becoming durable memory.
- Memory serves global personal taste as well as project, role, and context-specific calls.
- Relevant, high-confidence memories reach agents proactively and selectively.
- When memories conflict, both remain visible with provenance until explicitly resolved. A newer user statement may supersede an older memory, but an agent never silently overwrites a judgment.
- The user can inspect, correct, delete, supersede, and forget memories.

## Use Circumstances

- A taste or decision was made with one agent; another agent should not reverse it blindly.
- Context compacted or a new session started; a few load-bearing facts should still be known.
- The user does not want to maintain a wiki page for every personal preference or call.
- A trusted agent recognizes a stable, reusable fact during work and can preserve it without turning every transcript line into memory.
- A memory must be checked against its source, scope, or age before it is trusted.
- Two plausible calls disagree; the user can see both with provenance and resolve the disagreement deliberately.
- Something belongs in a past session transcript but has not been promoted; memory should not pretend it already did that job.

## Vibe Clauses

### V1. Sticky judgment across agents

- Promise: What was deliberately remembered can be used by more than one agent later.
- Example: A preference or decision recorded as memory is available to a different bot without the user pasting it again.
- Does not mean: Every agent may write anything without policy, or that all agents share one personality.
- Violation: Each agent has an isolated diary and the user re-teaches the same calls.
- Check: Write a sticky fact with agent A; a relevant agent B can use it without re-asking the user.

### V2. Memory is not wiki

- Promise: Memory holds *our* sticky calls and facts; wiki-brain holds synthesized external knowledge.
- Example: "James prefers main's vibe.md cut" is memory/taste; a distilled external topic dossier is wiki-brain.
- Does not mean: The two can never link, or that they cannot share storage technology.
- Violation: Memory becomes a dumping ground of scraped external pages, or wiki requires memory writes to function.
- Check: Sample memory entries; most should read as judgments or facts about the user or shared work, not imported articles.

### V3. Memory is not session history

- Promise: Remembering is not a substitute for searchable sessions, and sessions are not automatically memory.
- Example: Plot recall of a past chat is session history; a promoted standing decision is memory.
- Does not mean: Nothing in a session may be remembered, or that promotion must be heavy ceremony.
- Violation: Routine transcript lines are retained as durable memory, or the only way to recover a standing decision is semantic search over raw sessions every time.
- Check: A standing decision used weekly lives in memory with its source still findable in session history; an incidental transcript exchange remains session history unless it is clearly reusable and stable.

### V4. Selective automatic promotion with provenance

- Promise: Any trusted agent may selectively and automatically promote a clearly reusable, stable fact or judgment, and every promoted memory carries provenance.
- Example: An agent promotes a settled preference that will matter in later work and shows which user statement or session supports it.
- Does not mean: Agents log every observation, promote speculation, or hide where a memory came from.
- Violation: Promotion requires the user to perform repetitive bookkeeping for obvious durable calls, or a memory appears without a source.
- Check: Give a trusted agent a stable preference and incidental transcript chatter; the preference can be promoted automatically with an inspectable source, while the chatter remains session history.

### V5. User-governed, visible memory

- Promise: The user governs durable memory and can inspect, correct, delete, supersede, or forget each memory; every memory exposes its content, provenance, and scope.
- Example: The user opens a memory, sees what it says, where it came from, and whether it is global or scoped to a project, role, or context, then corrects or removes it.
- Does not mean: User maintenance becomes a wiki-writing job, or an agent can conceal a durable judgment behind retrieval.
- Violation: A memory cannot be traced, edited, or removed, or its scope is ambiguous enough to leak a project call into unrelated work.
- Check: For any memory, verify visible content, provenance, and scope, then exercise correction, supersession, and forget controls and confirm the resulting state is clear.

### V6. Conflicts remain explicit

- Promise: Conflicting memories preserve both judgments and their provenance until an explicit resolution. A newer user statement may supersede an older memory, but agents never silently overwrite judgment.
- Example: A changed preference shows the old and new calls, identifies the newer user statement as a supersession when appropriate, and leaves the resolution understandable.
- Does not mean: The system must force the user to resolve harmless differences before work can continue, or that timestamps alone decide conflicting agent judgments.
- Violation: One judgment disappears when another is promoted, an agent silently replaces a prior call, or the user cannot tell which source supports each side.
- Check: Create two plausible conflicting judgments; both remain inspectable with provenance, and only an explicit user resolution or clearly newer user statement marks one as superseding the other.

### V7. Scoped and proactive recall

- Promise: Memory supports global personal taste plus project, role, and context scopes; relevant high-confidence memories reach agents proactively and selectively.
- Example: A global preference is useful across projects, while a project-specific decision appears only when that project or context is relevant.
- Does not mean: Every memory is injected into every turn, or scoped calls are treated as universal truth.
- Violation: Agents must re-ask for known relevant preferences, or a context-specific judgment silently governs unrelated work.
- Check: Exercise a global memory and memories scoped to separate projects, roles, and contexts; relevant high-confidence items appear without prompting, irrelevant scoped items do not, and the agent can show why each surfaced memory applies.

## Anti-Vibes

| Anti-vibe | Why it violates the contract | Clause |
| --- | --- | --- |
| Per-agent amnesia | User re-teaches forever | V1 |
| Second wiki | External synthesis crowds out sticky judgment | V2 |
| Session-shaped memory | Raw transcripts pretend to be standing truth | V3 |
| Invisible auto-learning | Durable facts appear without source or user control | V4, V5 |
| Silent overwrite | Conflicting judgments disappear without explicit resolution | V6 |
| Scope leakage or recall flood | Irrelevant calls govern work or every turn is stuffed with memory | V7 |

## Success Signals

- A judgment recorded once is inherited by another relevant agent later.
- A trusted agent can promote a stable reusable call without compulsive transcript logging, and the promotion shows provenance.
- Memory stays small enough to trust; it does not grow like an unmanaged log.
- Users can inspect every memory's content, provenance, and scope and can correct, supersede, delete, or forget it.
- Conflicting judgments remain visible until explicitly resolved, with newer user statements able to supersede older memories without silent agent overwrites.
- Global personal taste and scoped project, role, or context calls surface proactively when relevant and stay out when they are not.
- Users can tell whether something belongs in memory, wiki-brain, or session history.

## Scope Boundaries

- This is intentionally a short vibe. Session history carries the heavier recall product feel.
- Memory is for clearly reusable stable facts and judgments; routine transcript content remains in session history, and external synthesis remains wiki-brain.
- The contract covers trusted-agent promotion, provenance, user governance, conflict preservation and resolution, scopes, and selective proactive recall without prescribing implementation.

## Approval

- Approved by: User
- Approved on: 2026-09-03
- Approval evidence: Batched north-star interview selections and explicit approval
- Amendment rule: This vibe changes only by explicit user request or direct user edit.
