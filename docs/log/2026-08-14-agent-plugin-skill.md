# Agent plugin skill evidence

## Glossary

- **Agent Plugin**: A package that a host loads through its native extension system.
- **Native adapter**: The thin Pi or OMP entry point that passes the host to shared plugin code.
- **Vertical slice**: The smallest path from a native command or hook to a real observable result.
- **Live proof**: An action through a newly started host process, separate from source tests.
- **GAP**: A capability or proof boundary that is not established and must not be promised.

## Scope

The previous bug-command build repeated the same package, adapter, context, test, documentation, and live-proof decisions. This skill makes that path explicit for future small Pi and OMP tools.

The skill is `skills/agent-plugin/SKILL.md`. Its model-facing trigger covers native Pi or OMP plugins, slash commands, host adapters, and context-aware loggers. It uses a command-and-record default for tools shaped like Yearn, Skiterate, and bug capture, while preserving a smaller path for hooks and tools.

## Contract

The workflow requires one working vertical slice first, then bounded context metadata. It defaults missing logger details to:

- `plugins/<command>/`;
- `/<command>`;
- `~/UPPER_COMMAND.md`, with an environment-variable override;
- one Markdown list item containing one JSON object;
- repository, worktree, branch, host, model, agent, note, and diagnostic session or turn fields when available.

It keeps Pi and OMP behavior in shared code with thin adapters, requires fake-host tests for both adapters, and requires a native OMP runner proof when the pinned dependency is available. Full prompts and event payloads remain outside the record.

## Verification boundary

The skill separates source checks from live proof. It directs the agent to run the changed package check and tests, inspect package contents, and exercise a clean OMP process. A Pi live process remains optional and must be reported as a GAP when unavailable. OMP installation and full-process restart follow `omp-plugin-iteration`.

An isolated cold-reader attempt was made against five scenarios: vague request,
missing live proof, missing plugin metadata, installed OMP process, and branch
delivery. The reader could not access the artifact because the native
wall-clock lifecycle gate rejected every child tool call. No cold-reader pass
is claimed.

## GAPs

- An isolated cold-reader pass was attempted but blocked by the harness
  lifecycle gate. The skill has a manual structural check, not a cold-reader
  pass.
- The skill gives defaults for append-only local logs. A record consumed by another system still needs an explicit owner checkpoint before implementation.
