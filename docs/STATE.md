# Wall Clock Project State

## What this is

Wall-clock is an Agent Plugins package with native Pi and OMP adapters for enforced time boundaries around agent sessions, assignments, and host actions. Codex and Claude are limited to portable package discovery, and Claude proprietary systems are excluded. The product document still has draft approval metadata, but the v0 implementation now matches its reviewed Pi and OMP contract and has real-host evidence.

## Where we are

Current phase: v0 implementation complete on `main`. Pi 0.84.1 and OMP 17.2.15 load the native adapters, inject measured time, block late native work, and abort their real bash executors under `abort-running`. The native `/wallclock` command accepts an optional `start`, defaults an omitted policy to `abort-running`, and submits an optional trailing prompt only after activation; idle use starts a turn and active use steers it. The host status display recalculates from the current clock once per second. OMP's real `TaskTool` creates tested children that inherit assignment context, block late work, report, terminate through native `yield`, and abort a running child bash action. The adapters also recognize explicit `/do-it-now` skill invocations and apply a fixed 2-minute, abort-running fast lane that blocks delegation and caps ordinary tool calls. OMP does not forward the parent event-bus object into these children, so the adapter binds the real child session file through a process-wide registry and removes the binding at terminal lifecycle. Unsupported or unabortable paths fail closed.

The package is installed and enabled in the normal local OMP profile from `/Users/emo/dev/skills/plugins/wall-clock`. A clean OMP process auto-loaded the extension, activated a one-millisecond contract, and blocked a real shell command after expiry. A newly installed OMP npm plugin needs a full process restart; `/reload-plugins` does not activate it in OMP 17.2.15. The original completion evidence is in `docs/log/2026-08-12-wall-clock-completion.md`; direct-start command and live-status evidence is in `docs/log/2026-08-12-wall-clock-command-ux.md`.

The current package includes version 3 state validation, assignment and report contracts, report-linked plan revisions, Agent Plugin discovery, and optional MCP operations. Standalone MCP refuses activation and does not replace or mirror native host enforcement. Nested assignment limits are specified but not implemented in `proposals/wall-clock/nested-assignment-limits.md`; the proposed version 4 data shape requires user sign-off before implementation.

Known child-test boundary: the native OMP `TaskTool` tests set `async.enabled` to false, while OMP 17.2.15 defaults it to true. The nested-assignment proposal makes a one-level background-child characterization test its first gate. Current synchronous child evidence must not be presented as proof of normal background-task behavior.

Deferred: Codex and Claude activation [D10] until an open, tested enforcement seam exists; Claude proprietary systems; provider-specific remote cancellation; and a portable visual dashboard. Revisit D10 when v1 host support is scoped and revisit the last two when provider or user-interface requirements become active. The full contract remains in `docs/prds/2026-08-11-wall-clock/prd.md`.

Codex support finding: current Codex hooks make a narrower `block-new` adapter technically possible for covered local tools, but no supported abort-running or universal tool boundary was found. The package-local copy is `plugins/wall-clock/CODEX-SUPPORT.md`; the dated research record and required smoke-test evidence are in `docs/log/2026-08-12-codex-support-finding.md`; v0 activation remains deferred under D10.

The repository now also publishes `skills/initiative-standup/SKILL.md`, a user-invoked standup for recent cross-project initiatives that do not need Linear tickets [documented]. On this device, Memex indexes local agent history and the `nicosuave.memex` Herdr plugin is installed; its refresh action succeeded on 2026-08-12 [verified-live]. `tools/claude-skill-usage.ts` reports reconstructed Claude Code token usage grouped by the local `attributionSkill` field [verified-live]. These are supporting local integrations, not wall-clock enforcement.

Known dependency constraint: the exact OMP development dependency brings optional model and image packages with five high-severity audit findings. `npm audit --omit=optional` reports zero findings. Keep this visible until upstream packages resolve it; do not run an automatic audit fix that changes the tested host version.

## Standing constraints

- An active wall-clock limit must be host-enforced; unsupported activation fails closed. [D4]
- Parent and child agents receive measured elapsed-time context at every turn; agents do not estimate task duration. [D5]
- Pi and OMP are the first enforcement targets; Codex and Claude are package targets only until tested seams exist. [D6]
- Every activation carries `block-new` or `abort-running`; the native slash command defaults an omitted choice to `abort-running`. [D7, D13]
- `standup` is ticket-centered; `initiative-standup` is the separate path for cross-project work and must not require or mutate Linear tickets. [documented]

- Compression preserves a working vertical slice and reports gaps honestly. [D8]
- MCP is optional and never enforces deadlines. [D9]

## Topic index

| Topic | Thinking and decisions | Code | Verified by | Tier |
| --- | --- | --- | --- | --- |
| Product contract | `docs/prds/2026-08-11-wall-clock/vibe.md`, `prd.md` | `plugins/wall-clock/` | `docs/review/2026-08-11-wall-clock-round-1-answers.md` | documented |
| Plugin capability boundary | `docs/prds/2026-08-11-wall-clock/plugin-capabilities.md` | `plugins/wall-clock/plugin.json`, `mcp.json`, `skills/wall-clock/SKILL.md` | `plugins/wall-clock/tests/plugin.test.ts` | documented |
| Codex support boundary | `docs/log/2026-08-12-codex-support-finding.md`, `plugins/wall-clock/CODEX-SUPPORT.md` | not implemented | official Codex hook contract and local `codex-cli 0.147.0` capability inspection; real smoke test still required | documented |
| Runtime implementation | `proposals/wall-clock/design.md`, `docs/DECISIONS.md` | `plugins/wall-clock/src/`, `plugins/wall-clock/tests/` | Pi and OMP command-line tests, isolated OMP install test, native TaskTool child tests, `docs/log/2026-08-12-wall-clock-completion.md`, and `docs/log/2026-08-12-wall-clock-command-ux.md` | verified-live |
| Nested assignment limits | `proposals/wall-clock/nested-assignment-limits.md` | not implemented | data-shape sign-off and Gate 0 still required | proposed |
| Initiative reporting | `skills/initiative-standup/SKILL.md` | `skills/initiative-standup/SKILL.md` plus Memex and optional Herdr navigation | `memex index` and the `nicosuave.memex` refresh action succeeded 2026-08-12 | documented |
| Claude skill token reporting | — | `tools/claude-skill-usage.ts`, `tools/claude-skill-usage-core.ts` | parser tests and local `--since 2026-08-10` smoke report | verified-live |
| Direct execution lane | `skills/do-it-now/SKILL.md`, `plugins/wall-clock/src/host.ts` | `plugins/wall-clock/tests/host.test.ts` and skill contract inspection | documented |
| Papercut logging | `skills/papercut/SKILL.md` | `skills/papercut/scripts/papercut.sh` | append-only `~/PAPERCUTS.md`, `--path`/`PAPERCUTS_PATH`, `--repo` metadata | documented |
| Completion lane | `skills/wrap-it-up/SKILL.md`, `plugins/wall-clock/src/host.ts` | `plugins/wall-clock/tests/host.test.ts` | two-minute native host guard and skill contract inspection | documented |
| Decision log | `docs/DECISIONS.md` | — | this map | documented |
| Distilled taste | `docs/taste.md` | — | this map | documented |
| Review capture | `docs/review/2026-08-11-wall-clock-round-1-answers.md` | `.context/review/2026-08-11-wall-clock-round-1.md` | raw snapshot and answers doc | verified-live |

## Maintenance rule

Before editing, read this map and follow its pointers to the source documents or code. When work changes the project's understanding or implementation, update this map in the same commit. Keep the map short, keep review snapshots under `.context/`, and record future human decisions in the append-only `docs/DECISIONS.md` log.
