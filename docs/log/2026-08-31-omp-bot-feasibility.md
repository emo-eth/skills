# OMP Bot Runtime Feasibility

## Status

Analysis-only and unimplemented. Installed OMP v18.0.11 source, its bundled SDK examples, the in-repository native OMP runner proof, and a live `rpc-ui` smoke were inspected to decide whether OMP can be the programmable execution kernel behind the harness-neutral personal Bot organization.

## Verdict

Yes. OMP is the recommended first execution kernel, not because it should own the Bot control pane.

Both Pi and OMP are flexible agent SDKs. OMP is the better first worker runtime for this product because it combines per-session prompt, model, skill, rule, tool, extension, memory, workspace, and persistence configuration with built-in Task agents, spawn restrictions, subagent observability, agent lifecycle, and live peer delivery.

OMP does not provide the durable Bot product. Its agent registry, IRC mailboxes, wake routing, and Agent Hub are process-global and run-centric. They are not canonical Bot identity, offline inboxes, durable handoffs, group rooms, routines, or persistent needs-you state. A harness-neutral Bot daemon must own those concepts and a separate TUI may own the entire human-facing chat surface.

Recommendation: define Bots independently, compile each Bot and run into explicit OMP SDK session options, and expose durable Bot communication as host-owned tools. Keep OMP behind a narrow worker adapter so Pi or another harness can implement the same contract later.

## Verified OMP executor contract

### RPC lifecycle

`src/modes/rpc/rpc-types.ts` defines structured commands for:

- `prompt`, `steer`, `follow_up`, `abort`, and `abort_and_prompt`;
- `get_state`, model and thinking selection, and queue modes;
- `switch_session`, branching, handoff, message retrieval, and session naming;
- host-provided tools and URI schemes;
- subagent subscription, roster snapshots, and transcript reads.

`src/modes/rpc/rpc-client.ts` exposes typed `prompt`, `steer`, `followUp`, `abort`, `getState`, `switchSession`, `getSubagents`, and `getSubagentMessages` operations. It supports local or custom process transports, working directories, environment, session directories, and host-owned custom tools.

A live smoke against `omp --mode rpc-ui --no-session --no-tools --no-extensions --no-skills` emitted the ready frame, extension UI frames, available-command updates, and a successful correlated `get_state` response.

### SDK embedding and exact Bot configuration

OMP's bundled SDK guide describes `createAgentSession()` as the programmatic runtime entry point. `CreateAgentSessionOptions` supports:

- working directory and additional workspace roots;
- explicit `agentDir`, auth storage, model registry, model, fallback patterns, thinking level, and deadline;
- replacement, modification, or appended system prompts;
- exact tool allowlists, restricted tools, caller-supplied custom tools, inline extensions, and extension discovery controls;
- explicit skills, rules, context files, prompt templates, and slash commands;
- MCP, LSP, IRC, structured output, spawn depth, and approval controls;
- caller-assigned agent ID and display name, shared agent registry, event bus, and subagent event bus;
- custom session managers, including bundled JSONL, Redis, and SQLite/PostgreSQL/MySQL storage adapters;
- Hindsight and Mnemopi state inherited by subagents.

Static OMP `AgentDefinition` manifests cover `name`, `description`, system prompt, tools, allowed spawns, model, thinking level, output schema, blocking behavior, autoloaded skills, read policy, prewalk, and advisor. They are useful compiled subagent templates, but they are not the canonical Bot specification.

The repository's `plugins/no-code-comments/tests/native-omp-runner.bun.ts` is first-hand proof of the embedding seam. It creates an OMP session with an isolated agent directory and session manager, explicit extension path, disabled discovery, MCP, and LSP, empty skills, rules, and context, then initializes the native `ExtensionRunner`. The extension injects system prompt policy, registers a command, receives UI context, and rewrites tool input before execution.

OMP RPC remains useful for process isolation. Its host can replace host-owned tool definitions at runtime, serve custom URI schemes, stream agent and subagent events, and carry extension approval requests to an external UI. A maintained adapter can therefore use a small OMP SDK worker process rather than terminal scraping or a permanent fork of OMP.

### Human approval and extension UI

`src/modes/rpc/rpc-types.ts` defines request frames for `select`, `confirm`, `input`, `editor`, `cancel`, `notify`, `setStatus`, `setWidget`, `setTitle`, editor text, and URL opening. `src/modes/rpc/rpc-mode.ts` implements `RpcExtensionUIContext`; `rpc-ui` supplies that context to extensions and tools with UI capability enabled. A Bot UI can therefore surface approvals instead of auto-approving or dropping them.

### Profiles

Profile bootstrap occurs before modules resolve the agent directory. Named profiles resolve under `~/.omp/profiles/<name>/agent`; session resume hints preserve the profile name, and user resource discovery uses the active profile's agent directory. This is sufficient to isolate a Bot-organization runtime from the default interactive OMP profile. Profile-wide auth/cache isolation was not separately traced in this audit and should not be relied on until verified.

### Task agents and lifecycle

`src/registry/agent-registry.ts` models agents as `running`, `idle`, `parked`, or terminally `aborted`. A parked agent retains its identity and session file. `src/registry/agent-lifecycle.ts` revives parked agents on demand, while persisted-agent registration reconstructs historical subagents from session transcripts.

RPC can subscribe to subagent lifecycle, progress, and event frames and read subagent transcripts. Task outputs, patches, branches, cost, tokens, tools, and duration remain linked to the agent reference.

## Harness choice

Pi is also programmable enough to implement this design. Its installed SDK documentation exposes `createAgentSession`, prompt replacement, explicit custom tools, extensions, skills, context, session managers, event subscriptions, and custom run modes. Pi is the smaller and less opinionated kernel.

OMP adds the multi-agent plumbing this product would otherwise have to rebuild around Pi: declarative agent roles, spawn policy, Task execution, nested-agent persistence and revival, shared registry, live peer delivery, subagent event forwarding, output schemas, structured yields, and an existing operational Agent Hub.

Decision:

- use Pi if minimizing runtime policy and owning every orchestration primitive is more important than implementation time;
- use OMP if the goal is to specify the organization precisely while reusing mature subagent execution and observability;
- for this project, use OMP first behind an adapter and keep the Bot specification independent.

## UI boundary

OMP does not need to be the human control pane. A separate TUI can talk only to the Bot daemon and render canonical Bot chats, groups, work, routines, approvals, and needs-you state.

The daemon can translate OMP RPC `extension_ui_request` frames into TUI dialogs and return the correlated response. OMP's built-in Agent Hub remains an optional live-run debugger with agent status, unread IRC counts, transcripts, prompt/steer input, revival, and abort controls. The product must not depend on private Agent Hub classes.

## Concrete inter-agent communication

OMP's communication is not merely a nested Task return. `src/irc/bus.ts` defines attributed messages with stable IDs, sender, recipient, body, timestamp, and optional `replyTo`.

Delivery behavior is explicit:

- parked recipients are revived;
- idle recipients are woken for a real turn;
- busy recipients receive the message at a step boundary;
- a waiting recipient consumes the message directly;
- replies can be awaited;
- failed live handoffs are buffered;
- each agent mailbox is capped at 100 messages.

`src/session/irc-bridge.ts` injects incoming messages as attributed `irc:incoming` custom messages and persists them through the recipient session path. The sender's tool call remains in its own transcript.

The limitations are load-bearing:

- `IrcBus` and `AgentRegistry` are process-global;
- mailboxes are in-memory maps, not an offline durable queue;
- successful delivery enters the recipient session immediately and is not retained as unread mailbox state;
- the Hub's `to: all` broadcast is not a durable group thread;
- messages depend on one OMP process and its registered or revivable agent tree.

Therefore OMP IRC is the live-delivery adapter, not the Bot message store.

## Durable protocol the Bot core must own

The Bot core needs an explicit message and work contract independent of Pi, OMP, or Hermes.

### Threads and messages

```text
Thread
  id
  kind: user-dm | bot-dm | group
  members
  createdAt

Message
  id
  threadId
  senderBotId | user
  body
  createdAt
  replyTo
  causationId
  idempotencyKey
  workItemId

Delivery
  messageId
  recipientBotId
  state: queued | claimed | delivered | failed | acknowledged
  attempt
  runId
  failureReason
```

Sending commits the message and delivery rows before any agent wakes. A dispatcher claims delivery idempotently, ensures the recipient's canonical OMP session is available, then uses OMP RPC or live Hub transport. Replies are committed to the thread before the UI is notified. A process crash therefore cannot erase accepted messages.

### Work and attention

```text
WorkItem
  id
  requester
  ownerBotId
  status: proposed | accepted | active | blocked | completed | failed
  acceptanceCriteria
  parentWorkItemId
  threadId
  runIds
  artifactRefs

Attention
  id
  kind: approval | decision | failure | blocked | completed
  botId
  threadId
  workItemId
  state: unread | read | resolved
```

A handoff is a state transition plus a message, not prose that the receiving model may ignore. Needs-you is durable attention state, not a transient chat phrase.

### Groups

A group has durable membership and one transcript. A send calculates mentioned recipients, applies hop and round caps, records pass/respond decisions, and appends every response to the same thread. OMP broadcast may deliver live wakeups, but it does not define the room.

## OMP-first runtime architecture

```text
Independent TUI
  chats, groups, work, routines, approvals, needs-you
                         |
                         v
Bot daemon and durable core
  Bot specs, SQLite messages/deliveries/work/runs/memory refs
  dispatcher, scheduler, attention state, session mapping
                         |
                         v
OMP worker adapter
  compiles BotSpec into createAgentSession options
  exposes Bot communication as host tools
  streams events, approvals, artifacts, and results
                         |
                         v
OMP agent runtime
  models, prompts, skills, rules, tools, extensions,
  Task agents, worktrees, sessions, memory backends
```

Run the worker adapter as a supervised process for fault isolation, but let it import OMP's SDK instead of limiting configuration to CLI flags. The adapter can initially wrap stock OMP RPC where it suffices and move only missing dynamic configuration into the SDK worker.

A persistent Bot is not an OMP Task agent. Bot identity, domain, permissions, memory, inbox, and history survive runtime replacement. An OMP Task agent is an execution instance or subordinate role created for a run. The daemon maps durable Bot and work IDs to OMP session and AgentRef IDs without making either runtime identifier authoritative.

Do not force every Bot into one eternal root transcript to preserve OMP IRC. Long-lived conversational sessions and short-lived work-item sessions can coexist; durable messaging and memory reconnect them.

## Human UI requirements

The first useful UI is not a command list and need not run inside OMP. It needs:

- a persistent sidebar for the personal agent, Bots, DMs, and groups;
- latest-message preview, unread count, status, and needs-you marker;
- a central durable transcript and composer;
- explicit work-item cards with owner and state;
- approvals that answer OMP RPC UI requests and resume the run;
- routine history and next-run state;
- artifact and execution-event views;
- an optional deep link or attach action for native OMP run inspection.

The independent TUI should consume the Bot daemon's stable protocol, never OMP session files directly. This keeps the human surface unchanged if a Bot or subagent later executes in Pi.

## Gaps and risks

1. OMP's SDK is broader and faster-moving than its wire protocol. Pin the runtime version and maintain adapter conformance tests.
2. The Bot specification must stay narrower than `CreateAgentSessionOptions`; leaking every OMP field into the product schema would make OMP the accidental domain model.
3. Worker processes and routines require supervision when no interactive harness is open.
4. Bot sessions need explicit workspace and worktree policy across multiple repositories.
5. RPC approvals need durable correlation so a process restart does not orphan a pending decision.
6. OMP IRC cannot be treated as durable delivery or group history.
7. Persistent Bots and ephemeral Task agents must remain distinct identities.
8. Cross-machine routing remains a separate transport adapter.

## Effort

One experienced engineer's person-time, including focused behavioral verification:

| Deliverable | Realistic effort |
| --- | ---: |
| Bot core schemas, durable messages, deliveries, work, and attention | 4–7 days |
| Bot manifest compiler and isolated OMP SDK worker adapter | 4–7 days |
| Separate TUI protocol and chat/work/approval surface | 2–3 weeks |
| Routines, crash recovery, bounded groups, and process supervision | 2–4 weeks |
| Usable OMP-first vertical slice | 4–6 weeks |
| Later Pi execution adapter against the stable core | 1–2 weeks |
| Cross-machine transport and polished desktop UI | separate follow-on |

## Recommended sequence

1. Define a narrow `BotSpec`, durable message/work schemas, and harness adapter contract.
2. Build an isolated OMP worker that constructs sessions through `createAgentSession`.
3. Prove one personal agent and one Engineering Bot with different prompts, skills, tools, model policy, memory, and allowed subagents.
4. Expose durable `send`, `inbox`, `accept_work`, `complete_work`, and `needs_you` tools to both.
5. Prove offline delivery, live wake, reply persistence, steer, abort, resume, and approval through the daemon.
6. Build the independent TUI against the daemon protocol.
7. Add routines and bounded groups only after DMs and handoffs survive worker restart.
8. Add the Pi adapter after the OMP vertical slice proves the harness boundary.

## Open questions

1. Which fields belong in the stable `BotSpec`, and which remain OMP adapter configuration?
2. Should canonical sessions be keyed by `(bot, conversation)`, `(bot, project)`, or isolated work item with explicit continuation?
3. Which runs need an isolated process versus a shared OMP worker and agent registry?
4. How should pending approvals and tool calls resume after worker restart?
5. Which memory belongs to the Bot, a conversation, a project, or one execution session?
6. Should the optional run inspector attach through OMP RPC or remain a diagnostic-only native OMP launch?
7. When the Pi adapter arrives, which OMP-specific orchestration behavior must the control plane emulate?
