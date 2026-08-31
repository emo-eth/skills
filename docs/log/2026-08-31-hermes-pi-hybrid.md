# Hermes and Pi Hybrid Architecture

## Status

Proposed and unimplemented. This assessment recommends a reversible integration experiment; it does not make Hermes a required dependency or change the current Pi Bots runtime. No runtime or skill code changed in this analysis session.

## Problem

Hermes Agent v2026.8.31 ships a mature Bot Mode with canonical per-bot chats, attributed asynchronous DMs, bounded group conversations, routines, unread state, presence, and cross-machine routing. Pi Bots supplies persistent named roles, exclusive domain ownership, private memory, owner-written shared state, and `pi-subagents` execution, but intentionally has no chat transport, inbox, resident dispatcher, or bot-centric UI.

The product choice is whether to rebuild Hermes-style infrastructure around Pi, fork or port Hermes, or run Hermes beside Pi without replacing Pi as the coding harness.

## Recommendation

Use Hermes as an optional Bot conversation and coordination control plane. Keep Pi as the only repository execution harness.

The architectural invariant is:

> Hermes may converse, coordinate, and schedule. Only Pi may modify repositories.

Hermes Bots invoke Pi through one narrow worker interface backed by `pi --mode rpc`. Pi remains independently usable when Hermes is absent; only the Bot conversation and routine layer becomes unavailable.

```text
Hermes Desktop and gateway
  canonical chats, DMs, groups, routines, unread state
                         |
                         v
                  pi-worker bridge
                         |
                         v
                    pi --mode rpc
  Pi extensions, hooks, skills, tools, subagents, worktrees
```

Do not copy the Hermes Desktop plugin or gateway. Borrow protocol semantics such as canonical chat identity, attributed messages, bounded group rounds, typed delivery failures, and idempotency.

## Why RPC is the seam

Pi RPC is designed for embedding Pi in other applications. It provides structured JSONL commands and events rather than terminal scraping, including:

- prompt, steer, follow-up, and abort;
- session identity, state, transcript access, and resumption;
- agent, turn, message, and tool lifecycle events;
- queued continuation control;
- extension UI request and response messages.

A plain `pi -p` subprocess is sufficient only for a disposable proof. The maintained bridge should supervise Pi RPC processes and expose a small interface:

```text
pi.start(bot, repository, task, sessionKey) -> runId
pi.status(runId)
pi.steer(runId, message)
pi.abort(runId)
pi.result(runId)
```

The bridge owns allowed repository roots, worktree selection, bot identity, session mapping, correlation IDs, concurrency, timeouts, process cleanup, artifact references, and error translation. Hermes must not receive a generic command or arbitrary environment interface.

## Extension and lifecycle boundary

Pi and Hermes extensions are host-specific:

- Pi extensions are TypeScript or JavaScript and consume Pi session, model, tool, and lifecycle events.
- Hermes runtime plugins use Python middleware; Hermes Desktop plugins use TypeScript against `@hermes/plugin-sdk`.
- Hook names, payloads, storage, session identity, UI capabilities, and cancellation semantics differ.
- The existing `plugins/no-code-comments/hermes/` adapter demonstrates a separate Hermes `pre_tool_call` implementation. `docs/log/2026-08-28-hermes-extension-porting.md` records that more lifecycle-heavy features such as wall-clock are not mechanical ports.

A Pi RPC worker still loads global Pi extensions and skills. Trusted project settings and extensions load under Pi's normal project-trust rules. Their model and tool hooks execute inside Pi. `pi-subagents`, Pi Bots, provider configuration, project context, and repository policies therefore remain effective.

TUI-only Pi extension surfaces degrade in RPC mode. Dialog-style extension UI requires the bridge to implement Pi's RPC extension-UI protocol or fail closed and report that the run needs user attention.

No Pi coding policy needs a Hermes port while Hermes profiles cannot modify repositories directly. Hermes-specific adapters remain necessary only for Hermes-side concerns such as profile policy, DM authorization, routine behavior, and chat delivery.

## State authority

Avoid bidirectional synchronization:

- `BOTS.yml` owns work roles, domain ownership, Pi models, tools, skills, delegates, and execution policy.
- Generated minimal Hermes profiles own presentation, canonical chats, group membership, unread state, and routine triggers.
- Pi sessions own coding transcripts and execution state.
- Pi Bot private memory and `.pi/team-context/` remain durable work truth.
- Hermes history remains conversational context, not a second domain-state store.

Generate Hermes profile metadata one way from `BOTS.yml`. Do not maintain the same routine in Hermes and Pi schedules. For Hermes Bot work, Hermes triggers and Pi executes; unrelated Pi-native schedules may remain independent.

## Rejected alternatives

### Fork or copy Hermes

Hermes is MIT licensed, so copying is legally permitted when its license notice is preserved. The implementation is nevertheless tightly coupled to Hermes profiles, gateway RPC, Desktop state, workspace/session atoms, and `@hermes/plugin-sdk`. Forking creates permanent upstream merge work across both the TypeScript Desktop and Python runtime.

### Rebuild Bot Mode in Pi immediately

A Pi-native implementation must add a chat store, dispatcher, asynchronous delivery, unread fallback, group orchestration, schedule-to-chat delivery, process supervision, and a central UI. This remains a valid exit route if the bridge proves operationally poor, but it should not precede the reversible experiment.

### Let Hermes edit repositories

This makes Hermes a second coding harness and requires native ports of every enforcement or lifecycle extension that must govern its tools. It violates the single-executor invariant and is rejected.

## Effort

Estimates are one experienced engineer's person-time and include focused behavioral verification.

| Deliverable | Realistic effort |
| --- | ---: |
| Disposable Hermes to `pi -p` proof | 1–2 days |
| One Hermes Bot using structured Pi RPC | 3–5 days |
| Reliable local bridge with resume, steer, abort, errors, logs, and artifacts | 1–2 weeks |
| Multi-Bot asynchronous execution, worktree locks, crash recovery, and completion delivery | 2–4 weeks |
| Usable Pi-native chat, DM, routines, and minimal UI | 4–5 weeks |
| Fuller Pi-native Hermes Bot Mode parity | 9–12 weeks |
| Forked Hermes Bot Mode and backend | 2–3 months initially, then continuing merge maintenance |

Expected hybrid maintenance is concentrated in the Pi RPC adapter, Hermes invocation adapter, cancellation/error mapping, and compatibility checks after either dependency updates. It avoids maintaining a second copy of repository-facing extensions.

## Reversible spike

Implement one local Engineering Bot with no groups or routines:

- [ ] Give the Hermes profile only conversational tools and a `pi-worker` tool.
- [ ] Start Pi RPC in one explicitly trusted repository and selected worktree.
- [ ] Pass a correlation ID and stable `(bot, repository)` session key.
- [ ] Verify expected global and project Pi extensions load.
- [ ] Complete one real repository task through Pi.
- [ ] Stream structured progress and the final result to Hermes.
- [ ] Steer one active run.
- [ ] Abort one active run and verify process cleanup.
- [ ] Resume the same Pi session from a Hermes follow-up.
- [ ] Return artifact paths without copying repository state into Hermes.
- [ ] Confirm Hermes cannot invoke direct repository-writing tools.
- [ ] Remove the adapter and confirm Pi and Pi Bots remain unaffected.

Do not add groups, routines, profile synchronization, or an always-on bridge daemon until this interaction is accepted.

## Open questions

1. Should long-running work block a Hermes tool call, return a run ID for polling, or inject an asynchronous completion into the canonical Bot Chat?
2. Should Pi extension approval requests render in Hermes, or fail closed and create a needs-attention event for later resumption?
3. Should Pi sessions persist per `(bot, repository)` or be isolated per work item with explicit continuation links?
4. Should the bridge allocate isolated worktrees or require a caller-selected worktree?
5. Should Hermes profile memory remain strictly conversational while Pi Bot memory remains work-oriented, or should Hermes profile memory be disabled for mirrored Bots?
6. Is Hermes Desktop sufficient initially, or must its gateway run continuously for routines and remote delivery?
7. Which profile fields are generated from `BOTS.yml`, and which remain intentionally Hermes-local?

## Independent review

Kimi K3 and GLM-5.3-Flash independently recommended the hybrid rather than a Hermes fork or immediate Pi-native rebuild. Kimi emphasized Pi-owned state and a removable adapter. GLM emphasized one scheduler, correlation IDs, structured cancellation, and testing the reversible bridge before committing to either runtime. Direct inspection of Pi RPC corrected the weaker plain-subprocess assumption: RPC preserves structured lifecycle, steering, abort, session continuity, and extension UI requests.
