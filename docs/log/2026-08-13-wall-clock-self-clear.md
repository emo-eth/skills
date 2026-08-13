# Wall-clock self-clear

Date: 2026-08-13

## Change

Native wall-clock contracts started by an explicit `/wallclock` command or
`wallclock_start` now stop after terminal agent settlement. Pi reports this
with `agent_settled`. OMP reports terminal `agent_end` with `willContinue`
omitted or false.

An expired contract stays active during post-run continuations. This keeps
late work blocked and allows `abort-running` to request cancellation before the
host has fully settled the run. If a child action is still running, cleanup
waits for that child to finish so its deadline remains enforced.

After settlement, a normal follow-up does not require `/wallclock stop`. Start
a new contract when the follow-up itself needs a time limit.

## Proof

- `node --experimental-strip-types --test --test-name-pattern='expired wrap-it-up guard|terminal OMP agent end|terminal settlement clears an explicit wallclock contract' tests/host.test.ts`: 4 passed, 0 failed.
- `node --experimental-strip-types --test tests/host.test.ts`: 29 passed, 0 failed.
- Dependency-free package tests across controller, host, adapters, abort, MCP,
  plugin, store, and time files: 69 passed, 0 failed.
- Global OMP RPC smoke test loaded `src/omp.ts`, started a two-second contract,
  and returned status without an extension error.
- Global Pi RPC smoke test loaded `src/pi.ts`, started a two-second contract,
  and returned status without an extension error.

The package TypeScript check could not run because this worktree has no local
`tsc` binary. The full Node test command could not run its real-host cases
because this worktree has no local `pi` or `omp` binaries. The Bun native
runner was not available because the installed dependencies do not include
`@oh-my-pi/pi-ai`. The focused tests and direct Pi and OMP RPC smoke tests did
not require that local dependency tree.
