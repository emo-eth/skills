# Bug command v1 evidence

## Glossary

- **Agent Plugin**: A package that a host loads through its native extension system.
- **Bug record**: One append-only JSON object describing a reported bug and the local context known when it was reported.
- **Activity context**: The latest host event, command, tool, skill, and plugin metadata observed for one session.
- **Native command**: A slash command registered directly with Pi or OMP, not a skill wrapper.
- **GAP**: A capability or proof boundary that is not established and must not be promised.

## Scope

The user asked for a Yearn-shaped native command that records bugs like `/skiterate`, with enough context to debug plugins, skills, and applications after the session moves on. The v1 choice is a command-only Agent Plugin at `plugins/bug-command/`.

The command is:

```text
/bug [--plugin <name>] [--skill <name>] <bug description>
```

It writes one Markdown list item containing one JSON object to `~/BUGS.md`. `BUGS_PATH` overrides the destination. The note is normalized to one line. The command never copies the full prompt or event payload into the log.

## Captured context

Every record contains:

- host and agent (`pi` or `omp`, `Pi` or `OMP`);
- repository, worktree, branch, current folder, and model;
- session ID, session name, and session file when the host exposes them;
- a turn number and turn start time from lifecycle events or host context;
- the latest event and event time;
- the latest slash command and tool name;
- session entry and current branch entry counts;
- the latest recognized plugin and skill, with explicit command flags taking precedence;
- a UUID, ISO timestamp, and the bug note.

The plugin tracks activity separately for each session key. It uses the host session ID, then session file, then current folder. Missing host metadata becomes `null`, not a guessed value.

## Capability boundary

### Pi 0.84.1

- The native adapter registers `/bug` through `registerCommand`.
- Lifecycle and tool hooks remember skill markers, plugin markers, turn state, and recent activity.
- Package tests cover the Pi adapter and record shape.

### OMP 17.2.15

- The native adapter registers `/bug` through `registerCommand`.
- The same shared implementation runs in the OMP adapter.
- The native OMP ExtensionRunner test loads the adapter in a clean session and writes a record.

## GAPs

- Pi has package-level adapter proof, not a separate live Pi process proof.
- A host does not always expose the package that handled a command. The record leaves `plugin` null in that case and preserves the latest command or tool instead. `/bug --plugin <name>` is the explicit override.
- Turn counting falls back to lifecycle order when the host does not provide a turn field. It is a debugging hint, not a host-owned global turn identifier.

## Implementation

- `plugins/bug-command/plugin.json`: Agent Plugins manifest.
- `plugins/bug-command/package.json`: native Pi and OMP entry points.
- `plugins/bug-command/src/record.ts`: argument parsing, Git metadata, context normalization, and append-only record writing.
- `plugins/bug-command/src/host.ts`: session-scoped activity tracking and command registration.
- `plugins/bug-command/src/pi.ts`: Pi entry point.
- `plugins/bug-command/src/omp.ts`: OMP entry point.
- `plugins/bug-command/tests/`: recorder, adapter, and native OMP tests.

## Verification

From `plugins/bug-command/`:

- `npm run check`: passed.
- `npm run test:node`: 8 tests passed, 0 failed.
- `npm run test:omp-runner`: 1 native OMP test passed, 0 failed.
- A clean OMP 17.2.15 RPC process loaded `src/omp.ts`, accepted
  `/bug --plugin turn-summary live OMP bug`, and wrote a record with the
  expected OMP host, model, session ID, session file, repository, branch,
  explicit plugin, and note fields.
