# OMP Bot Control-Plane Feasibility

## Status

Analysis-only and unimplemented. Installed OMP v18.0.11 source and a live `rpc-ui` smoke were inspected to decide whether the harness-neutral personal Bot organization can use OMP as its first executor and human UI host.

## Verdict

Yes. OMP can support the Bot system and is a stronger first host than Pi for an OMP-native human experience.

OMP already provides the difficult executor and live-agent primitives: structured RPC, session switching, steering, abort, profile-scoped state, Task subagents, parked-agent revival, attributed peer messages, persisted child transcripts, unread counts, and a runtime Agent Hub with per-agent chat. Those capabilities reduce the first OMP adapter and live-run UI substantially.

OMP does not yet provide the product's durable control plane. Its agent registry, IRC mailboxes, and wake routing are process-global and run-centric. They are not canonical Bot threads, an offline inbox, group rooms, a durable work queue, routines, or a persistent needs-you surface. The harness-neutral core must own those concepts.

Recommendation: build a harness-neutral Bot core with an OMP-first adapter and OMP-first human UI. Treat OMP's Agent Hub as the linked live-run inspector, not as the database of record. Add a Pi executor adapter later without moving Bot identity, messages, work, or routines.

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

### Human approval and extension UI

`src/modes/rpc/rpc-types.ts` defines request frames for `select`, `confirm`, `input`, `editor`, `cancel`, `notify`, `setStatus`, `setWidget`, `setTitle`, editor text, and URL opening. `src/modes/rpc/rpc-mode.ts` implements `RpcExtensionUIContext`; `rpc-ui` supplies that context to extensions and tools with UI capability enabled. A Bot UI can therefore surface approvals instead of auto-approving or dropping them.

### Profiles

Profile bootstrap occurs before modules resolve the agent directory. Named profiles resolve under `~/.omp/profiles/<name>/agent`; session resume hints preserve the profile name, and user resource discovery uses the active profile's agent directory. This is sufficient to isolate a Bot-organization runtime from the default interactive OMP profile. Profile-wide auth/cache isolation was not separately traced in this audit and should not be relied on until verified.

### Task agents and lifecycle

`src/registry/agent-registry.ts` models agents as `running`, `idle`, `parked`, or terminally `aborted`. A parked agent retains its identity and session file. `src/registry/agent-lifecycle.ts` revives parked agents on demand, while persisted-agent registration reconstructs historical subagents from session transcripts.

RPC can subscribe to subagent lifecycle, progress, and event frames and read subagent transcripts. Task outputs, patches, branches, cost, tokens, tools, and duration remain linked to the agent reference.

## Existing human UI

OMP's built-in runtime Agent Hub is materially closer to the requested surface than Pi's current run tooling. `src/modes/components/agent-hub.ts` provides:

- a roster of registered agents with status, unread IRC count, activity, and recency;
- tree and operational views;
- a per-agent transcript viewer;
- a per-agent input line that prompts or steers the agent;
- parked-agent revival;
- abort and release;
- direct focus into a live agent session.

It is opened from the configured Agent Hub key, session-observe key, or a double-tap of left arrow on an empty editor. `/agents` is a separate fullscreen manager for agent definitions and their model/settings overrides.

This UI is a live agent/run surface. It does not provide persistent Bot DM and group rows, a work queue, routine history, or global needs-you state. The Bot UI should link into it for a run rather than duplicate its transcript and lifecycle controls.

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

## OMP-first architecture

```text
Bot Core
  SQLite: bots, threads, messages, deliveries,
          work_items, runs, routines, attention
                |
                v
OMP Adapter
  RPC sessions, Task agents, IRC wakeups,
  steer, abort, resume, approvals, artifacts
                |
                v
Human UI
  persistent Bot/thread sidebar and chat
  work, routines, approvals, unread/needs-you
                |
                +--> OMP Agent Hub for live run inspection
```

Use one named OMP profile for the Bot organization and one durable root session hosting stable Bot subagents. Separate top-level OMP processes per Bot would lose the process-global IRC and Agent Hub advantages. The Bot database remains authoritative so this topology can change later.

## Human UI requirements

The first useful UI is not a command list. It needs:

- a persistent sidebar for Bots, DMs, and groups;
- latest-message preview, unread count, status, and needs-you marker;
- a central durable transcript and composer;
- explicit work-item cards with owner and state;
- approvals that answer OMP RPC UI requests and resume the run;
- routine history and next-run state;
- artifact links;
- one action to open the linked OMP Agent Hub run.

Implement the first UI as an OMP-native TUI adapter if the extension surface can host the required fullscreen layout without private imports. If that spike exposes a shallow or unstable UI seam, keep the core and OMP executor adapter and move the persistent UI to a local web or desktop client over the same database.

## Gaps and risks

1. The built-in Agent Hub is internal OMP code; depending on private classes would create upgrade coupling.
2. A plugin must prove it can render the required persistent split-pane surface through public extension UI.
3. A root OMP process must be supervised if Bots and routines should wake while no interactive session is open.
4. Bot sessions need explicit workspace and worktree policy across multiple repositories.
5. RPC approvals need durable correlation so a process restart does not orphan a pending decision.
6. OMP IRC cannot be treated as durable delivery or group history.
7. The Task-agent tree is rooted in one main session; database identity must not depend on transient AgentRef IDs.
8. Cross-machine routing remains a separate transport adapter.

## Effort

One experienced engineer's person-time, including focused behavioral verification:

| Deliverable | Realistic effort |
| --- | ---: |
| Bot core schemas, durable messages, deliveries, work, and attention | 4–7 days |
| OMP executor adapter with canonical sessions, RPC lifecycle, and live IRC wakeups | 4–7 days |
| OMP-native persistent Bot/thread/chat UI spike | 3–5 days |
| Usable OMP TUI with unread, needs-you, work cards, approvals, and Agent Hub links | 2–3 weeks |
| Routines, crash recovery, bounded groups, and process supervision | 2–4 weeks |
| Usable OMP-first vertical slice | 4–6 weeks |
| Later Pi execution adapter against the stable core | 1–2 weeks |
| Cross-machine transport and polished desktop/web UI | separate follow-on |

## Recommended sequence

1. Define the durable message, delivery, work, run, and attention schemas.
2. Build one Engineering Bot under a dedicated OMP profile and root session.
3. Prove user DM, Bot-to-Bot DM, offline queued delivery, live IRC wake, reply persistence, steer, abort, resume, and approval.
4. Build the persistent OMP Bot sidebar and transcript, linking active runs to Agent Hub.
5. Add one handoff and one needs-you flow.
6. Add routines and bounded groups only after DMs survive process restart.
7. Add the Pi adapter after the OMP vertical slice proves the core interface.

## Open questions

1. Can the public OMP extension UI host the desired fullscreen persistent layout without importing internal Agent Hub classes?
2. Should the Bot root run in the interactive OMP process or a launchd-supervised RPC process with the TUI attaching as a client?
3. Should one canonical OMP session exist per `(bot, project)` or per Bot with explicit workspace switching?
4. How should pending approvals be resumed after process restart?
5. Which OMP Agent Hub actions should be linked versus reproduced in the Bot UI?
6. When the Pi adapter arrives, should Pi be execution-only or also receive a native Bot UI?
