# Wall Clock Agent Plugin

## Glossary

- **Agent Plugins**: The portable package format for Agent Skills and MCP servers.
- **MCP**: Model Context Protocol, used here for wall-clock state and report tools.
- **Native adapter**: Host-specific code loaded by Pi or OMP.
- **Model guidance**: Instructions the model may follow; the host does not enforce them.
- **Host enforcement**: A client event or executor mechanism that blocks or stops work.

This package targets Agent Plugins 1.0.0. The portable package gives compatible
clients one root manifest, one skill location, and one MCP configuration. The
standard does not define a universal hook that can block every client tool call.

## Layout

- `plugin.json`: Agent Plugins 1.0.0 manifest.
- `skills/wall-clock/SKILL.md`: Portable workflow instructions.
- `mcp.json`: Portable MCP server configuration.
- `bin/wall-clock`: Node.js MCP launcher.
- `src/mcp.ts`: MCP server that exposes the controller operations.
- `src/controller.ts`: Host-independent deadline, assignment, report, and tool-decision module.
- `src/host.ts`: Shared native host event and command adapter.
- `src/pi.ts`: Pi entry point.
- `src/omp.ts`: OMP entry point.
- `tests/`: Controller, host, MCP, and package contract tests.

## Portable behavior

The Agent Skill describes how to:

- start a duration or local-time deadline;
- check remaining time before new work;
- create bounded assignments;
- finish as soon as an acceptance target is met;
- report evidence, shortcuts, skipped validation, risks, and unknowns.

The MCP server exposes:

- `wallclock_start`
- `wallclock_status`
- `wallclock_stop`
- `wallclock_context`
- `wallclock_check`
- `wallclock_assign`
- `wallclock_complete`
- `wallclock_report`

Pass the same `sessionId` to every call in one work run. MCP state is stored
under the client-provided `PLUGIN_DATA` directory. A standard MCP call does not
automatically intercept unrelated client tools, so `wallclock_check` is model
guidance unless the client supplies a pre-tool gate.

The launcher requires Node.js 22.6 or newer because the package runs its
TypeScript source with Node's type stripping support.

## Native host behavior

Load `src/pi.ts` or `src/omp.ts` through the host's native extension mechanism.
Those adapters can restore session state, inject remaining time, observe tool
results, and block new work at the host's pre-tool boundary. They remain
host-specific and are not portable Agent Plugins components.

Do not install this package through `npx skills`. Use a client that supports
Agent Plugins, or use the native Pi or OMP loading mechanism.

## Limits

- The package does not create a child session by itself.
- A timer does not cancel an already-running arbitrary tool.
- A local deadline does not cancel a remote action.
- A child hard stop requires a host executor that accepts and obeys an abort signal.

## Test

```sh
npm test
```
