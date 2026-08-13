# Wall Clock Plugin Design

## Glossary

- **Agent Plugins**: The portable package format for Agent Skills and optional Model Context Protocol servers.
- **MCP**: Model Context Protocol, used as an optional operation surface but never as the enforcement boundary.
- **Pi**: The `@earendil-works/pi-coding-agent` host.
- **OMP**: The `@oh-my-pi/pi-coding-agent` host.
- **WallClockController**: The host-independent module that owns time contracts, plans, assignments, reports, timing, and action decisions.
- **Time contract**: The issue time, hard deadline, wrap-up time, selected expiry policy, and current phase for one session or assignment.
- **Action class**: The category used at the pre-action gate: read, write, destructive, delegate, finalize, or other.
- **Expiry policy**: The required choice between blocking new work at expiry and also aborting supported running work.
- **Abort domain**: One native host session controlled by one session-wide abort function.
- **Owner session**: The parent host session that owns and persists a wall-clock contract.
- **Child binding**: The stable relation between one native child session and one parent assignment.
- **Child session registry**: A process-wide map from OMP's real child session paths to the parent coordination state. It bridges OMP task children because OMP 17.2.15 does not pass the parent event-bus object into the child.
- **Native yield**: OMP's required child-completion tool. A wall-clock child must report before this completion step.
- **Vertical slice**: The smallest working end-to-end result that remains useful after scope is reduced.
- **State version 3**: The current durable state shape. Older and malformed entries are rejected without migration.

## Design rule

The common controller is the deep module. Native adapters translate Pi and OMP events into its small interface and do not duplicate deadline rules. The package stays inert until explicit activation.

Agent Skills and MCP can describe or expose the contract, but they cannot intercept arbitrary host actions. Only a tested native adapter can activate wall-clock.

## Module boundaries

`src/controller.ts` owns:

- activation, stop, phase, and remaining-time calculations;
- plan validation and revision history;
- assignment validation, deadlines, status, and measured elapsed time;
- action classification and phase decisions;
- running-action timing and abort request or observation records;
- structured child reports.

`src/host.ts` owns:

- stable native session scope;
- context injection before model turns;
- native pre-action admission;
- deadline timers;
- executor abort requests and observed results;
- OMP parent and child coordination;
- host-session persistence and restore.

`src/pi.ts` and `src/omp.ts` define the tested native enforcement capabilities. `src/mcp.ts` exposes optional portable operations and refuses activation.

## Time and phase model

```text
inactive -> active -> wrap-up -> expired
             |          |
             +----------+-> complete
```

- `inactive`: ordinary host behavior is unchanged.
- `active`: new actions can be admitted when the selected policy can enforce them.
- `wrap-up`: new delegation and destructive work are blocked.
- `expired`: all new non-control work is blocked.
- `complete`: a terminal assignment blocks further assignment work.

A duration must round to at least one millisecond. A local time uses the host timezone and selects the next occurrence when today's time has passed. The default wrap-up duration is 20 percent of available time, capped at five minutes.

The clock is authoritative. Durable state stores absolute times, not a saved phase or remaining-time value. Restore recomputes both from the current clock.

## Controller interface

The important calls are:

```ts
activate(sessionId, { durationMs | deadlineMs, wrapUpMs?, expiryPolicy }, plan?)
status(sessionId, assignmentId?)
decideTool(sessionId, { toolName, input?, action?, assignmentId?, actionId?, enforceable? })
assign(sessionId, { id?, parentPlanItemId, objective, scope, acceptance, budgetMs, wrapUpMs? })
complete(sessionId, assignmentId, status)
report(sessionId, report)
setPlan(sessionId, plan, reason, sourceAssignmentId?)
stop(sessionId)
```

No call accepts an estimated task duration. The adapter measures current time, total elapsed time, latest inference time, latest tool-call time, remaining time, and assignment elapsed time.

The controller validates unique plan and assignment identifiers, nonempty assignment and report fields, parent plan links when a plan exists, report status consistency, and report-linked plan revisions before persistence.

## Pre-action enforcement

The native `tool_call` event is the admission boundary. For an active session, the adapter:

1. resolves the parent or child scope;
2. classifies the proposed action;
3. parses inline batch assignment contracts when the action carries multiple child tasks;
4. asks the controller for the current phase decision;
5. checks executor cancellation support for `abort-running`;
6. creates all batch assignments atomically only after admission passes;
7. records the action and assignment-to-child links after every check passes;
8. returns a native block result when any check fails.

Portable `wallclock_check` returns the same phase decision for inspection but is not a gate.

Native control tools remain available after expiry so the session can report, revise its plan, inspect status, stop, or explicitly start a new contract. `wallclock_assign` is not an expiry control and cannot create new work after expiry.

## Expiry policies

### `block-new`

The deadline timer and the pre-action clock both make later actions fail admission. An action admitted before expiry may finish. The adapter never records that action as cancelled unless a native result says so.

### `abort-running`

The adapter admits only native executors on a tested allowlist and only when the event context exposes an abort function and a stable action identifier. Unknown extensions and direct `user_bash` execution are rejected.

Pi supports `bash`, `read`, `write`, `edit`, `grep`, `find`, and `ls`. OMP supports `bash`, `read`, `write`, `edit`, `grep`, `glob`, and `task`.

Pi and OMP expose a session-wide abort function. The adapter therefore admits only one running action in each abort domain. A parent OMP task and one action inside its child can coexist because the parent and child are separate native sessions. At expiry, the timer requests abort for every owned running action in the expired session or assignment. The action is marked aborted only when a correlated native result contains structured abort data or a native cancellation error.

If support, identity, context, or observation is missing, activation or action admission fails closed.

## Parent and child flow

1. The owner session activates wall-clock.
2. An OMP `task` call may carry any number of inline child assignment contracts. The host validates the complete batch, creates one assignment per item, and injects each assignment's measured context into the corresponding child.
3. OMP lifecycle events publish the child lifecycle identifier, batch index, and session-path prefix to the child session registry.
4. The child adapter resolves all state operations to the parent state and its own assignment.
5. The child cannot activate or stop the parent contract, create nested assignments, inspect a sibling assignment, revise the parent plan, or report for another assignment.
6. The child reports a complete, partial, blocked, or expired vertical slice. The parent session persists it.
7. The adapter then permits OMP's required native yield as a narrow completion step. Yield is blocked before the child report exists.
8. If the child ends without a report, the adapter records a blocked or expired fallback report with the missing evidence and validation stated.
9. The parent can link the report to a plan revision with complete, partial, blocked, or deferred items.

The child binding survives a parent task result arriving before the terminal child lifecycle event. Terminal events remove both stable child identifiers.

Pi has no native task child in this adapter. Pi assignments are still bounded records, but the package does not claim that they create or enforce a native Pi child.

## Persistence and isolation

State version 3 contains:

- the owner session identifier, issue time, deadline, wrap-up point, policy, revision, and stopped flag;
- current plan items and revision history;
- assignments, native child identifiers, status, deadlines, and completion times;
- one current structured report for each reported assignment.

Native adapters append state to the owner host session. Parent and child OMP extension modules are loaded separately. Instances on the same native event bus share a weakly held coordination object. Actual OMP 17.2.15 task children receive a new event-bus object, so the parent publishes the real child session path to the child session registry. The child adopts that coordination state before session and action hooks and before every native wall-clock tool. Terminal lifecycle or parent shutdown removes the registry entry. Only the owner adapter writes parent state. Raw native action identifiers are also scoped by direct host session so equal parent and child identifiers cannot overwrite each other.

Restore reads only the newest wall-clock custom entry. It deeply validates identifiers, times, parent limits, terminal status, reports, and report-linked plan revisions. A malformed, cross-session, or older-version newest entry disables wall-clock for that session. It does not fall back to a stale earlier entry. Other sessions remain unchanged.

Timers and running actions are not durable. Reload schedules fresh timers from the stored absolute deadlines and starts runtime timing fields at zero.

## Distribution

The package lives in `plugins/wall-clock/` and has three separate distribution surfaces:

- `plugin.json`, `skills/wall-clock/SKILL.md`, and `mcp.json` for Agent Plugins discovery;
- `package.json` `pi.extensions` and `omp.extensions` fields for native package discovery;
- direct `--extension` paths for local Pi and OMP use.

The package is not a root personal skill and must not be installed through `npx skills`. Native enforcement does not depend on the portable skill or MCP process.

## Verification

`npm run check` type-checks the source. `npm test` runs:

- controller, state, MCP, package, adapter, and shared-host tests under Node.js;
- real Pi and OMP command-line interface loading and expired shell blocking;
- Pi's actual extension runner and abortable bash executor;
- OMP's actual extension runner and abortable bash executor under Bun;
- OMP's actual `TaskTool` creating children under both expiry policies, including context adoption, late-work blocking, report plus native yield, and a running child bash abort;
- OMP Agent Plugin skill and MCP discovery;
- isolated-profile OMP package installation and native adapter auto-loading;
- parent and child scope, persistence, deadline, lifecycle, and abort-domain behavior.

Codex and Claude activation, remote provider cancellation, and a portable visual dashboard remain deferred.
