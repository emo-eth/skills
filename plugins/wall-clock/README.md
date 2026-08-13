# Wall Clock Agent Plugin

Wall-clock gives Pi and OMP sessions a host-enforced time ceiling. It injects measured time before model turns, blocks work at native pre-action boundaries, and can stop supported running actions when the selected policy requires it.

## Glossary

- **Agent Plugins**: The portable package format for Agent Skills and optional Model Context Protocol servers.
- **MCP**: Model Context Protocol, used here as an optional portable operation surface.
- **Pi**: The `@earendil-works/pi-coding-agent` host.
- **OMP**: The `@oh-my-pi/pi-coding-agent` host.
- **Native adapter**: Host-specific code that observes model and tool events and enforces wall-clock decisions.
- **Expiry policy**: The selected rule at the deadline: block new work or also abort supported running work.
- **Abort domain**: One native host session whose abort function can stop its current action.
- **Fast lane**: A short host-enforced execution window for one bounded request.
- **Do-it-now lane**: A fixed host-enforced execution window for one explicit request.
- **Wrap-it-up lane**: A two-minute host-enforced execution window for finishing the active request.
- **Inline batch delegation**: One parent `task` call carrying several child tasks, with one `wallClock` assignment contract for each item.

## Do-it-now lane

An explicit `/do-it-now <request>` invocation on a native Pi or OMP session
with this plugin loaded activates a fixed fast lane:

- 2-minute hard deadline;
- `abort-running` for supported native actions;
- bounded delegation through as many inline batch assignments as useful before wrap-up;
- at most 12 ordinary tool calls.

The lane clears when the host reports that the agent run has fully settled. If
the deadline expires first, the guard stays active through any post-run
continuation so blocked work cannot bypass expiry. Without a native adapter, the
skill is guidance only.

## Wrap-it-up lane

An explicit `/wrap-it-up` invocation on a native Pi or OMP session with this
plugin loaded activates a fixed fast lane:

- two-minute hard deadline;
- `abort-running` for supported native actions;
- bounded delegation through as many inline batch assignments as useful while the phase is active;
- at most 12 ordinary tool calls.

The lane clears after the host reports that the agent run has fully settled. If
the deadline expires first, the guard stays active through any post-run
continuation so blocked work cannot bypass expiry.

The bundled skill remains responsible for closing the active task. Without a
native adapter, the skill is guidance only.

## Supported behavior

Activation accepts a positive duration such as `30m` or a future local time such as `5pm`. Every active contract carries one policy:

- `block-new`: after expiry, reject new work and let work already admitted by the host finish.
- `abort-running`: after expiry, reject new work and abort every supported wall-clock-owned action. The adapter rejects an action before it starts when it cannot prove that the native executor can be aborted.

- The native `/wallclock` command defaults to `block-new` when the policy is omitted. Use `abort-running` when the host can prove safe cancellation. `abort` is accepted as a short spelling of `abort-running`. Native tools and the portable operation contract still carry the canonical policy explicitly.

Both policies block new delegation and destructive actions during wrap-up. Both block all new non-control work after expiry. A completed assignment also blocks more work in that assignment.

Every native contract started by an explicit `/wallclock` command or the
`wallclock_start` tool clears after terminal agent settlement. Pi uses
`agent_settled`; OMP uses terminal `agent_end`. If a child action is still
running, cleanup waits for that child to finish so its deadline remains
enforced. A normal follow-up does not require `/wallclock stop`; start a new
contract when the follow-up itself needs a time limit.

Before each model turn, the native adapter injects current time, total elapsed time, latest inference elapsed time, latest tool-call elapsed time, remaining time, phase, policy, and current assignment elapsed time. These values come from the host clock. The model is not asked to estimate task duration.

The default wrap-up period is 20 percent of the available time, capped at five minutes. An explicit positive wrap-up value is capped at the hard deadline.

## Host support matrix

| Host | Pre-action gate | Turn context | `block-new` | `abort-running` | Child behavior | Failure mode | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pi 0.84.1 | Native `tool_call` and `user_bash` events | Native `context`, inference, and result events | Supported | Supported for `bash`, `read`, `write`, `edit`, `grep`, `find`, and `ls` | Assignments are recorded; Pi has no native task child in this adapter | Activation or an unabortable action is rejected | `tests/real-hosts.test.ts`, `tests/native-runners.test.ts` |
| OMP 17.2.15 | Native `tool_call` and `user_bash` events | Native `context`, inference, and result events | Supported | Supported for `bash`, `read`, `write`, `edit`, `grep`, `glob`, and `task` | Each batch item receives its own inline assignment; batch delegation is supported and nested delegation is deferred | Missing event bus, missing abort function, or an unabortable action is rejected | `tests/real-hosts.test.ts`, `tests/native-omp-runner.bun.ts`, `tests/host.test.ts` |
| Portable Agent Plugin or MCP only | None | None | Activation rejected | Activation rejected | No child creation | Reports that a native Pi or OMP adapter is required | `tests/plugin.test.ts`, `tests/mcp.test.ts`, `tests/real-hosts.test.ts` |

`abort-running` admits only one action at a time in each abort domain because Pi and OMP expose a session-wide abort function. An OMP parent task and its child session can both be active because they have separate abort domains. Unknown extension tools and direct `user_bash` actions are rejected under `abort-running` when cancellation cannot be observed.

Cancellation is recorded only after the native result reports an abort or cancellation. Local cancellation does not prove that remote provider work stopped.

## Native loading

Install the exact test dependencies and run the checks:

```sh
cd plugins/wall-clock
npm install
npm run check
npm test
```

Load the native adapter from this checkout:

```sh
pi --extension /absolute/path/to/plugins/wall-clock/src/pi.ts
omp --extension /absolute/path/to/plugins/wall-clock/src/omp.ts
```

Start a session, optionally submit the first prompt, and inspect it:

```text
/wallclock 5m fix merge conflicts in all open PRs
/wallclock 30m block-new inspect the failing tests
/wallclock start 30m abort-running finish the refactor
/wallclock status
/wallclock stop
```

`start` is optional. The policy is optional and defaults to `block-new`. When the command includes a prompt, an idle host starts a new turn and a running host delivers it as normal steering input. Wall-clock activates and persists before it submits the prompt, then stops automatically after terminal settlement.

The native status display refreshes once per second from the current host clock. A delayed refresh recalculates the remaining time instead of decrementing a cached value, so display delays do not accumulate drift.

Stop the current contract before starting a replacement. A second start never silently discards active plans, assignments, reports, or running-action ownership.

The package also declares `pi.extensions` and `omp.extensions` in `package.json` for native package discovery. Do not install this directory through `npx skills`; it is a runtime plugin, not a personal skill package.

To install and auto-load the package in an isolated OMP profile:

```sh
omp --profile wall-clock plugin install /absolute/path/to/plugins/wall-clock
omp --profile wall-clock
```

Do not add `--scope` for a local path. OMP 17.2.15 ignores it for local package installs.
After the first native plugin install, fully quit and restart OMP. In OMP 17.2.15, `/reload-plugins` does not activate a newly installed npm plugin in the current process.

## Tools

The native adapters register:

- `wallclock_start`
- `wallclock_status`
- `wallclock_stop`
- `wallclock_context`
- `wallclock_check`
- `wallclock_assign`
- `wallclock_complete`
- `wallclock_report`
- `wallclock_revise_plan`

An assignment report records completed and partial work, evidence, skipped work, validation, shortcuts and tradeoffs, risks, unknowns, actual elapsed time, the selected policy, and one recommended parent action. A plan revision can link to the report that caused it.

## Inline batch delegation

During the active phase, an OMP parent may choose any number of independent
children in one `task` call. Each item carries its own assignment contract:

```json
{
  "tasks": [
    {
      "task": "Inspect authentication",
      "wallClock": {
        "parentPlanItemId": "auth",
        "objective": "Inspect authentication",
        "scope": ["src/auth"],
        "acceptance": ["Return findings"],
        "budgetMs": 120000
      }
    }
  ]
}
```

The host validates every item before creating any assignment or child. Each
item becomes one assignment and one child session. The host injects measured
assignment context into the child task and removes the `wallClock` metadata
before the underlying OMP task tool runs. Invalid input starts no children.



## Persistence and isolation

Native state is written as version 3 custom entries in the owning host session. Reload and resume compute phase and remaining time from the current clock. The latest wall-clock entry is authoritative. A malformed, old-version, or cross-session latest entry disables wall-clock for that session instead of restoring older state.

An OMP child sees only its assigned scope and cannot stop the parent limit, create a nested assignment, inspect a sibling assignment, revise the parent plan, or report for another assignment. The child must call `wallclock_report` before OMP's required `yield`. After a valid report, the adapter permits only that native completion step even when the assignment is complete or expired. Parent state and child reports are persisted by the parent host session.

## Portable package and MCP

The root `plugin.json`, bundled Agent Skill, and `mcp.json` follow Agent Plugins 1.0.0. OMP discovery is covered by a real-host test.

The standalone MCP server exposes the operation contracts but refuses `wallclock_start` because MCP has no native pre-action gate. It does not mirror native host session entries by itself. Package or MCP discovery is therefore not evidence of enforcement.

The launcher needs Node.js 22.6 or newer because it uses native TypeScript type stripping.

The Codex feasibility finding is in [CODEX-SUPPORT.md](CODEX-SUPPORT.md). It describes a possible `block-new`-only adapter; Codex activation is not implemented or supported in v0.

## Known boundaries

- Pi does not provide native child delegation through this adapter.
- OMP supports any number of bounded inline batch assignments before wrap-up. Each batch item uses `wallClock` assignment metadata, receives its own deadline and report, and maps to one child session. Nested delegation remains blocked until its lifecycle contract is implemented. Under `abort-running`, only one parent-session task action can be active because the abort function is session-wide.
- OMP 17.2.15 does not forward the parent event-bus object into a task-created child. The adapter binds the real child session file through a process-wide registry and removes the binding when the child reaches a terminal lifecycle state.
- Remote provider cancellation needs provider-specific confirmation and is not implemented.
- Do-it-now cannot infer semantic scope from arbitrary tool input. The host guard limits time, delegation, and tool-call count; the model instructions still prevent unrelated reads, writes, and research.
- Codex and Claude can discover the portable package but cannot activate wall-clock until an open, tested native enforcement seam exists.
- The full development dependency audit reports five high-severity findings in optional OMP model and image dependencies. `npm audit --omit=optional` reports zero findings. No production runtime dependency was added to the wall-clock controller.
