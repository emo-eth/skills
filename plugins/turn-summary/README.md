# Turn Summary Agent Plugin

## Glossary

- **Agent Plugins**: Packages that load host-specific agent extensions.
- **Context seam**: The native host `context` event that lets an extension append messages before a model turn.
- **Native adapter**: The Pi or OMP extension entrypoint in this package.
- **Turn summary**: A short end-of-turn block with what happened, what the user needs to do, open questions, and the next step.

Turn-summary uses the same native `context` seam as wall-clock. Each context event receives one user message containing this fixed reminder:

```text
End this turn with a summary: Did / Needs you / Questions / Next. Omit empty sections. Keep it under 400 words.
```

The package makes no model calls, has no UI, and does not provide an MCP operation. A host without the native context seam is a no-op and does not crash.

## Install, enable, and disable

Install from this checkout:

```sh
omp plugin install /absolute/path/to/plugins/turn-summary
pi install /absolute/path/to/plugins/turn-summary
```

Start a new OMP or Pi process after installing. The package is enabled by
default and uses the native `context` event.

For a one-process load without installing:

```sh
omp --extension /absolute/path/to/plugins/turn-summary/src/omp.ts
pi --extension /absolute/path/to/plugins/turn-summary/src/pi.ts
```

The reminder is enabled by default. The optional native command toggles it for the current host process:

```text
/summary off
/summary on
```

The command is available only when the host exposes `registerCommand`; the reminder itself still works with only the context seam.

## Evidence

| Host | Context mechanism | Toggle mechanism | Evidence |
| --- | --- | --- | --- |
| Pi 0.84.1 | Native `context` event | Native `registerCommand` | `tests/adapters.test.ts` |
| OMP 17.2.15 | Native `context` event | Native `registerCommand` | `tests/adapters.test.ts` and `tests/native-omp-runner.bun.ts` |
| Other hosts | No assumed seam | None | No-op adapter tests |

Run the package checks:

```sh
npm install
npm test
```

A newly installed OMP npm plugin needs a full process restart; `/reload-plugins` does not activate it in OMP 17.2.15.
