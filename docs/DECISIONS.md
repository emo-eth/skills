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

## D36 - 2026-08-13 - Fail closed on ambiguous host correlations

Decision: Native wall-clock enforcement uses an explicit allowlist for control tools. It rejects pre-action events without a stable session scope, duplicate active action identifiers, unknown child lifecycle links, and batch child lifecycle events without a valid index. Lifecycle and action correlation state is bounded.

Why: A stale session fallback, broad tool prefix, or ambiguous child event can attach enforcement to the wrong action or let work escape its deadline. Failing closed preserves the contract even when host metadata is incomplete or malformed.

Alternatives: Keep the prior fallback behavior (rejected because it can enforce another session's state); accept arbitrary wall-clock-prefixed tools as control tools (rejected because extensions can bypass expiry checks); retain unbounded correlation maps (rejected because long-lived sessions can accumulate stale host identifiers).

Consequences: Unsupported or malformed host events are blocked and reported through the existing host boundary. Valid child lifecycle events continue to correlate by parent action and batch index. The bounded map capacity blocks new admitted work until stale actions finish.

Status: active
Scope: v0
Load-bearing: yes

## D37 - 2026-08-13 - Add persistent turn-limit mode

Decision: Add a native `/wallclock turn-limit <duration>` mode and matching
`mode: "turn-limit"` activation field. The mode keeps the owner contract
active after terminal settlement and resets its hard deadline to the configured
duration for the next terminal agent turn. `/wallclock set <duration>` and
`wallclock_set` update the active duration in either mode without discarding
the plan, assignments, or reports. The existing deadline mode and default
`block-new` policy remain unchanged.

Why: The user wants a repeatable per-turn ceiling, such as two minutes, that
does not require reactivation after every turn and can be changed or cleared
explicitly.

Alternatives: Make every activation persistent (rejected because it changes
the existing one-shot contract); require stop and restart for every duration
change (rejected because it adds avoidable state loss and ceremony); reset at
every internal `turn_end` event (rejected because retries and continuations
make it narrower than a terminal agent turn).

Consequences: Turn-limit requires a duration, not a local-time deadline.
Existing child assignment deadlines remain fixed and are never extended by a
parent turn reset. State version 4 stores the mode and configured duration;
version 3 state fails closed and is not migrated.

Status: active
Scope: v1
Load-bearing: yes

## D38 - 2026-08-13 - Start turn-limit windows at user-turn start

Decision: A `turn-limit` owner window ends at terminal agent settlement and
remains armed without a running owner deadline until the next normal user
message begins. That message starts a fresh configured-duration window.
Steering messages do not reset or extend the current deadline. Child assignment
deadlines remain independent.

Why: Resetting at terminal settlement starts the next budget before the user
has sent the next request. It spends idle time and lets a later steer message
inherit an incorrectly refreshed deadline.

Alternatives: Reset at terminal settlement (rejected because it starts the
clock too early); reset on every user message (rejected because steering
messages would extend a running turn); reset at every internal `turn_end`
(rejected because retries and continuations are not terminal owner turns).

Consequences: The host clears the owner deadline timer at settlement and
rearms it on the next normal owner message. Status can remain active while the
owner contract is armed; the next user message restores the full duration.

Status: active
Scope: v1
Load-bearing: yes

## D39 - 2026-08-13 - Turn summaries ship on main as a native plugin

Decision: Ship the current turn-summary implementation on `main` as an Agent Plugins package. The native Pi and OMP adapters append a fixed end-of-turn summary reminder through the host `context` seam; `/summary on|off` toggles the reminder for the current process. The package makes no model call and has no UI or MCP surface.

Why: The user asked to put the renamed turn-summary plugin in `main` after confirming that the prior branch was not merged.

Consequences: New Pi and OMP processes can load `plugins/turn-summary/` from the canonical checkout. The reminder text currently says to keep the summary under 400 words; that limit is prompt guidance, not a runtime-enforced or user-configurable setting.

Source: user chat message, 2026-08-13
Status: active
Scope: v0
Load-bearing: no


## D40 - 2026-08-14 - Ship a native bug capture command

Decision: Add `plugins/bug-command/` as a command-only Agent Plugin for Pi and
OMP. `/bug [--plugin <name>] [--skill <name>] <bug description>` appends one
context-rich JSON record to `~/BUGS.md`, or to `BUGS_PATH` when configured.
The record includes repository, worktree, branch, folder, host, model, session
metadata, turn metadata, recent activity, and the note. It does not copy full
prompts or event payloads.

Why: The user wants a Yearn-shaped capture command for bugs, with the same
low-ceremony native-command shape as `/skiterate`, but the output needs enough
local session and turn context to debug plugins, skills, and applications
after the original turn is gone.

Alternatives: Make it a skill wrapper (rejected because the host command seam
can capture session and lifecycle metadata that a later skill invocation
cannot); reuse Yearn (rejected because wishes and bugs have different
records); capture full prompts and events (rejected because it increases
privacy risk and makes the log hard to scan).

Consequences: Automatic plugin attribution is best effort and stays null when
the host does not expose a plugin marker. The explicit `--plugin` and
`--skill` flags remain available. Turn numbers are host-provided when
available, otherwise lifecycle-order hints.

Source: user chat message, 2026-08-14
Status: active
Scope: v0
Load-bearing: no

## D41 - 2026-08-14 - Add a fast native plugin builder skill

Decision: Publish `skills/agent-plugin/SKILL.md` as the default workflow for
building small native Pi and OMP Agent Plugins. It starts with a minimal
vertical slice, reuses the nearest existing package, keeps adapters thin,
captures only bounded context, proves both adapters, separates source tests
from live host proof, and hands installed OMP work to
`omp-plugin-iteration`.

Why: The bug-command build repeated package, host seam, record, test, state,
and live-proof decisions. The user asked for a reusable skill so the next
tool does not pay that setup cost again.

Alternatives: Extend `omp-plugin-iteration` (rejected because that skill
starts after a plugin exists and focuses on reinstall and restart); add a
large code generator (rejected because plugin behavior and record shapes vary,
and a generator would create stale scaffolding).

Consequences: Future native plugin work has a named fast path and explicit
proof boundary. The skill is model-invoked for native Pi or OMP plugin
requests. It is documented; the isolated cold-reader attempt was blocked by
the host lifecycle gate, and the skill is not yet field-tested on a second
plugin.

Source: user chat message, 2026-08-14
Status: active
Scope: v0
Load-bearing: no

## D42 - 2026-08-28 - Keep wall-clock operations native-only

Decision: Remove wall-clock's root `mcp.json`, standalone MCP server, and MCP
operation tests. Keep the Agent Plugins manifest and bundled skill, while Pi
and OMP native adapters expose the sole wall-clock operation catalog.

Why: OMP discovers both Agent Plugin MCP servers and native extension tools
from one installed package. Shipping both exposed duplicate wall-clock
operations with different session state and enforcement semantics, while the
MCP `wallclock_start` could not activate an enforced deadline. The user
reported the duplicate catalog and directed that it be fixed.

Alternatives: Disable the MCP server in one local OMP profile (rejected because
the package would remain broken for every other install); rename the MCP tools
(rejected because two non-equivalent catalogs would remain); remove the native
tools (rejected because only the native adapter can enforce the contract).

Consequences: Agent Plugin clients can still discover the wall-clock
instructions. Unsupported clients have no operation surface. Supported Pi and
OMP sessions expose only native tools backed by the host session and
pre-action gate. D9 remains true as a statement about the Agent Plugins
standard, but this package no longer exercises its optional MCP component.

Source: user chat message, 2026-08-28
Status: active
Scope: current
Load-bearing: yes
