---
date: 2026-09-02
topic: agent-memory
status: draft
source_material: user ideal-reality dump and north-star interview (mnemopi-shaped memory across agents; deliberately thinner than session-history)
---

# Glossary

- **Agent memory**: Sticky judgment and facts that should survive context death and be available across agents.
- **Session history**: What was said/done in sessions; searchable plot. Not memory.
- **Wiki-brain**: Aggregated knowledge from external sources. Not memory.
- **Mnemopi-shaped**: The user's shorthand for memory that works across agents the way mnemopi-style memory feels — shared sticky recall, not a second wiki.

# Agent Memory Vibe

## Vibe Promise

Agent memory should feel like *us* — the sticky judgments and facts worth keeping — surviving across agents and context death. It is not a trash heap of every session, and it is not wiki-brain's external synthesis. When something has been remembered, future agents can inherit it without the user re-teaching the same call.

## Ideal Reality Dump

- Wishlist bundled "central agent memory" with wiki and session history; later split: memory, wiki-brain, session history are three things.
- "mnemopi across agents" as the memory shape.
- Wiki-brain = aggregated knowledge from external sources (nearly done elsewhere).
- Session history is the current build focus; memory vibe is "not that complicated" and can ship as a short companion contract.
- Memory: judgment and sticky facts survive context death; not a second wiki.

## Use Circumstances

- A taste or decision was made with one agent; another agent should not reverse it blindly.
- Context compacted or a new session started; a few load-bearing facts should still be known.
- The user does not want to maintain a wiki page for every personal preference or call.
- Something belongs in a past session transcript but has not been promoted; memory should not pretend it already did that job.

## Vibe Clauses

### V1. Sticky judgment across agents

- Promise: What was deliberately remembered can be used by more than one agent later.
- Example: A preference or decision recorded as memory is available to a different bot without the user pasting it again.
- Does not mean: Every agent may write anything without policy, or that all agents share one personality.
- Violation: Each agent has an isolated diary and the user re-teaches the same calls.
- Check: Write a sticky fact with agent A; agent B can use it without re-asking the user.

### V2. Memory is not wiki

- Promise: Memory holds *our* sticky calls and facts; wiki-brain holds synthesized external knowledge.
- Example: "James prefers main's vibe.md cut" is memory/taste; a distilled external topic dossier is wiki-brain.
- Does not mean: The two can never link, or that they cannot share storage technology.
- Violation: Memory becomes a dumping ground of scraped external pages, or wiki requires memory writes to function.
- Check: Sample memory entries; most should read as judgments/facts about the user or shared work, not imported articles.

### V3. Memory is not session history

- Promise: Remembering is not a substitute for searchable sessions, and sessions are not automatically memory.
- Example: Plot recall of a past chat is session history; a promoted standing decision is memory.
- Does not mean: Nothing in a session may be remembered, or that promotion must be heavy ceremony.
- Violation: The only way to recover a standing decision is semantic search over raw sessions every time.
- Check: A standing decision used weekly lives in memory; the conversation that produced it remains findable in session history.

## Anti-Vibes

| Anti-vibe | Why it violates the contract | Clause |
| --- | --- | --- |
| Per-agent amnesia | User re-teaches forever | V1 |
| Second wiki | External synthesis crowds out sticky judgment | V2 |
| Session-shaped memory | Raw transcripts pretend to be standing truth | V3 |

## Success Signals

- A judgment recorded once is inherited by another agent later.
- Memory stays small enough to trust; it does not grow like an unmanaged log.
- Users can tell whether something belongs in memory, wiki-brain, or session history.

## Scope Boundaries

- This is intentionally a short vibe. Session history carries the heavier recall product feel.
- Write authority, conflict policy (newer wins vs surface both), and retention/editing UX are open.
- Serving memory "via tailnet" and "probably CASS" are deployment notes, not feel clauses, until they change the feel.

## Open Questions

- Who may write memory — any agent, allowlisted agents, or only on explicit user say?
- On conflict, newer wins, surface both, or ask?
- How does something get promoted from a session into memory without becoming compulsive logging?

## Approval

- Approved by: pending
- Approved on: pending
- Amendment rule: This vibe changes only by explicit user request or direct user edit.
