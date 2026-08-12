# Wall Clock Plugin Decisions

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

## D14 - 2026-08-12 - Give do-it-now two minutes

Decision: The native do-it-now lane uses a two-minute hard deadline, `abort-running`, no delegation, and 12 ordinary tool calls.
Why: Ninety seconds leaves too little margin for host and model startup plus one slow external operation. Two minutes remains a hard ceiling while keeping the lane focused.
Alternatives: Keep 90 seconds (rejected because it is too brittle for simple updates); remove the hard limit (rejected because it would recreate the delay this lane is meant to prevent).
Consequences: The native host, bundled skills, documentation, and focused host test all use the two-minute limit. The existing 15-second pre-deadline interval is unchanged.
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
