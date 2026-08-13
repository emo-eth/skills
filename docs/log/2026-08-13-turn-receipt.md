# Turn-receipt v1

## Glossary

- **Context seam**: The native host `context` event that lets an extension append messages before a model turn.
- **Native adapter**: The Pi or OMP extension entrypoint that installs the reminder.
- **Turn receipt**: A short end-of-turn block with what happened, what the user needs to do, open questions, and the next step.

Date: 2026-08-13

## Change

Added `plugins/turn-receipt/` as an Agent Plugins package with native Pi and OMP adapters. Each `context` event appends exactly one user message containing:

```text
End this turn with a receipt: Did / Needs you / Questions / Next. Omit empty sections. Keep it under 120 words.
```

The package makes no model calls, has no UI, and has no MCP surface. The optional native `/receipt on|off` command uses `registerCommand`; the reminder still works when only the context seam exists. Hosts without a usable native seam fail closed without injecting or throwing.

## Test evidence

- `npm run check`: passed.
- `npm run test:node`: 7 passed, 0 failed. Covers Pi and OMP per-turn injection, exact text, toggle transitions, command-only seam absence, missing context seam, and a throwing registration seam.
- `npm run test:omp-runner`: 1 passed, 0 failed, 3 expectations. A fresh OMP 17.2.15 `ExtensionRunner` loaded `src/omp.ts`, registered `/receipt`, and returned the exact reminder from two context turns.
- `npm test`: passed after the focused checks above.

## Live evidence

A clean pinned OMP 17.2.15 process was launched with only the turn-receipt extension and an isolated local OpenAI-compatible test provider. It completed a real `-p` turn with `Live receipt test complete.` The captured `/v1/chat/completions` request contained the final user message with the exact reminder text. The request capture was inspected at `/tmp/omp-turn-receipt-request.json` before cleanup.

A separate clean pinned OMP RPC process loaded the adapter and accepted `/receipt off`, emitting `Turn receipt reminder disabled` with no extension error.

The global `omp` on this device reports 17.3.0; the live evidence and package tests use the pinned package binary at `plugins/turn-receipt/node_modules/.bin/omp`, which reports 17.2.15.

## Use

Load `plugins/turn-receipt/src/pi.ts` with Pi or `plugins/turn-receipt/src/omp.ts` with OMP. The reminder starts enabled. Use `/receipt off` to disable it for the current host process and `/receipt on` to enable it again.
