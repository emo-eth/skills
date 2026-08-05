# Experimental Wall Clock Plugin

## Glossary

- **Pi adapter**: The entry point that registers the common module with Pi.
- **OMP adapter**: The entry point that registers the common module with OMP.
- **Pre-tool gate**: The host event that can reject a tool call before execution.
- **Assignment**: A bounded child-session task recorded by the controller.

This is an experimental in-process plugin. It is not a skill and is not ready for global installation.

## Layout

- `src/controller.ts`: Host-independent deadline, assignment, report, and tool-decision module.
- `src/host.ts`: Shared host event and command adapter.
- `src/pi.ts`: Pi entry point.
- `src/omp.ts`: OMP entry point.
- `tests/`: Focused controller and host-shape tests.

## Test

```sh
npm test
```

## Current behavior

- `/wallclock start 30m` activates a duration.
- `/wallclock start 5pm` activates a local-time deadline.
- `/wallclock status` reports the current phase.
- `/wallclock stop` disables control for the current session.
- `wallclock_assign` records a bounded child assignment.
- `wallclock_complete` records early, partial, blocked, or expired completion.
- `wallclock_report` records evidence, shortcuts, skipped validation, risks, and unknowns.
- `tool_call` blocks new work after expiry and blocks delegation or destructive actions during wrap-up.

The controller does not claim to cancel an already-running arbitrary tool or remote action. A child hard stop requires a host executor that accepts and obeys an abort signal. OMP child lifecycle observation is registered, but native per-call budget injection remains host-version-specific.

## Host loading

Use the host's native extension loading mechanism with one of these entry points:

- `plugins/wall-clock/src/pi.ts`
- `plugins/wall-clock/src/omp.ts`

Do not install this through `npx skills`. The package is deliberately outside `skills/` until the host-version matrix and release gates in `proposals/wall-clock/future-work.md` are complete.
