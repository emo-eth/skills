---
date: 2026-09-13
topic: session-history
status: approved
source_vibe: docs/prds/2026-09-02-session-history/vibe.md
---

# Session History PRD

## Glossary

- **Session**: A conversation or agent run recorded by a supported harness.
- **Source**: A supported harness history store on the search host or another tailnet machine.
- **Connected source**: A source the user has approved for synchronization and indexing.
- **Corpus**: The unified searchable set of indexed sessions from all included sources.
- **Session citation**: A reference that identifies the source, harness, session, time, and exact transcript moment supporting a claim.
- **Checkpoint**: Newly written material from an ongoing session made available to indexing before that session ends.
- **Hybrid search**: One retrieval path that uses both lexical matching and vector or embedding similarity under normal operation.
- **Degraded search**: A search that proceeds without a normally required retrieval path or source and clearly reports the missing coverage.
- **Disconnect**: Stop future synchronization from a source while retaining its indexed sessions.
- **Purge**: Explicitly remove indexed sessions from the corpus.

## North Star

An authenticated tailnet agent can recover the plot from sessions created by Pi, OMP, Codex, and Claude across the user's machines without knowing where those sessions live. An explicit reminder or clear continuation produces a concise, correct answer with inspectable provenance instead of a file hunt or an uncited guess. The user can search and inspect the same corpus directly from a CLI. Search stays fast, current, and honest when semantic retrieval or a source is unavailable.

## Source Vibe Summary

- Ideal reality: One searchable brain for every user-approved connected session source, with agents recalling the right moments quickly and correctly when the past matters.
- Feel promises: Selective recall rather than compulsive fetching (V1), one corpus across origins (V2), concise provenance-preserving answers (V3), agents retaining the plot (V4), separation from wiki-brain and agent memory (V5), authenticated tailnet-wide access (V6), visible conflicts (V7), and honest freshness (V8).
- Anti-vibes: Searching every turn, source silos, uncited synthesis, a human-only archive, treating all knowledge as memory, arbitrary tailnet restrictions, silent conflict resolution, and hidden staleness.

## Users And Jobs

- **User**: Find a past discussion directly, inspect the exact supporting transcript, control what enters or leaves the corpus, and understand source and index health.
- **Authenticated tailnet agent**: Recover prior constraints, decisions, and context without asking the user to repeat work or selecting a source machine.
- **Operator**: Connect and disconnect sources, keep indexing current, inspect degraded coverage, exclude sensitive sessions, and explicitly purge indexed data.

## Product Shape

- **Entry points**: MCP recall and citation-inspection tools for agents, backed by the designated session-history service; and a human CLI for search, status, source management, result inspection, and opening exact transcript moments.
- **Core flow**: Approve local and remote tailnet sources -> one designated service pulls and checkpoints their sessions into its CASS-backed retained corpus -> an agent calls the MCP wrapper or the user runs the CLI without selecting an origin -> the service retrieves lexical and semantic evidence -> return a concise cited answer -> inspect or expand exact source moments as needed.
- **Required surfaces**: Authenticated MCP tools; human CLI; source connection and health; incremental indexing; hybrid search; concise cited recall; exact-moment inspection; freshness and degradation warnings; exclusions; disconnect; and explicit purge.
- **Platform expectations**: The first complete product covers Pi, OMP, Codex, and Claude histories available on the user's tailnet machines. A CLI is sufficient for direct human use; no browser, mobile, or installed graphical application is required.
- **Data visibility expectations**: Every authenticated tailnet agent may search the complete included corpus. Unauthenticated callers receive no history. Search responses expose provenance, freshness, source gaps, retrieval degradation, and truncation rather than implying completeness.
- **Result states**: Distinguish useful evidence, completed search with no match, empty corpus, indexing not ready, degraded coverage, unavailable service, and denied access. Show in-progress work without implying a result. Unavailable or incomplete retrieval must never masquerade as a no-match answer or a successful latency check.

## Requirements

### R1. One corpus across tailnet origins

- Requirement: One designated CASS-backed tailnet service must pull included local and remote sessions into its retained corpus and serve every search through the agent-facing MCP wrapper and human CLI. Search must query that corpus without requiring the caller to choose or contact a source machine.
- Source: V2, V4 and explicit PRD grill clarification.
- Rationale: Agents should recover the plot rather than understand storage topology, and an offline source machine must not make already synchronized history unavailable.
- Acceptance: Pull relevant sessions from the designated service host and at least one other tailnet machine, take the remote machine offline, issue one unscoped query through the MCP wrapper and one through the CLI, and receive retained results from both origins with preserved provenance.
- Not acceptable: Query-time fan-out to source machines, separate per-machine search services, direct CASS shell access as the agent contract, manual export selection before each query, loss of retained remote history while its machine is offline, or results that lose source identity.

### R2. Pi, OMP, Codex, and Claude coverage

- Requirement: The first complete product must ingest and search session histories produced by Pi, OMP, Codex, and Claude.
- Source: Explicit PRD interview decision; V2.
- Rationale: These are the user's required local harness histories, not interchangeable examples.
- Acceptance: A known session from each of the four harnesses is indexed, returned by a relevant search, identified by its harness, and openable at the cited moment.
- Not acceptable: Declaring the product complete with only a generic connector demonstration or omitting one named harness.

### R3. Ongoing-session checkpoints and five-minute freshness

- Requirement: New material from an ongoing or completed supported session must become searchable through both lexical and semantic retrieval within five minutes under normal operation. Ongoing sessions must be checkpointed without waiting for them to end. Source outages suspend synchronization, not access to the retained corpus.
- Source: V8 and explicit PRD interview decisions.
- Rationale: Hours-long sessions cannot disappear from the shared brain until completion.
- Acceptance: Add a uniquely searchable passage to an active session and finish another session; exact-term and meaning-equivalent queries can each recover their relevant passage within five minutes. Exercise this with healthy local and remote sources. During an outage or embedding catch-up, retained results remain available with their coverage limits, but degraded operation is not counted as meeting the healthy freshness requirement.
- Not acceptable: Completion-only indexing, manual refresh as the ordinary path, indefinite lexical-only indexing treated as healthy hybrid operation, an undisclosed freshness lag, or claiming a just-written passage is absent from history before the freshness window closes.

### R4. Lexical and semantic hybrid retrieval

- Requirement: Under normal operation, one search must use both lexical matching and vector or embedding similarity. If semantic retrieval is unavailable or catching up, lexical search may return a degraded result only when the response identifies the missing semantic path.
- Source: User clarification during PRD drafting; V3 and V8.
- Rationale: Exact language and conceptual similarity are both necessary to recover past sessions reliably.
- Acceptance: Use a query with an exact-term hit and a meaning-equivalent passage that a lexical-only baseline demonstrably misses. Normal hybrid search retrieves both. Disabling semantic readiness returns available lexical evidence with an explicit degraded-search indicator rather than presenting it as hybrid-complete.
- Not acceptable: Lexical-only search presented as normal, vector-only search that misses exact technical terms, silent fallback, or requiring the caller to run two searches and combine them.

### R5. Selective agent recall

- Requirement: Agent integration must invoke session search on an explicit reference to prior discussion or clear continuation of an earlier plot, and must not search ordinary standalone turns without evidence that history matters. When continuity is merely suspected, the agent must ask a clarification and continue without waiting: it states the uncertainty, uses the safest reversible assumption for history-dependent work, and revises if the user's answer arrives.
- Source: V1, V4 and explicit PRD grill clarification.
- Rationale: Recall should prevent plot loss without adding latency and noise to every exchange or turning a clarification into a work-stopping gate.
- Acceptance: In a scenario containing explicit nudges, clear continuations, unrelated standalone turns, and uncertain continuity, searches occur for the first two and not for the unrelated turn; the uncertain case produces a concise clarification, records a safe reversible assumption, and continues work before any response arrives.
- Not acceptable: Searching every message, requiring one magic phrase, refusing to search when continuity is clear, blocking work on a pending history clarification, or making an irreversible choice from an unanswered assumption.

### R6. Concise cited recall and exact-moment inspection

- Requirement: Agent recall must produce a concise synthesis supported by one to three session citations, using the evidence returned by the service. Each citation must identify and open the exact supporting transcript moment, and the agent or user must be able to request a deeper excerpt. The human CLI may present cited evidence directly; it must not require an additional model just to inspect a search result.
- Source: V3.
- Rationale: A short answer is useful only when its evidence remains inspectable.
- Acceptance: Ask an agent a question spanning several sessions and receive a concise answer with one to three citations; every citation opens the correct source moment through MCP or CLI, and an expansion request returns surrounding transcript context.
- Not acceptable: An uncited synthesis, a default evidence dump, citations that identify only a file or session without the supporting moment, or excerpts that cannot be expanded.

### R7. Authenticated tailnet-wide access

- Requirement: Any authenticated tailnet agent must be able to search the complete included corpus through the MCP wrapper. Unauthenticated callers must be denied.
- Source: V6 and explicit PRD grill clarification.
- Rationale: Origin machine and agent identity must not recreate source silos inside the trusted tailnet.
- Acceptance: Authenticated agents on two tailnet machines can run the same corpus-wide MCP query and inspect its citations; an unauthenticated MCP request cannot search or inspect history.
- Not acceptable: Per-machine subsets, a second agent allowlist inside the authenticated tailnet, human-only access, anonymous history search, or requiring agents to log into the service host and invoke CASS directly.

### R8. Honest partial-source and retrieval degradation

- Requirement: When an included connected source is stale or only partially synchronized, search must return usable retained results together with a structured warning naming every known coverage gap. An offline source machine must not affect query availability for already synchronized sessions. The response must not claim that unsynchronized recent material is present. Deliberate exclusions define the included corpus; they are not synchronization failures.
- Source: V2, V8 and explicit PRD interview and grill decisions.
- Rationale: The locally served corpus should remain useful when source machines are offline, while its synchronization boundaries remain visible.
- Acceptance: Synchronize a remote source, take its machine offline, and search for its retained material plus material present elsewhere. Both return within the normal search contract. The MCP and CLI query responses themselves identify the offline source and its last successful synchronization, including for a query with no retained match; a warning available only through a separate health command is insufficient.
- Not acceptable: Query-time dependency on source machines, failing search because a remote is offline, silently implying that an offline source is current, or hiding a known synchronization gap.

### R9. Visible historical conflicts

- Requirement: When relevant sessions contain conflicting decisions or several plausible matches, recall must present the competing evidence with provenance. The agent must ask which choice governs only when resolving it changes the current work.
- Source: V7.
- Rationale: Session history records what happened; it must not silently rewrite the past into one confident answer.
- Acceptance: In one task where conflicting past decisions change the next action and one where they do not, both recalls show the conflict and citations; only the first asks a focused clarification.
- Not acceptable: Choosing the newest result silently, hiding disagreement, or interrupting the user to resolve irrelevant ambiguity.

### R10. Two-second hard search boundary

- Requirement: An ordinary search must deliver its first useful cited evidence or a truthful no-match outcome to the requesting MCP or CLI client within two seconds under normal operation, with sub-second retrieval as the target experience. Measure from query submission, including transport, queuing, and retrieval setup, not engine execution alone. A timeout is not an acceptable search outcome. Subsequent agent prose generation is separate from this retrieval boundary.
- Source: Explicit PRD interview decision; V1.
- Rationale: Recall that feels slower than ordinary conversation will be avoided or overused asynchronously.
- Acceptance: For every matching query in the representative corpus check, client-measured elapsed time to useful evidence is at most two seconds; genuine no-match queries complete within the same boundary. Include first and repeated requests to the ready service and report the normal-case distribution. A no-match outcome requires a completed search over the stated scope, not a timeout or unavailable retrieval path.
- Not acceptable: Excluding connection or archive-opening overhead, counting timeout responses as successful searches, turning incomplete retrieval into an empty no-match result, or replacing the hybrid search path with routine lexical-only results merely to meet the latency target.

### R11. Direct human CLI inspection

- Requirement: The user must be able to search the corpus, inspect source and index health, view citations, and open or expand exact transcript moments from a CLI without asking an agent.
- Source: V3, V4 and explicit PRD interview decision.
- Rationale: Direct inspection provides trust and a recovery path when agent synthesis is insufficient.
- Acceptance: From the CLI, the user can run a query, see provenance and health warnings, open a cited moment, and expand its surrounding transcript.
- Not acceptable: Agent-only recall, a CLI that returns opaque snippets without navigation, or requiring a web interface for evidence inspection.

### R12. Full-fidelity inclusion, exclusion, retention, and purge

- Requirement: Included sessions must preserve their searchable transcript content faithfully. The user must be able to exclude a source or individual session from search, disconnect a source without deleting its indexed sessions, and separately purge an individual session or an entire source from the corpus. A purged item must remain excluded from future indexing until the user explicitly re-includes it.
- Source: Explicit PRD interview and grill decisions; V2, V3.
- Rationale: A trusted shared corpus needs faithful evidence and deliberate lifecycle controls rather than deletion surprises or silently reappearing data.
- Acceptance: Exclude one session and verify corpus search, direct citation inspection, session-scoped queries, and resume packets no longer return its content while other sessions remain. Disconnect one source and verify its indexed history remains available. Purge one session and one source, run indexing again while their original logs still exist, and verify their content remains absent across those retrieval paths until explicitly re-included. Do not delete the original harness logs.
- Not acceptable: Silent redaction presented as full fidelity, disconnect-triggered deletion, no per-session exclusion, no explicit purge, automatic re-ingestion of purged material, deletion of harness-owned source logs, or a purge that leaves searchable excerpts or valid citations behind.

### R13. Session history remains distinct from memory and wiki knowledge

- Requirement: The product must search attributable session material without requiring promotion into agent memory or mixing synthesized external knowledge into session results.
- Source: V5.
- Rationale: What was said in a session, what should remain a standing judgment, and what was learned from external sources have different trust and lifecycle semantics.
- Acceptance: A fact present only in a session is searchable with session provenance before any memory promotion; wiki content does not appear as a session hit unless it was actually discussed in an indexed session.
- Not acceptable: Treating raw session history as standing memory, requiring memory writes for recall, or returning unattributed wiki synthesis as session evidence.

### R14. Resume prior work and query the selected session

- Requirement: When the user wants to continue prior work on a subject, the agent must find the relevant session and recover a focused resume packet: session identity, relevant excerpts, supported prior decisions, and unfinished work when recorded. The agent must also be able to query within that selected session and retrieve additional transcript context as needed, without loading the entire transcript or repeating a corpus-wide search.
- Source: V3, V4 and explicit PRD grill clarification.
- Rationale: Finding an old thread is only useful if the agent can pick up its actual work and inspect missing context without asking the user to reconstruct it.
- Acceptance: Start a fresh agent on an unfinished topic recorded in a past session. It identifies that session, uses a cited resume packet to recover the last supported state, then answers a follow-up requiring material outside the packet by querying that session directly. It distinguishes recorded unfinished work from its own proposed next action.
- Not acceptable: Returning only a session link, forcing the entire transcript into context, inventing prior decisions or unfinished work, treating a resume packet as exhaustive, or requiring the user to repeat context that is present in the selected session.

## Undesirable Outcomes

| Outcome | Decision | Requirement |
| --- | --- | --- |
| The caller chooses a machine before searching | Forbidden | R1 |
| One required harness remains a silo | Forbidden | R2 |
| Active sessions stay invisible until they end | Forbidden | R3 |
| Lexical-only fallback looks like normal hybrid search | Forbidden | R4 |
| Every ordinary turn triggers history search | Forbidden | R5 |
| Recall makes claims without exact supporting moments | Forbidden | R6 |
| Authenticated tailnet agents receive different corpus subsets | Forbidden | R7 |
| Unavailable sources disappear silently | Forbidden | R8 |
| Conflicting past decisions become one invented certainty | Forbidden | R9 |
| Search hangs beyond two seconds | Forbidden | R10 |
| The user cannot inspect evidence without an agent | Forbidden | R11 |
| Disconnecting a source destroys retained history | Forbidden | R12 |
| Purged or excluded material remains searchable | Forbidden | R12 |
| Session history becomes wiki-brain or standing memory | Forbidden | R13 |
| A thread is found but the agent cannot pick up its work or query more context | Forbidden | R14 |

## Scope Boundaries

### In Scope

- Unified local and remote-tailnet session search.
- Pi, OMP, Codex, and Claude session histories.
- Ongoing-session checkpoints and completed-session ingestion.
- Hybrid lexical and vector or embedding retrieval.
- Agent recall and direct human CLI inspection.
- Focused resume packets and targeted queries within a selected session.
- Exact session provenance, conflict visibility, freshness, source-health warnings, exclusions, disconnect retention, and explicit purge.

### Out Of Scope

- Wiki-brain ingestion or external knowledge synthesis.
- Automatic promotion of session content into agent memory.
- A browser, desktop GUI, mobile application, or mobile web surface; the CLI satisfies direct human inspection.
- Editing original harness session logs through this product.
- Requiring a particular embedding provider, fusion formula, or reranker beyond the observable hybrid-search behavior.

### Explicitly Deferred

- Connected cloud-chat ingestion is an explicit fast follow rather than a prerequisite for the first complete product. The acceptable current behavior is one corpus across the user's tailnet machines covering Pi, OMP, Codex, and Claude with the same provenance, freshness, search, and lifecycle guarantees. Cloud chats remain part of the approved ideal reality and should be added immediately after the core local and tailnet behavior works.
- Automated sensitive-information redaction is an explicit fast follow. The acceptable current behavior is full-fidelity indexing inside the trusted tailnet with user-controlled source and session exclusions plus explicit purge. Any later redaction must be visible and must not make altered evidence look like a full-fidelity citation.

## Success Criteria

- One unscoped MCP query to the designated CASS-backed tailnet service returns relevant, attributable sessions from its host and at least one other tailnet machine without contacting that source machine at query time.
- Known sessions from Pi, OMP, Codex, and Claude are searchable and openable at exact cited moments.
- Ongoing and newly completed session material becomes searchable by exact-term and meaning-equivalent queries within five minutes under normal operation.
- Normal search retrieves both exact language and meaning-equivalent paraphrases through one hybrid path; missing semantic retrieval is reported as degradation.
- Every representative matching search delivers useful cited evidence to the MCP or CLI caller within two seconds of query submission; genuine no-match searches complete in the same interval. Timeouts fail acceptance, and normal-case sub-second latency is reported.
- An explicit reminder or clear plot continuation yields concise recall with one to three citations; unrelated standalone turns do not trigger search.
- A connected-source outage returns healthy evidence plus a precise coverage warning.
- Disconnect preserves indexed sessions; exclusion hides selected material; explicit purge removes the selected session or source and its citations.
- Authenticated tailnet agents can search the same included corpus, while unauthenticated callers cannot.
- Conflicting historical decisions remain visible and attributable.
- A fresh agent can resume prior work from a focused cited packet and query the selected session for additional context without importing the whole transcript.

## Technical Questions Deferred To Spec

- How the authenticated MCP wrapper maps CASS search, pack, view, health, warning, and lifecycle operations into a stable agent contract without exposing shell access to the service host, including focused resume packets and targeted queries within one selected session. RLM-style exploration is a candidate approach, not a required implementation.
- How the search path always produces useful evidence or a truthful no-match outcome inside the two-second hard boundary, including warm-process behavior and refinement after the first result.
- How periodic local checkpoints and remote synchronization meet the five-minute freshness requirement.
- Which local or remote embedding provider, lexical index, fusion, and reranking configuration satisfies hybrid retrieval and the latency boundary. Before selecting an off-tailnet provider, identify what query or transcript data would leave the trusted tailnet and obtain the user's explicit approval for that disclosure; considering remote embeddings is not blanket permission to transmit the corpus.
- How source and individual-session exclusions and purges map onto the selected engine's lifecycle controls.
- How the sensitive-information redaction fast follow can use an appropriate model while preserving visible changes, explicit exclusions, purge, and citation honesty. A local open-source model is a candidate, not a settled choice.
- How agent integrations detect clear plot continuity without searching ordinary standalone turns.
- Whether existing Memex session inventory remains complementary, becomes an ingestion source, or is replaced for this use case.

## CASS Research And Validation Boundary

Research used the [upstream CASS documentation](https://github.com/Dicklesworthstone/coding_agent_session_search#readme). These are documented capabilities, not claims that this service already exists or meets the PRD. CASS was not found on this workstation's PATH; no live CASS performance measurements were taken.

- CASS documents connectors for Pi, OMP, Codex, and Claude, and remote-source pulls over SSH into a retained local archive. Its Tailscale discovery is not a tailnet search endpoint.
- CASS documents BM25 lexical retrieval and actual MiniLM embedding similarity combined with RRF. Semantic models require explicit installation, and unavailable semantic assets produce a reported lexical fallback. Alternative local or remote embeddings remain a spec decision; CASS's default model is not assumed to meet retrieval-quality needs.
- Its agent interface is a JSON CLI. `pack` supplies cited extractive evidence, not a complete narrative resume agent; the MCP service and agent integration must satisfy R6 and R14.
- Its advertised sub-60-millisecond figure describes engine search. Upstream separately documents roughly a second of one-shot archive-opening overhead on a roughly 10 GB archive. That does not prove the two-second client-visible requirement.
- Default scheduled indexing and semantic backfill are not proof of five-minute fresh hybrid retrieval. Active-file safety, local indexing, remote synchronization, and vector catch-up need end-to-end evidence.
- Source removal, path exclusions, and `forget` are documented primitives. They do not by themselves prove that purged sessions stay excluded or that all retrieval paths honor exclusion.

## Approval

- Approved by: User
- Approved on: 2026-09-15
- Approval evidence: Chat instruction to start building the CASS-backed service
- Amendment rule: This PRD changes only by explicit user request or direct user edit.
