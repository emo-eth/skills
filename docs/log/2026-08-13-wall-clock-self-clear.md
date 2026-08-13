# Wall-clock self-clear

Date: 2026-08-13

## Change

Temporary `do-it-now` and `wrap-it-up` guards now stop after the host reports a
terminal agent run. Pi reports this with `agent_settled`. OMP reports a terminal
`agent_end` with `willContinue` omitted or false.

An expired guard stays active during post-run continuations. This keeps late
work blocked and allows `abort-running` to request cancellation before the host
has fully settled the run. The guard then stops automatically, so the next
normal request does not require `/wallclock stop`.

Ordinary `/wallclock` contracts remain session-scoped and still require an
explicit stop.

## Proof

- `node --experimental-strip-types --test --test-name-pattern='expired wrap-it-up guard|terminal OMP agent end' tests/host.test.ts`: 2 passed, 0 failed.
- `node --experimental-strip-types --test tests/host.test.ts`: 27 passed, 0 failed.
- Global OMP RPC smoke test loaded `src/omp.ts`, started a two-second contract,
  and returned status without an extension error.
- Global Pi RPC smoke test loaded `src/pi.ts`, started a two-second contract,
  and returned status without an extension error.

The Bun native runner was not available from this worktree because its installed
dependencies do not include `@oh-my-pi/pi-ai`. The direct Pi and OMP RPC smoke
tests did not require that local dependency tree.
