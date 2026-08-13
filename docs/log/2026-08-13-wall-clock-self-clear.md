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

- `npm run check`: passed with TypeScript 5.9.3 and the locked package
  dependencies.
- `npm test`: 74 Node tests passed, 0 failed; 6 Bun native-runner tests
  passed, 0 failed.
- Focused settlement tests: 4 passed, 0 failed.
- Global OMP RPC smoke test loaded `src/omp.ts`, started a two-second contract,
  and returned status without an extension error.
- Global Pi RPC smoke test loaded `src/pi.ts`, started a two-second contract,
  and returned status without an extension error.

The first verification attempt ran before `npm ci` installed the locked local
dependencies. The global `tsc`, `pi`, `omp`, Bun runtime, and
`@oh-my-pi/pi-ai` were available; the local package test dependencies were the
missing setup, not a product limitation.
