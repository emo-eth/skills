---
name: wall-clock
description: Use when the user gives a deadline or time budget, asks for wall-clock planning, bounded agent assignments, wrap-up behavior, or explicit shortcut and risk reporting. Keeps work inside a time ceiling with start, status, check, assignment, completion, and report operations.
compatibility: The optional MCP tools require a client that loads mcp.json and Node.js 22.6 or newer. Host-level tool blocking remains client-specific.
---

# Wall clock

## Glossary

- **Wall clock**: Real elapsed time measured against a duration or a local-time deadline.
- **Session key**: The stable identifier passed to the MCP tools for one conversation or work run.
- **Hard deadline**: The time after which new work must not start.
- **Wrap-up**: The period before the hard deadline when new delegation and destructive work stop.
- **Delegation bias**: Prefer as many bounded child assignments as can reduce uncertainty or finish independent work faster; do not delegate merely to fill the budget.
- **Assignment**: A bounded unit of work recorded under the main session.
- **Inline batch delegation**: One parent task call that carries several child tasks, with one bounded assignment contract per item.
- **Do-it-now lane**: A fixed host-enforced execution window for one explicit request.
- **Wrap-it-up lane**: A fixed two-minute host-enforced execution window for finishing the active task.
- **Host guard**: Native plugin enforcement that limits time, delegation, and ordinary tool calls.

## Operating contract

Use wall-clock control only when the user gives a deadline, gives a duration, or asks for time-bounded planning. Keep sessions without an explicit time boundary unchanged.

The explicit `/do-it-now` skill is the exception: on a supported native Pi or
OMP host, its invocation starts a fixed 2-minute host guard with
`abort-running`, bounded delegation encouraged, and a 12-call ordinary-tool
limit. Do not call portable wall-clock tools to start that lane. The guard
clears after the host reports that the agent run has fully settled. If the
deadline expires first, it stays active through any post-run continuation so
blocked work cannot bypass expiry.

The explicit `/wrap-it-up` skill is the second fixed lane: on a supported
native Pi or OMP host, its invocation starts a two-minute host guard with
`abort-running`, bounded delegation encouraged while the phase is active, and
a 12-call ordinary-tool limit. Do not call portable wall-clock tools to start
that lane. The guard clears after the host reports that the agent run has fully
settled. If the deadline expires first, it stays active through any post-run
continuation so blocked work cannot bypass expiry.

When the phase is active, decide how many bounded child assignments are useful.
For each child, provide one objective, narrow scope, observable acceptance
target, and a budget below the parent's measured remaining time. Use inline
batch delegation when several independent children should start together.
Nested delegation remains unavailable until its lifecycle contract is proven.
During wrap-up, do not start new delegation or destructive work; finish and
report the smallest current acceptance target.

An explicit `/wallclock` activation and the native `wallclock_start` tool use
the same terminal-settlement cleanup. The host keeps the contract through
retries, continuations, expiry blocking, and abort handling. If a child action
is still running, cleanup waits for that child to finish. After settlement, a
normal follow-up needs no `/wallclock stop`; start a new contract if the
follow-up needs its own time limit.

The budget is a ceiling, not a target. Finish when the acceptance target is met. Do not spend unused time on extra scope.

The portable Agent Plugins package can provide tools and instructions. It cannot, by itself, intercept every client tool call, cancel arbitrary work, or stop a remote action. Say when a result is model guidance only.

## Start a time boundary

When the user gives a duration such as `30m` or a local time such as `5pm`:

1. Create a short session key and reuse it for every wall-clock call in this run.
2. If a native `wallclock_start` is available, call it with the exact duration or local time, the user's selected `block-new` or `abort-running` policy, and the current plan when one exists. Use `block-new` when the user does not select a policy.
3. Read the returned phase and remaining time. State the hard deadline and the wrap-up point in the working plan.
4. If activation is unavailable or rejected, do not create a guidance-only wall-clock session. Tell the user that this host cannot enforce the requested policy.

A local-time deadline uses the host's local timezone. If the user names another timezone, convert it before starting or mark the conversion as unresolved.

## Before new work

Before an assignment, write, destructive action, or long operation:

1. Call `wallclock_status` when the tool is available.
2. Call `wallclock_check` with the proposed tool name, action class, input, and assignment key when an explicit decision is useful. Never estimate task duration.
3. If the result denies the action, do not start it. Move to wrap-up, reporting, or a smaller safe action.
4. Prefer as many bounded delegated assignments as useful for independent work while the phase is active. Use one inline batch when several children should start together. Do not start delegation during wrap-up.
5. After expiry, start no new tool work. Report the current state and any work that remains.

The check is not a host gate. A supported Pi or OMP native adapter enforces the same decision at its pre-tool event. Portable MCP alone refuses activation.

## Bound an assignment

Create an assignment only when the main session has an active wall-clock window:

1. Set one objective and list the allowed scope.
2. Define the acceptance target as observable output, not effort.
3. Set `budgetMs` below the parent's remaining time. Include `wrapUpMs` when the child needs a separate closeout period.
4. Call `wallclock_assign` and keep the returned assignment identifier.
5. Pass the objective, scope, acceptance target, and remaining budget to the child through the host's supported child-session mechanism. The portable plugin does not create a child session by itself.

If the child meets the acceptance target early, complete it. Do not turn the unused budget into extra work. OMP binds one unbound assignment to each task child. Pi does not create a native child through this package. Do not claim a hard child limit on an unsupported path.

## Complete and report

Call `wallclock_complete` as soon as the assignment is complete, partial, blocked, or expired. Then call `wallclock_report` with:

- completed work and evidence;
- partial work and skipped work;
- validation that ran and validation that did not run;
- every shortcut and its tradeoff;
- risks and unknowns;
- one recommended parent action.

Keep partial output usable. Never report cancellation unless the host executor confirmed that it stopped the action. An already-running tool or remote action may continue after the local deadline.

## Native host adapters

The package root also contains Pi and OMP adapters in `src/pi.ts` and `src/omp.ts`. When a supported host loads those entry points, the adapter restores version 3 session state, injects measured time, observes tool and child results, and enforces its pre-tool decision.

Under `abort-running`, the adapter rejects unknown or unabortable executors before they start. It records cancellation only after a correlated native result reports an abort. Native support does not imply that another Agent Plugins client has the same enforcement boundary.
