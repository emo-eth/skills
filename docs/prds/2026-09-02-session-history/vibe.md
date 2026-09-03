---
date: 2026-09-02
topic: session-history
status: draft
source_material: user ideal-reality dump and north-star interview (tailnet wishlist; distinction from wiki-brain and agent memory; CASS mentioned as a possible power source)
---

# Glossary

- **Session**: A conversation or run transcript that happened somewhere — local harness, another machine on the tailnet, or (aspirationally) a cloud chat product.
- **Session history**: The searchable corpus of those sessions, aggregated for recall.
- **Nudge**: The user (or situation) indicates past context matters — for example "we talked about this" — without demanding a full forensic dump every turn.
- **Provenance**: Enough source identity to trust a hit: which session, when, which agent/harness — not a blended mush.
- **Wiki-brain**: Aggregated knowledge distilled from external sources. Not session history.
- **Agent memory**: Sticky judgment and facts meant to survive across agents (mnemopi-shaped). Adjacent, but not this product.

# Session History Vibe

## Vibe Promise

Session history should make agents hard to gaslight about the past. When the user says they already talked about something — or the plot clearly continues — the agent can recall the right moments easily, quickly, and correctly, with provenance. It should feel like one searchable brain for sessions that may have been born on different machines (and maybe cloud chats), not like picking a host and grepping files. It should not become a wasteful reflex that fetches history for every crumb of conversation.

## Ideal Reality Dump

- Wishlist: "central agent memory, wiki brain, session history, w RRF semantic search" — later split into three things.
- Focus now: session history search. "i don't wanna think about memory" for a while, then allowed a short memory vibe too.
- Win condition: "mostly agents not losing the plot across sessions, or if i say we talked about this they can recall."
- Sessions "might ORIGINATE from different machines (or cloud sessions? things like chatgpt history too?) but i assume we'd aggregate them all on one machine for search."
- "never re-ask is too strong. if nudged to remember, they should remember, easily and quickly and correctly. they shouldn't reach for it for every little thing. that would be wasteful."
- One search surface, not "pick a machine / provider."
- Provenance stays: which session, when, which agent — not a mush.
- Possibly powered by CASS (mentioned as a candidate, not a locked mechanism).

## Use Circumstances

- The user says "we talked about this" and expects a fast, correct recall with a way to see where it came from.
- An agent continues work days later and needs the prior plot without the user re-explaining.
- Sessions were started on different machines or harnesses; search still feels like one place.
- The user is distracted and will only trust a short answer plus provenance, not a research report every time.
- Ordinary chatter where history fetch would be noise and cost.

## Vibe Clauses

### V1. Nudged recall, not compulsive fetch

- Promise: When past context is actually needed, recall is easy, fast, and correct. History is not scraped on every turn.
- Example: User says "we talked about this" → the agent finds the relevant moments quickly. Small talk does not trigger a search.
- Does not mean: The agent never searches unless the user uses an exact phrase, or that proactive recall is forever forbidden when plot continuity is obvious.
- Violation: Every message spends a search, or the agent shrugs when clearly nudged.
- Check: Run a session with deliberate nudges and deliberate noise. Searches should cluster on nudges/plot breaks, not on every line.

### V2. One brain, many birthplaces

- Promise: Search feels unified even when sessions were born on different machines or harnesses.
- Example: A session from another tailnet box (and, when in scope, a cloud chat import) shows up in the same search experience.
- Does not mean: Every possible cloud product is integrated on day one, or that aggregation mechanics are user-visible.
- Violation: The user or agent must pick a machine, provider folder, or export bundle before searching.
- Check: Seed sessions from two origins, search once, and find both without choosing a source silo.

### V3. Provenance over mush

- Promise: Hits remain attributable. The agent can show which session/moment supported the recall.
- Example: A short ranked set of hits with session identity and time beats one blended paragraph with no source.
- Does not mean: Every user-facing answer must dump raw transcripts; provenance can be a click/ask away if the answer stays honest.
- Violation: A confident "we decided X" with no way to find the session that said so.
- Check: After a recall, ask "where did you get that?" The agent points at concrete session material.

### V4. Agents keep the plot

- Promise: The primary beneficiary is agents continuing work without losing the story across sessions.
- Example: A coding or research agent resumes days later and recovers the prior constraints and decisions from history rather than reinventing them.
- Does not mean: Humans never search; human "find that thread" is welcome, just not the only win.
- Violation: History exists for human browsing but agents still re-ask the user for plot they already lived.
- Check: Resume a multi-session task with a fresh agent. It should recover plot-critical facts from history when nudged or clearly continuing.

### V5. Separate from wiki and memory

- Promise: Session history is not wiki-brain and not agent memory.
- Example: Wiki-brain holds synthesized external knowledge; memory holds sticky judgment/facts across agents; session history holds what was actually said/done in sessions.
- Does not mean: Search backends cannot be shared, or that results cannot link out to wiki/memory later.
- Violation: Session search returns undifferentiated "knowledge" with no session identity, or memory writes are required for basic recall of a past chat.
- Check: Pick one fact that lives in a past session. It should be findable here without first being promoted into wiki or memory.

## Anti-Vibes

| Anti-vibe | Why it violates the contract | Clause |
| --- | --- | --- |
| Search-on-every-crumb | Wasteful, slow, noisy | V1 |
| Pick-a-machine search | Breaks one-brain feel | V2 |
| Mush without provenance | Can't verify or navigate | V3 |
| Human-only archive | Agents still lose the plot | V4 |
| Everything-is-memory | Collapses three different products | V5 |

## Success Signals

- "We talked about this" yields a fast, correct recall with provenance.
- Agents resume multi-session work without full re-briefing when the plot is in history.
- Sessions from more than one origin appear in one search surface.
- Ordinary turns do not pay a history-search tax.

## Scope Boundaries

- Wiki-brain and agent memory are sibling products with their own vibes; they are out of scope except as boundaries.
- Cloud-chat ingestion (for example ChatGPT history) is desired in the ideal reality; whether it is day-one vs later is open.
- Who may search (every tailnet agent vs allowlists) is open.
- Exact ranking/RRF mechanics are implementation; the feel is fast, correct, provenance-preserving recall.
- CASS is a possible power source, not a required brand in the feel contract.

## Open Questions

- Is cloud-session ingest (ChatGPT and similar) in the first useful version, or local/tailnet origins first?
- Who is allowed to search: every agent on the tailnet, or a smaller allowlist?
- When several hits match, is the default a short ranked list, a single best hit plus provenance, or something else?
- How fresh must the index feel (seconds vs minutes) to still count as "easy and quick"?

## Approval

- Approved by: pending
- Approved on: pending
- Amendment rule: This vibe changes only by explicit user request or direct user edit.
