---
date: 2026-08-11
topic: wall-clock
status: draft
source_material: Existing wall-clock research, design, implementation, and Agent Plugins 1.0.0 specification
---

# Glossary

- **Wall clock**: Real elapsed time measured against a duration or a local-time deadline.
- **Session**: One agent conversation or work run with its own time state.
- **Parent session**: The session that owns the overall plan and can give work to child sessions.
- **Child session**: A session working on a bounded assignment from a parent session.
- **Assignment**: A defined piece of work with an objective, allowed scope, acceptance target, and time ceiling.
- **Acceptance target**: The smallest observable result that counts as complete.
- **Wrap-up**: The period before the deadline when new risky or expanding work stops and the current result is prepared.
- **Hard deadline**: The point after which new work must not start.
- **Shortcut**: A deliberate reduction in scope, method, or validation, with its tradeoff stated.
- **Host enforcement**: A runtime action that blocks or stops work.
- **Elapsed-time context**: The measured total elapsed time, latest inference or tool-call elapsed time, current clock time, and remaining time supplied to the agent at each turn.
- **Expiry policy**: The selected rule for work admitted when the deadline arrives: block new work or abort running wall-clock-owned work.
- **Vertical slice**: The smallest working end-to-end result that remains useful when full scope is not complete.

# Wall-clock Vibe

## Vibe Promise

Wall clock should feel like a calm, enforced guardrail around agent work. At every turn, the agent should know the current time, total elapsed time, latest inference or tool-call elapsed time, and remaining time. Every activated limit must have a host mechanism that enforces it; if the selected harness cannot enforce the limit, wall-clock must not activate there. When it is not active, it should disappear and leave ordinary work unchanged.

## Ideal Reality Dump

- I can give the main session a duration such as 30 minutes or a local-time deadline such as 5:00pm.
- The parent session has a plan, and child sessions receive bounded pieces instead of vague requests to "look into it."
- A time budget is a ceiling, not a reason to keep working. A short task ends when it is done.
- As time contracts, the agent reduces scope deliberately and produces a working vertical slice rather than a misleading partial surface.
- The agent can see whether the session is active, in wrap-up, expired, or complete without reconstructing it from logs.
- A child can return a useful vertical slice with evidence, skipped validation, shortcuts, risks, and unknowns.
- I can choose whether expiry blocks only new work or also aborts running work, and the selected policy is enforced by the host.
- Reloading or resuming does not erase the deadline or mix one session's state with another's.
- A session without an explicit wall-clock boundary feels exactly like ordinary work.
- The plugin helps the agent finish the work; it does not become a second project-management system that demands attention for its own sake.

## Use Circumstances

- A user is working toward a fixed meeting, handoff, deploy window, or end of day.
- A parent session is dividing a plan among several child sessions.
- The agent must choose between more investigation and a working vertical slice.
- A session is reloaded, resumed, compacted, or moved between supported host states.
- The agent needs current and actual elapsed-time context at every turn without guessing task duration.
- A child finishes early, becomes blocked, reaches wrap-up, or needs an enforced abort at expiry.
- The wall clock is inactive and the user has not asked for time-bounded work.

## Vibe Clauses

### V1. Calm precision

- Promise: Time pressure should make the next decision clearer, not make the work feel frantic.
- Means: At every turn, the agent receives current time, total elapsed time, latest inference or tool-call elapsed time, remaining time, current phase, acceptance target, and next enforced action.
- Does not mean: A constantly changing user-facing timer, noisy reminders, or a demand that the agent estimate task duration.
- Violation: The agent reaches a deadline with no enforced next action or must guess how long its current work has taken.
- Check: Inspect active, wrap-up, and expiry turns. Each must contain measured elapsed-time context and an enforceable next action.

### V2. The budget is a ceiling

- Promise: A budget limits work; it never creates work.
- Means: The agent can finish as soon as the acceptance target is met, even when substantial budget remains.
- Does not mean: The system should cut off useful work before the acceptance target or reward the agent for filling the allotted time.
- Violation: A child continues investigating after it has produced the requested result because its budget has not been consumed.
- Check: Give a child a small task with a large remaining budget and verify that completion ends the assignment without extra scope.

### V3. Compression stays honest

- Promise: When time contracts, the result becomes smaller before it becomes misleading.
- Means: The agent preserves a working vertical slice, names shortcuts and skipped validation, and separates evidence from assumptions.
- Does not mean: Every result must be complete, or that reduced validation can be hidden to make the output look finished.
- Violation: The agent silently skips a check, reports a partial result as complete, or removes the evidence needed to understand the tradeoff.
- Check: Force a deadline during incomplete work and inspect whether the report names the completed vertical slice, skipped work, risks, and unknowns.

### V4. Enforcement or no activation

- Promise: An activated limit always has a host mechanism that enforces it.
- Means: The selected harness can block new work, abort running work when selected, or refuse activation when it cannot enforce the requested policy.
- Does not mean: Every expiry policy must abort running work. The user chooses whether to block new work only or abort running work.
- Violation: A timer, prompt, or status message is used as a substitute for a host block or abort.
- Check: Attempt activation with each expiry policy on each target harness. The supported policy is enforced; an unsupported policy is rejected.

### V5. Invisible when inactive

- Promise: Users who did not ask for time-bounded work should not carry wall-clock overhead.
- Means: No deadline context, gating, assignment rules, or status noise changes an inactive session.
- Does not mean: The package must be absent from the client; it can be installed and ready while remaining dormant.
- Violation: An inactive session receives time warnings, has ordinary tools blocked, or is required to provide a session key.
- Check: Compare an inactive session with the same host before installation. The ordinary workflow should remain unchanged.

### V6. Continuity without mystery

- Promise: Reloading or resuming preserves the time contract without making the user guess which state was restored.
- Means: The session keeps its own deadline, plan, assignments, reports, revision, and current phase, and malformed state fails locally.
- Does not mean: Timers must survive as live processes or that unrelated sessions share recovery state.
- Violation: A resumed session silently loses its deadline, restores another session's assignment, or reports a stale phase as current.
- Check: Restore a session after time has advanced and verify the new phase and remaining time are derived from the current clock.

### V7. Bounded delegation

- Promise: Delegation narrows responsibility instead of multiplying uncertainty.
- Means: Every assignment names one objective, allowed scope, acceptance target, actual elapsed-time accounting, ceiling, and report shape. Parent and child agents receive current and actual elapsed-time context at every turn. The agent does not estimate task duration.
- Does not mean: Wall clock must create every child session or expose a host's private implementation.
- Violation: A child receives only a vague topic, a guessed estimate, and a deadline, then returns output that cannot be connected to the parent's plan.
- Check: Review an assignment and its report without reading the child's full transcript. The parent should know what landed, how long it took, and what to do next.

## Anti-Vibes

| Anti-vibe | Why it violates the contract | Clause |
| --- | --- | --- |
| Enforcement theater | It makes a prompt or timer look like a hard stop and turns a deadline into "hurry up." | V4 |
| Frantic timer noise | It moves attention from the work to the clock and makes pressure harder to manage. | V1 |
| Budget as quota | It turns a guardrail into an incentive for unnecessary work. | V2 |
| Silent compression | It hides the cost of a deadline and makes partial work unsafe to reuse. | V3 |
| Ambient overhead | It punishes users who did not activate time-bounded work. | V5 |
| State mystery | It makes resume and recovery feel less reliable than starting over. | V6 |
| Vague delegation | It shifts uncertainty to child sessions without creating a usable parent result. | V7 |

## Success Signals

- A user can state a duration or local-time deadline and the main session can use it without learning the internal data model.
- At every turn, the agent has measured total elapsed time, latest inference or tool-call elapsed time, current time, remaining time, and actual assignment elapsed time.
- A supported harness enforces the selected expiry policy, and an unsupported harness refuses activation instead of falling back to guidance.
- A child that meets its acceptance target returns control early instead of creating extra work.
- A compressed result includes a working vertical slice, evidence, and an explicit account of skipped validation, shortcuts, risks, and unknowns.
- Inactive sessions remain ordinary, and separate active sessions do not share state.
- It works and is possible: the supported Pi and OMP paths are driven end to end and observed enforcing the promised limits.

## Approval

- Approved by:
- Approved on:
- Amendment rule: This vibe changes only by explicit user request or direct user edit.
