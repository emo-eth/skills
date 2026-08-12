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
- **Assignment**: One bounded child objective with scope, acceptance targets, and its own time ceiling.

## Supported behavior

Activation accepts a positive duration such as `30m` or a future local time such as `5pm`. The caller must select one policy:

- `block-new`: after expiry, reject new work and let work already admitted by the host finish.
- `abort-running`: after expiry, reject new work and abort every supported wall-clock-owned action. The adapter rejects an action before it starts when it cannot prove that the native executor can be aborted.

Both policies block new delegation and destructive actions during wrap-up. Both block all new non-control work after expiry. A completed assignment also blocks more work in that assignment.

Before each model turn, the native adapter injects current time, total elapsed time, latest inference elapsed time, latest tool-call elapsed time, remaining time, phase, policy, and current assignment elapsed time. These values come from the host clock. The model is not asked to estimate task duration.

The default wrap-up period is 20 percent of the available time, capped at five minutes. An explicit positive wrap-up value is capped at the hard deadline.

## Host support matrix

| Host | Pre-action gate | Turn context | `block-new` | `abort-running` | Child behavior | Failure mode | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pi 0.84.1 | Native `tool_call` and `user_bash` events | Native `context`, inference, and result events | Supported | Supported for `bash`, `read`, `write`, `edit`, `grep`, `find`, and `ls` | Assignments are recorded; Pi has no native task child in this adapter | Activation or an unabortable action is rejected | `tests/real-hosts.test.ts`, `tests/native-runners.test.ts` |
| OMP 17.2.15 | Native `tool_call` and `user_bash` events | Native `context`, inference, and result events | Supported | Supported for `bash`, `read`, `write`, `edit`, `grep`, `glob`, and `task` | Each task must have exactly one active unbound assignment; batch and nested delegation are blocked | Missing shared event bus, missing abort function, or an unabortable action is rejected | `tests/real-hosts.test.ts`, `tests/native-omp-runner.bun.ts`, `tests/host.test.ts` |
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

Start and inspect a session:

```text
/wallclock start 30m block-new
/wallclock status
/wallclock stop
```

Use `abort-running` instead of `block-new` only when running supported native actions must stop at expiry.
Stop the current contract before starting a replacement. A second start never silently discards active plans, assignments, reports, or running-action ownership.

The package also declares `pi.extensions` and `omp.extensions` in `package.json` for native package discovery. Do not install this directory through `npx skills`; it is a runtime plugin, not a personal skill package.

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

## Persistence and isolation

Native state is written as version 3 custom entries in the owning host session. Reload and resume compute phase and remaining time from the current clock. The latest wall-clock entry is authoritative. A malformed, old-version, or cross-session latest entry disables wall-clock for that session instead of restoring older state.

An OMP child sees only its assigned scope and cannot stop the parent limit, create a nested assignment, inspect a sibling assignment, revise the parent plan, or report for another assignment. Parent state and child reports are persisted by the parent host session.

## Portable package and MCP

The root `plugin.json`, bundled Agent Skill, and `mcp.json` follow Agent Plugins 1.0.0. OMP discovery is covered by a real-host test.

The standalone MCP server exposes the operation contracts but refuses `wallclock_start` because MCP has no native pre-action gate. It does not mirror native host session entries by itself. Package or MCP discovery is therefore not evidence of enforcement.

The launcher needs Node.js 22.6 or newer because it uses native TypeScript type stripping.

## Known boundaries

- Pi does not provide native child delegation through this adapter.
- OMP supports one bounded assignment per task invocation; batch and nested delegation are blocked. Under `abort-running`, only one parent-session task can be active because the abort function is session-wide.
- Remote provider cancellation needs provider-specific confirmation and is not implemented.
- Codex and Claude can discover the portable package but cannot activate wall-clock until an open, tested native enforcement seam exists.
- The full development dependency audit reports five high-severity findings in optional OMP model and image dependencies. `npm audit --omit=optional` reports zero findings. No production runtime dependency was added to the wall-clock controller.
