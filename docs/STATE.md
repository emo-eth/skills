# Wall Clock Project State

## What this is

Wall-clock is an Agent Plugins package with native Pi and OMP adapters for enforced time boundaries around agent sessions, assignments, and host actions. Codex and Claude are limited to portable package discovery, and Claude proprietary systems are excluded. The product document still has draft approval metadata, but the v0 implementation now matches its reviewed Pi and OMP contract and has real-host evidence.

## Where we are

Current phase: v0 implementation complete on `main`. Pi 0.84.1 and OMP 17.2.15 load the native adapters, inject measured time, block late native work, and abort their real bash executors under `abort-running`. OMP's real `TaskTool` creates tested children that inherit assignment context, block late work, report, terminate through native `yield`, and abort a running child bash action. OMP does not forward the parent event bus into these children, so the adapter binds each real child session file through a process-wide registry and removes the binding at terminal lifecycle. Unsupported or unabortable paths fail closed.

The package is installed and enabled in the normal local OMP profile from `/Users/emo/dev/skills/plugins/wall-clock`. A clean OMP process auto-loaded the extension, activated a one-millisecond contract, and blocked a real shell command after expiry. The completion evidence is in `docs/log/2026-08-12-wall-clock-completion.md`.

The current package includes version 3 state validation, assignment and report contracts, report-linked plan revisions, Agent Plugin discovery, and optional MCP operations. Standalone MCP refuses activation and does not replace or mirror native host enforcement.

Deferred: Codex and Claude activation [D10] until an open, tested enforcement seam exists; Claude proprietary systems; provider-specific remote cancellation; and a portable visual dashboard. Revisit D10 when v1 host support is scoped and revisit the last two when provider or user-interface requirements become active. The full contract remains in `docs/prds/2026-08-11-wall-clock/prd.md`.

Known dependency constraint: the exact OMP development dependency brings optional model and image packages with five high-severity audit findings. `npm audit --omit=optional` reports zero findings. Keep this visible until upstream packages resolve it; do not run an automatic audit fix that changes the tested host version.

## Standing constraints

- An active wall-clock limit must be host-enforced; unsupported activation fails closed. [D4]
- Parent and child agents receive measured elapsed-time context at every turn; agents do not estimate task duration. [D5]
- Pi and OMP are the first enforcement targets; Codex and Claude are package targets only until tested seams exist. [D6]
- Activation requires the user's selected `block-new` or `abort-running` expiry policy. [D7]
- Compression preserves a working vertical slice and reports gaps honestly. [D8]
- MCP is optional and never enforces deadlines. [D9]

## Topic index

| Topic | Thinking and decisions | Code | Verified by | Tier |
| --- | --- | --- | --- | --- |
| Product contract | `docs/prds/2026-08-11-wall-clock/vibe.md`, `prd.md` | `plugins/wall-clock/` | `docs/review/2026-08-11-wall-clock-round-1-answers.md` | documented |
| Plugin capability boundary | `docs/prds/2026-08-11-wall-clock/plugin-capabilities.md` | `plugins/wall-clock/plugin.json`, `mcp.json`, `skills/wall-clock/SKILL.md` | `plugins/wall-clock/tests/plugin.test.ts` | documented |
| Runtime implementation | `proposals/wall-clock/design.md`, `docs/DECISIONS.md` | `plugins/wall-clock/src/`, `plugins/wall-clock/tests/` | Pi and OMP command-line tests, isolated OMP install test, native TaskTool child tests, and `docs/log/2026-08-12-wall-clock-completion.md` | verified-live |
| Decision log | `docs/DECISIONS.md` | — | this map | documented |
| Distilled taste | `docs/taste.md` | — | this map | documented |
| Review capture | `docs/review/2026-08-11-wall-clock-round-1-answers.md` | `.context/review/2026-08-11-wall-clock-round-1.md` | raw snapshot and answers doc | verified-live |

## Maintenance rule

Before editing, read this map and follow its pointers to the source documents or code. When work changes the project's understanding or implementation, update this map in the same commit. Keep the map short, keep review snapshots under `.context/`, and record future human decisions in the append-only `docs/DECISIONS.md` log.
