---
date: 2026-09-02
topic: session-history
status: approved
source_material: user ideal-reality dump and north-star interview (tailnet wishlist; distinction from wiki-brain and agent memory; CASS mentioned as a possible power source)
---

# Glossary

- **Session**: A conversation or run transcript that happened somewhere — local harness, another machine on the tailnet, or a connected cloud chat.
- **Session history**: The searchable corpus of those sessions, aggregated for recall.
- **Nudge**: The user (or situation) indicates past context matters — for example "we talked about this" — without demanding a full forensic dump every turn.
- **Provenance**: Enough source identity to trust a hit: which session, when, which agent/harness — not a blended mush.
- **Wiki-brain**: Aggregated knowledge distilled from external sources. Not session history.
- **Agent memory**: Sticky judgment and facts meant to survive across agents (mnemopi-shaped). Adjacent, but not this product.

# Session History Vibe

## Vibe Promise

Session history should make agents hard to gaslight about the past. When the user says they already talked about something — or the plot clearly continues — the agent can recall the right moments easily, quickly, and correctly, with provenance. It should feel like one searchable brain for every user-approved connected source, including sessions born on different machines and connected cloud chats, not like picking a host and grepping files. It should not become a wasteful reflex that fetches history for every crumb of conversation.

## Ideal Reality Dump

- Wishlist: "central agent memory, wiki brain, session history, w RRF semantic search" — later split into three things.
- Focus now: session history search. "i don't wanna think about memory" for a while, then allowed a short memory vibe too.
- Win condition: "mostly agents not losing the plot across sessions, or if i say we talked about this they can recall."
- Sessions originate from local harnesses, different machines on the tailnet, and connected cloud chats; every source the user approves to connect belongs in the corpus.
- "Never re-ask is too strong. If nudged to remember, they should remember, easily and quickly and correctly. They shouldn't reach for it for every little thing. That would be wasteful."
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

- Promise: When past context is actually needed, recall is easy, fast, and correct. History search is triggered by an explicit nudge or clear continuity of the plot, not by every standalone turn.
- Example: User says "we talked about this" or resumes an unfinished thread → the agent finds the relevant moments quickly. A standalone "thanks" or other ordinary chatter does not trigger a search.
- Does not mean: The agent never searches unless the user uses an exact phrase, or that proactive recall is forbidden when the continuing plot is clear.
- Violation: Every message spends a search, or the agent shrugs when clearly nudged or continuing an earlier thread.
- Check: Run a session with explicit nudges, clear continuations, and standalone noise. Searches should occur for the first two and not for the noise.

### V2. One brain, many birthplaces

- Promise: Search feels unified across every user-approved connected source, including local harnesses, tailnet machines, and connected cloud chats.
- Example: Seed sessions from a local harness, another tailnet box, and a connected cloud chat; one search finds relevant material from each without source selection.
- Does not mean: The user must know where a session originated, or that aggregation is exposed as connector choreography.
- Violation: The user or agent must pick a machine, provider folder, or export bundle before searching, or an approved connected source is silently absent from the corpus.
- Check: Connect one source of each named kind, search once, and find material from all three without choosing a source silo.

### V3. Provenance over mush

- Promise: The default recall is a concise synthesized answer supported by one to three session citations. The agent can provide deeper excerpts on demand, and every citation remains attributable to a concrete session and moment.
- Example: "We chose X because Y" followed by two session citations, with the relevant transcript excerpts available when requested, beats one blended paragraph with no source.
- Does not mean: Every user-facing answer must dump raw transcripts, or that a short answer may omit provenance.
- Violation: Recall returns an uncited synthesis, more than three default citations, no concise answer, or no way to reach the session material supporting a claim.
- Check: Ask a question with several matching sessions. The first answer is concise and has one to three citations; request more and receive deeper excerpts tied to those sessions.

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

### V6. Open to the authenticated tailnet

- Promise: Any authenticated tailnet agent may search the entire session-history corpus.
- Example: An authenticated agent on any tailnet machine searches and receives results from local, tailnet, and connected cloud-chat sessions.
- Does not mean: Unauthenticated callers can search, or that corpus access is narrowed by which machine hosts a source.
- Violation: A valid authenticated tailnet agent is blocked, limited to a source-local subset, or forced through a human-only search path.
- Check: Authenticate agents from two tailnet machines and search for a session known to exist in a third source; both receive the same corpus-wide result.

### V7. Conflicts are visible, not silently settled

- Promise: Conflicting decisions and plausible matches are surfaced with provenance. The agent asks a clarifying question only when choosing the current option matters.
- Example: Two sessions disagree about a deadline → show both attributed decisions and ask which governs only when the deadline affects the current work. If it does not matter, state the conflict without interrupting.
- Does not mean: The agent silently picks one decision, or asks the user to resolve every merely plausible match.
- Violation: A conflict is hidden, provenance is missing, or the agent interrupts with a question when the current choice is unaffected.
- Check: Present conflicting historical decisions in a task where the choice matters and one where it does not. The first gets provenance plus a focused question; the second gets provenance without an unnecessary question.

### V8. Recent enough, honestly

- Promise: The index may lag a newly connected or completed session by a few minutes; recall remains honest about that freshness boundary rather than implying recent results are exhaustive.
- Example: A session completed moments ago is not claimed to be searchable yet; after the lag window it appears in the same corpus-wide search.
- Does not mean: Indefinite staleness, or silently treating a recent omission as proof that no such session exists.
- Violation: The system promises immediate indexing, hides a multi-minute delay, or presents incomplete recent results as complete.
- Check: Search immediately after adding a session and again after the allowed few-minute lag. The UI/agent behavior remains honest about availability, then returns the session once indexed.

## Anti-Vibes

| Anti-vibe | Why it violates the contract | Clause |
| --- | --- | --- |
| Search-on-every-crumb | Wasteful, slow, noisy | V1 |
| Pick-a-machine search | Breaks one-brain feel | V2 |
| Mush without provenance | Can't verify or navigate | V3 |
| Human-only archive | Agents still lose the plot | V4 |
| Everything-is-memory | Collapses three different products | V5 |
| Arbitrary tailnet gate | Denies corpus access to an authenticated agent | V6 |
| Silent conflict resolution | Hides uncertainty and risks acting on the wrong decision | V7 |
| Pretend-fresh indexing | Makes recent omissions look definitive | V8 |

## Success Signals

- "We talked about this" yields a fast, concise, correct recall with one to three session citations and deeper excerpts on demand.
- Agents resume multi-session work without full re-briefing when the plot is in history.
- Sessions from local harnesses, tailnet machines, and connected cloud chats appear in one search surface when approved and connected.
- Any authenticated tailnet agent can search the entire corpus.
- Conflicting decisions and plausible matches are visible with provenance, with questions only when the current choice matters.
- Ordinary standalone turns do not pay a history-search tax, while explicit nudges and clear plot continuations do trigger recall.
- Newly added sessions may take a few minutes to index, and the experience is honest about that lag.

## Scope Boundaries

- Wiki-brain and agent memory are sibling products with their own vibes; they are out of scope except as boundaries.
- The corpus covers every user-approved connected session source: local harnesses, tailnet machines, and connected cloud chats.
- Exact ranking/RRF mechanics are implementation; the feel is fast, correct, concise, provenance-preserving recall.
- CASS is a possible power source, not a required brand in the feel contract.


## Approval

- Approved by: User
- Approved on: 2026-09-03
- Approval evidence: Batched north-star interview selections and explicit approval
- Amendment rule: This vibe changes only by explicit user request or direct user edit.
