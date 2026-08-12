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
- **Assignment**: A bounded unit of work recorded under the main session.
- **Acceptance target**: The smallest result that counts as complete for an assignment.
- **Shortcut**: A deliberate reduction in scope, method, or validation, with its tradeoff recorded.
- **Model guidance**: Instructions the model may follow; the host does not enforce them.
- **Host enforcement**: A client event or executor mechanism that blocks or stops work.

## Operating contract

Use wall-clock control only when the user gives a deadline, gives a duration, or asks for time-bounded planning. Keep sessions without an explicit time boundary unchanged.

The budget is a ceiling, not a target. Finish when the acceptance target is met. Do not spend unused time on extra scope.

The portable Agent Plugins package can provide tools and instructions. It cannot, by itself, intercept every client tool call, cancel arbitrary work, or stop a remote action. Say when a result is model guidance only.

## Start a time boundary

When the user gives a duration such as `30m` or a local time such as `5pm`:

1. Create a short session key and reuse it for every wall-clock call in this run.
2. If `wallclock_start` is available, call it with the session key, the exact duration or local time, and the current plan when one exists.
3. Read the returned phase and remaining time. State the hard deadline and the wrap-up point in the working plan.
4. If the tool is unavailable, record the deadline in the plan and treat all checks as model guidance. Do not claim that the host will block work.

A local-time deadline uses the host's local timezone. If the user names another timezone, convert it before starting or mark the conversion as unresolved.

## Before new work

Before an assignment, write, destructive action, or long operation:

1. Call `wallclock_status` when the MCP tool is available.
2. Call `wallclock_check` with the proposed tool name, action class, estimate, and assignment key when the estimate or risk matters.
3. If the result denies the action, do not start it. Move to wrap-up, reporting, or a smaller safe action.
4. During wrap-up, do not start delegation or destructive work. Finish the smallest current acceptance target and report it.
5. After expiry, start no new tool work. Report the current state and any work that remains.

The check is not a host gate. A client-specific native adapter may enforce the same decision at a pre-tool event; a portable MCP client may only expose the decision for the model to follow.

## Bound an assignment

Create an assignment only when the main session has an active wall-clock window:

1. Set one objective and list the allowed scope.
2. Define the acceptance target as observable output, not effort.
3. Set `budgetMs` below the parent's remaining time. Include `wrapUpMs` when the child needs a separate closeout period.
4. Call `wallclock_assign` and keep the returned assignment identifier.
5. Pass the objective, scope, acceptance target, and remaining budget to the child through the host's supported child-session mechanism. The portable plugin does not create a child session by itself.

If the child meets the acceptance target early, complete it. Do not turn the unused budget into extra work. If the host cannot pass a hard budget or abort signal, classify the timing as model guidance.

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

The package root also contains Pi and OMP adapters in `src/pi.ts` and `src/omp.ts`. When a supported host loads those entry points, the adapter can restore session state, inject remaining time, observe tool results, and enforce its pre-tool decision. Those adapters are outside the portable Agent Plugins core and must not be treated as evidence that another client has the same enforcement boundary.
