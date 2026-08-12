# Wall Clock Project State

## What this is

Wall-clock is an experimental Agent Plugins package for enforcing time boundaries around agent sessions, assignments, and host actions. It is for the author's Codex, Pi, and OMP workflows, with Claude limited to package discovery and Claude proprietary systems excluded. The product contract is in draft; the package and focused tests exist, but Pi and OMP end-to-end enforcement is not yet proven against the reviewed contract.

## Where we are

Current phase: v0 contract revision after the first review round. The current contract requires host-enforced activation, measured elapsed-time context at every turn, a user-selected expiry policy, and a working vertical slice when scope contracts. The portable Agent Plugins package is discoverable, and optional MCP operations are separated from native enforcement.

Open: implement and prove the reviewed contract in the native Pi and OMP paths: per-turn measured context, fail-closed activation, `block-new`, `abort-running` with an observed abort signal, child elapsed-time reporting, and end-to-end tests. The current implementation must not be described as complete until those checks pass.

Deferred: Codex and Claude activation [D10] until an open, tested enforcement seam exists; Claude proprietary systems; provider-specific remote cancellation; and a portable visual dashboard. Revisit D10 when v1 host support is scoped and revisit the last two when provider or user-interface requirements become active. The full contract remains in `docs/prds/2026-08-11-wall-clock/prd.md`.

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
| Runtime implementation | `proposals/wall-clock/design.md`, `docs/DECISIONS.md` | `plugins/wall-clock/src/`, `plugins/wall-clock/tests/` | `plugins/wall-clock/README.md` | inferred |
| Decision log | `docs/DECISIONS.md` | — | this map | documented |
| Distilled taste | `docs/taste.md` | — | this map | documented |
| Review capture | `docs/review/2026-08-11-wall-clock-round-1-answers.md` | `.context/review/2026-08-11-wall-clock-round-1.md` | raw snapshot and answers doc | verified-live |

## Maintenance rule

Before editing, read this map and follow its pointers to the source documents or code. When work changes the project's understanding or implementation, update this map in the same commit. Keep the map short, keep review snapshots under `.context/`, and record future human decisions in the append-only `docs/DECISIONS.md` log.
