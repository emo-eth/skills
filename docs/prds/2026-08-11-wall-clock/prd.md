---
date: 2026-08-11
topic: wall-clock
status: draft
source_vibe: docs/prds/2026-08-11-wall-clock/vibe.md
---

# Glossary
- **Wall clock**: Real elapsed time measured against a duration or a local-time deadline.
 
- **Session**: One agent conversation or work run with its own wall-clock state.
- **Parent session**: The session that owns the overall plan and can give work to child sessions.
- **Child session**: A session working on a bounded assignment from a parent session.
- **Assignment**: A defined piece of work with an objective, allowed scope, acceptance target, and time ceiling.
- **Acceptance target**: The smallest observable result that counts as complete.
- **Phase**: The current time state: inactive, active, wrap-up, expired, or complete.
- **Wrap-up**: The period before the hard deadline when new risky or expanding work stops and the current result is prepared.
- **Hard deadline**: The point after which new work must not start.
- **Expiry policy**: The explicit choice between blocking new work after expiry and aborting running wall-clock-owned work at expiry.
- **Shortcut**: A deliberate reduction in scope, method, or validation, with its tradeoff stated.
- **Host enforcement**: A runtime action that blocks or stops work.
- **Elapsed-time context**: Measured total elapsed time, latest inference or tool-call elapsed time, current clock time, remaining time, and actual assignment elapsed time.
- **Portable plugin**: The package of reusable instructions and optional MCP tools discoverable through the Agent Plugins format.
- **Native adapter**: Host-specific integration that can use a client's session, context, tool, and child lifecycle events.
- **Vertical slice**: The smallest working end-to-end result that remains useful when full scope is not complete.
- **Abort signal**: A host signal sent to an owned running action that its executor accepts and obeys to stop the action.

# Wall-clock PRD

## North Star

A user can give a supported agent session a real time boundary and trust the host to enforce it. At every turn, the parent and child agents receive measured elapsed-time context and the next permitted action. Delegated work narrows to observable outcomes, produces a working vertical slice when scope contracts, and returns evidence before the deadline. If a selected harness cannot enforce the requested expiry policy, wall-clock refuses activation instead of becoming a more forceful way to say "hurry up."

## Source Vibe Summary

- Ideal reality: Time is an enforced ceiling around agent work; parent and child agents know current and actual elapsed time at every turn; compressed work produces a working vertical slice; inactive sessions are unchanged.
- Feel promises: Calm precision (V1), ceiling not quota (V2), honest vertical-slice compression (V3), enforcement or no activation (V4), inactive by default (V5), continuity without mystery (V6), and bounded delegation (V7).
- Anti-vibes: Enforcement theater, frantic timer noise, budget-as-quota behavior, silent compression, ambient overhead, state mystery, and vague delegation.

## Users And Jobs

- **User directing the work**: Choose a duration or local-time deadline and an expiry policy, then receive a result whose limits were actually enforced.
- **Parent session**: Turn an overall plan into bounded assignments, see actual elapsed time at every turn, and revise the remaining work from child reports.
- **Child session**: Complete one acceptance target early when possible, see its actual elapsed time at every turn, and return a vertical slice with evidence and tradeoffs.
- **Host maintainer**: Provide a tested enforcement seam for the selected harness and reject activation when that seam is unavailable.

## Product Shape

- **Entry points**: Explicit activation with a duration, local-time deadline, and required expiry policy; status and stop actions; bounded assignment and report actions; and native host integrations.
- **Core flow**: Select a supported harness -> activate one session and expiry policy -> receive elapsed-time context every turn -> create bounded assignments -> admit only host-approved actions -> complete or report the vertical slice -> revise the parent plan -> finish or stop.
- **Required surfaces**: Activation, status, elapsed-time context, enforced action admission, assignment, completion, report, persistence and restore, and a visible activation failure when the requested policy cannot be enforced.
- **Harness expectations**: Pi and OMP are the first enforcement targets. Codex and Claude are considered only for the portable Agent Plugins package and open extension surfaces; Claude proprietary systems are out of scope. A client without a tested native enforcement seam must not activate wall-clock.
- **Plugin expectations**: Agent Plugins requires a root manifest. Skills and MCP are optional components. Wall-clock may expose an MCP control surface, but MCP is never required for enforcement and never replaces a native adapter.
- **Data visibility expectations**: A session sees its own time contract and reports. A parent sees its assignments and child reports. A child sees only its assignment and elapsed-time context. Unrelated sessions do not see or change this state.

## Requirements

### R1. Explicit activation and inactive isolation

- Requirement: The system must remain inactive until the user or parent session explicitly starts wall-clock control for one session and selects an expiry policy. Starting or installing the package must not change ordinary work in other sessions.
- Rationale: Time control is a user-selected constraint, and a limit without enforcement is not useful.
- Acceptance: With no activation, ordinary tools, context, and workflow remain unchanged. Activation succeeds only when the selected harness can enforce the chosen policy. After activation, only the selected session has wall-clock state.
- Not acceptable: An installed package adds deadline instructions to every session, activates guidance-only behavior, or blocks ordinary work that has no active time contract.

### R2. Clear deadline semantics and phases

- Requirement: The system must accept a positive duration or a future local-time deadline and represent active work, wrap-up, expiry, and completion as distinct states.
- Rationale: The agent needs to know whether it may continue, must compress, must report, or must stop starting work.
- Acceptance: A started session reports its deadline, remaining time, wrap-up point, expiry policy, and current phase. A completed assignment reports completion without being treated as expired.
- Not acceptable: A single boolean such as "timer on" hides whether work is still admitted, whether risky work is allowed, which expiry policy is active, or whether an assignment is complete.

### R3. Per-turn elapsed-time context

- Requirement: Before every model turn, the host must provide the parent and child agents with current time, total elapsed time, latest inference elapsed time, latest tool-call elapsed time, remaining time, current phase, and actual elapsed time for the current assignment. The system must measure these values; agents must not estimate task duration.
- Rationale: A deadline system is only useful when the agent can make decisions from current measured state instead of guessing.
- Acceptance: A turn-context record contains all required elapsed-time fields. Assignment reports include actual elapsed time. No activation or tool contract asks the agent to predict how long a task will take.
- Not acceptable: The agent receives only a deadline, receives stale time context, or is asked to supply an estimated duration before work starts.

### R4. Enforced action admission

- Requirement: Before every new tool or child action, the host must classify the action and enforce the current phase and expiry policy at the pre-action boundary. During wrap-up it must reject new delegation and destructive actions. After expiry it must reject all new work.
- Rationale: The pre-action boundary is the point where the host can prevent an action from starting. Classification is required to distinguish actions that remain safe during wrap-up from actions that expand risk or scope.
- Acceptance: A supported host rejects disallowed actions before execution and returns a reason. The decision is always host-enforced; there is no guidance-only fallback. The action check does not rely on an agent-provided duration estimate.
- Not acceptable: A prompt, timer, or MCP response is treated as a hard stop, a destructive action starts during wrap-up, or a new tool starts after expiry.

### R5. Bounded assignments

- Requirement: A parent session must be able to define an assignment with one objective, allowed scope, acceptance target, time ceiling, wrap-up point, current status, and actual elapsed-time accounting.
- Rationale: Delegation must reduce uncertainty and give the child and parent a shared stopping rule.
- Acceptance: An assignment can be inspected without the child transcript and still tells the reviewer what to do, what counts as done, how much time has passed, and how much time remains.
- Not acceptable: A child receives only a topic, an agent-estimated duration, or a deadline with no observable acceptance target or report contract.

### R6. Early completion without extra scope

- Requirement: A child or parent must be able to mark an assignment complete as soon as its acceptance target is met, regardless of unused budget.
- Rationale: The budget is a ceiling, not a work quota.
- Acceptance: Completing an assignment changes its status to complete and the host rejects new assignment work for it. Unused time returns to the parent plan rather than becoming extra investigation.
- Not acceptable: The system encourages a child to keep working until the budget expires or treats unused time as evidence of an incomplete result.

### R7. Structured vertical-slice reports

- Requirement: An assignment report must identify the completed vertical slice, evidence, partial work, skipped work, validation, shortcuts and tradeoffs, risks, unknowns, actual elapsed time, and one recommended parent action.
- Rationale: A compressed result is useful only when the parent can see what works and what it can safely rely on.
- Acceptance: Complete, partial, blocked, and expired assignments can each produce a report with a working vertical slice or a precise reason why none exists. A parent can revise the remaining plan from that report.
- Not acceptable: A partial result is reported as complete, skipped validation is omitted, actual elapsed time is unknown, or the report has no evidence and no next action.

### R8. Durable state and session isolation

- Requirement: The system must preserve the time contract, expiry policy, plan, assignments, reports, revision, and stopped state through supported reload or resume behavior, and must keep state keyed to one session.
- Rationale: Losing a deadline or mixing sessions makes time control less trustworthy than no control.
- Acceptance: Restoring after time advances recomputes the current phase and remaining time from the current clock. A second session remains inactive and cannot read or alter the first session's state.
- Not acceptable: A reload silently resets the deadline, restores stale phase data without recomputation, or exposes one session's reports to another.

### R9. Enforced target-harness support

- Requirement: Wall-clock must support the selected Pi and OMP enforcement paths first. Codex and Claude may load the portable package, but wall-clock must refuse activation there until an open, tested enforcement seam exists. Claude proprietary systems are excluded.
- Rationale: The product must work as an enforced tool, not as guidance that only says "hurry up."
- Acceptance: Each target harness has a support entry naming its enforcement mechanism, failure mode, and test evidence. Unsupported activation fails closed with a clear reason.
- Not acceptable: A client is called supported because it can load `SKILL.md` or `mcp.json` while it cannot block or abort the requested work.

### R10. Optional portable packaging

- Requirement: The reusable capability must be discoverable as an Agent Plugins-compatible package with a valid root manifest and Agent Skill. MCP may be included as an optional control and inspection surface. Native runtime behavior must remain separate from the portable core.
- Rationale: The plugin standard makes shared packaging possible, but it does not make MCP or skills enforcement mechanisms.
- Acceptance: A compatible client can discover the package and load the skill. If it supports MCP, it can connect to the optional control surface. Wall-clock enforcement does not depend on either component alone.
- Not acceptable: The manifest claims that MCP is required by the standard, a portable skill is presented as a pre-action hook, or a package is activated on a client that has no enforcement adapter.

### R11. Explicit in-flight expiry policy

- Requirement: Activation must require one of two expiry policies: `block-new`, which enforces the deadline by rejecting new work while admitted work may finish, or `abort-running`, which enforces the deadline by rejecting new work and aborting every wall-clock-owned running action at expiry. The host must reject `abort-running` when an admitted action has no abortable executor.
- Rationale: The user must decide whether reaching the deadline ends only admission or also ends running work. The product must enforce the selected choice rather than silently choosing for the user.
- Acceptance: The selected policy is visible in status and reports. `block-new` never claims that running work stopped. `abort-running` emits and observes an abort signal for every owned running action, or rejects the action before it starts when cancellation cannot be enforced.
- Not acceptable: The product silently changes policies, reports an in-flight action as cancelled without an observed abort, or allows an unabortable action under `abort-running`.

### R12. Parent plan revision

- Requirement: A parent session must be able to use assignment reports to mark remaining plan items complete, partial, blocked, or deferred and to record the revision that changed the plan.
- Rationale: Time contraction changes what remains; a report without plan revision leaves the parent with stale obligations.
- Acceptance: After a child report, the parent can identify which plan items changed, the actual elapsed time, and the recommended next action.
- Not acceptable: Child output is stored separately but the parent plan continues to imply that all original work remains due.

## Undesirable Outcomes

| Outcome | Decision | Requirement |
| --- | --- | --- |
| Inactive sessions change behavior | Forbidden | R1 |
| The budget creates extra work | Forbidden | R6 |
| Partial work is presented as complete | Forbidden | R7 |
| A prompt, timer, or MCP response substitutes for enforcement | Forbidden | R4, R9, R10 |
| Agents are asked to estimate task duration | Forbidden | R3, R5 |
| A resumed session loses or mixes deadline state | Forbidden | R8 |
| Wall-clock activates on an unsupported harness | Forbidden | R9 |
| An in-flight action violates the selected expiry policy | Forbidden | R11 |
| A child has no observable acceptance target | Forbidden | R5 |

## Scope Boundaries

### In Scope

- Explicit activation for a duration or local-time deadline and a required expiry policy.
- Active, wrap-up, expired, and complete phase behavior.
- Measured per-turn elapsed-time context for parent and child agents.
- Host-enforced action admission and, when selected, host-enforced abort of running owned work.
- Status, assignments, completion, structured vertical-slice reports, and parent plan revision.
- Durable, session-isolated state through supported reload and resume paths.
- Agent Plugins packaging with a required root manifest, Agent Skill, and optional MCP surface.
- Pi and OMP native adapters as the first enforcement targets.
- Codex and Claude portable package loading without activation until open enforcement seams are tested.

### Out Of Scope

- Claude proprietary systems.
- Automatic creation of child sessions by the portable package.
- A universal hook or command component in the Agent Plugins core.
- Activation on a client that can provide only model guidance.
- Cancellation of remote work without a provider-specific abort mechanism.
- Client-specific marketplace, authentication, permission, and user-interface policy.

### Explicitly Deferred

- Codex and Claude wall-clock activation until an open, tested enforcement seam exists. The acceptable current behavior is package discovery without wall-clock activation.
- Per-child hard runtime injection on a host that does not expose a supported child executor setting or abort signal. The acceptable current behavior is refusing activation for policies that need that enforcement.
- A portable visual dashboard. The acceptable current behavior is enforced per-turn context and host status surfaces.

## Success Criteria

- A user can start a 30-minute or local-time wall-clock window with an explicit expiry policy on a supported Pi or OMP path.
- Every parent and child turn includes measured current time, total elapsed time, latest inference elapsed time, latest tool-call elapsed time, remaining time, and actual assignment elapsed time.
- A supported host blocks wrap-up and expired actions before execution.
- `abort-running` is tested against an abortable executor, and `block-new` is tested without falsely claiming cancellation.
- A parent can create a bounded assignment and receive a vertical-slice report that supports a plan revision.
- A child can finish early without extra scope and return a working vertical slice with explicit tradeoffs.
- Portable Agent Plugins package checks prove that MCP is optional and that the skill remains discoverable without treating it as enforcement.
- A session without activation behaves like ordinary work.
- It works and is possible: the supported Pi and OMP paths are driven end to end and observed enforcing the promised limits.

## Contract Checks

- Pi and OMP are the first enforcement targets.
- Codex and Claude are package targets only until open enforcement seams are proven.
- Claude proprietary systems are not a target.
- MCP is optional in the Agent Plugins standard and is not an enforcement dependency.
- Activation always requires a host-enforced expiry policy.
- The user selects whether expiry blocks new work only or aborts running wall-clock-owned work.

## Approval

- Approved by:
- Approved on:
- Amendment rule: This PRD changes only by explicit user request or direct user edit.
