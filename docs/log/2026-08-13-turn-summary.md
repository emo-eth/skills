# Turn-summary v1

## Glossary

- **Context seam**: The native host `context` event that lets an extension append messages before a model turn.
- **Native adapter**: The Pi or OMP extension entrypoint that installs the reminder.
- **Turn summary**: A short end-of-turn block with what happened, what the user needs to do, open questions, and the next step.

Date: 2026-08-13

## Change

Added `plugins/turn-summary/` as an Agent Plugins package with native Pi and OMP adapters. Each `context` event appends exactly one user message containing:

```text
End this turn with a summary: Did / Needs you / Questions / Next. Omit empty sections. Keep it under 400 words.
```

The package makes no model calls, has no UI, and has no MCP surface. The optional native `/summary on|off` command uses `registerCommand`; the reminder still works when only the context seam exists. Hosts without a usable native seam fail closed without injecting or throwing.

## Test evidence

- `npm run check`: passed.
- `npm run test:node`: 8 passed, 0 failed. Covers Pi and OMP per-turn injection, exact 400-word reminder text, toggle transitions, command-only seam absence, missing context seam, and a throwing registration seam.
- `npm run test:omp-runner`: 1 passed, 0 failed, 3 expectations. A fresh OMP 17.2.15 `ExtensionRunner` loaded `src/omp.ts`, registered `/summary`, and returned the exact reminder from two context turns.
- `npm test`: passed.

## Installation and live evidence

- `omp plugin install /absolute/path/to/plugins/turn-summary --json`: installed `@emo-eth/turn-summary-plugin` version 0.1.0 in the normal local OMP profile with `enabled: true`.
- `pi install /absolute/path/to/plugins/turn-summary`: installed the checkout in the normal local Pi profile.
- `omp plugin list --json` showed the installed OMP package enabled.
- `pi list` showed the installed Pi package.
- A clean pinned OMP 17.2.15 process, with no explicit `--extension`, auto-loaded the installed package and completed a real `-p` turn against an isolated local OpenAI-compatible test provider. The captured model request contained the final user message with the exact 400-word reminder text. The request capture was inspected at `/tmp/turn-summary-live-request.json` before cleanup.
- A clean Pi 0.84.1 RPC process, with no explicit `--extension`, auto-loaded the installed package and accepted `/summary off`, emitting `Turn summary reminder disabled` with no extension error.

The global `omp` on this device reports 17.3.0. The package tests and OMP live evidence use the pinned package binary at `plugins/turn-summary/node_modules/.bin/omp`, which reports 17.2.15.

## Use

Install from the checkout with `omp plugin install /absolute/path/to/plugins/turn-summary` and `pi install /absolute/path/to/plugins/turn-summary`, then start a new process. The reminder starts enabled. Use `/summary off` to disable it for the current host process and `/summary on` to enable it again.
