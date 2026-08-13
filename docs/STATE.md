# Wall Clock Project State

## What this is

Wall-clock is an Agent Plugins package with native Pi and OMP adapters for enforced time boundaries around agent sessions, assignments, and host actions. Codex and Claude are limited to portable package discovery, and Claude proprietary systems are excluded. The product document still has draft approval metadata, but the v0 implementation now matches its reviewed Pi and OMP contract and has real-host evidence.

## Where we are

Current phase: v0 implementation complete on `main`. Pi 0.84.1 and OMP 17.2.15 load the native adapters, inject measured time, block late native work, and abort their real bash executors under `abort-running`. The native `/wallclock` command accepts an optional `start`, defaults an omitted policy to `block-new`, and submits an optional trailing prompt only after activation; idle use starts a turn and active use steers it. The host status display recalculates from the current clock once per second. OMP supports inline batch delegation: a parent can choose any number of independent task items, the host validates the full batch, creates one assignment per item, bounds each child by the parent's hard deadline, and correlates each child by batch index. Running child actions are aborted at child or parent expiry even when the parent policy is `block-new`; child admission fails closed without a tested abort seam. Nested delegation remains deferred. The adapters also recognize explicit `/do-it-now` and `/wrap-it-up` skill invocations and apply a fixed two-minute host guard.

The package is installed and enabled in the normal local OMP profile from the wall-clock plugin checkout. A clean OMP process auto-loaded the extension, activated a one-millisecond contract, and blocked a real shell command after expiry. A newly installed OMP npm plugin needs a full process restart; `/reload-plugins` does not activate it in OMP 17.2.15. The original completion evidence is in `docs/log/2026-08-12-wall-clock-completion.md`; direct-start command and live-status evidence is in `docs/log/2026-08-12-wall-clock-command-ux.md`.

Native wall-clock contracts started by an explicit `/wallclock` command or
`wallclock_start` clear after terminal agent settlement: Pi's
`agent_settled` or OMP's terminal `agent_end`. Expired contracts remain active
through continuations, and cleanup waits for active child work before stopping.
A normal follow-up does not need `/wallclock stop`. Evidence is in
`docs/log/2026-08-13-wall-clock-self-clear.md`.

The current package includes version 3 state validation, assignment and report contracts, report-linked plan revisions, Agent Plugin discovery, and optional MCP operations. Standalone MCP refuses activation and does not replace or mirror native host enforcement. Nested assignment limits are specified but not implemented in `proposals/wall-clock/nested-assignment-limits.md`; the proposed version 4 data shape requires user sign-off before implementation.

Known child-test boundary: the native OMP `TaskTool` tests set `async.enabled` to false, while OMP 17.2.15 defaults it to true. The nested-assignment proposal makes a one-level background-child characterization test its first gate. Current synchronous child evidence must not be presented as proof of normal background-task behavior.

Deferred: Codex and Claude activation [D10] until an open, tested enforcement seam exists; Claude proprietary systems; provider-specific remote cancellation; and a portable visual dashboard. Revisit D10 when v1 host support is scoped and revisit the last two when provider or user-interface requirements become active. From the vibe round: lost-chat recovery via session-history search [D27] and loop-duration recording [D28], revisit triggers in `docs/DECISIONS.md`. The full contract remains in `docs/prds/2026-08-11-wall-clock/prd.md`.

Codex support finding: current Codex hooks make a narrower `block-new` adapter technically possible for covered local tools, but no supported abort-running or universal tool boundary was found. The package-local copy is `plugins/wall-clock/CODEX-SUPPORT.md`; the dated research record and required smoke-test evidence are in `docs/log/2026-08-12-codex-support-finding.md`; v0 activation remains deferred under D10.

The repository now also publishes `skills/initiative-standup/SKILL.md`, a user-invoked standup for recent cross-project initiatives that do not need Linear tickets. It starts with a Memex session ledger across indexed agent sources and repositories, then uses full transcripts and named artifacts to derive initiatives [documented]. On this device, Memex indexes local agent history and the `nicosuave.memex` Herdr plugin is installed; its refresh action succeeded on 2026-08-12 [verified-live]. These are supporting local integrations, not wall-clock enforcement.
The repository now also publishes `skills/understand/SKILL.md`, a user-invoked workflow for building a working model before changing or delegating work. It uses a coverage map, evidence tiers, a gap sweep, teach-back, and a bounded delegation gate; it is documented but not yet field-tested.

`docs/vibe.md` is the repo-level philosophy contract (progress through sifting: fast filter passes, few crystallization stages, deliverable breakdown, symbiotic understanding, recorded judgment, timed loops, in-the-moment friction logs, plus a companion turn-receipt clause). Three review rounds are applied and captured (36 + 8 + 1 items, D20-D35, with D22 and D26 superseded), answers in `docs/review/2026-08-13-vibe-round-{1,2,3}-answers.md`. Review rounds are closed at the user's direction under the two-round bound [D34]; formal approval stays pending and the user edits directly instead. The vibe is the source of truth; skills and the artifact chain are downstream facets [D30, D33]. Proposals are in `docs/log/2026-08-13-sieve-vibe.md` (the user declined to review it; it stands as session minutes). Defaults taken at close-out: the receipt clause stays inside vibe.md; the lc-ticketize/standup overlap audit is a standing offer needing no decision. The skill-scoped notes proposal (P4) stands as a proposal: a papercut-style capture scoped to skills - a one-line note plus which skill, logged at the moment of use. It needs a name that is not "yearn" [D24] before it can be built. One provisional rule: D35.

The downstream revision landed on `sieve-vibe` (2026-08-13, user suspended the push-to-main-immediately rule for this iteration; the branch carries skill edits not yet on main): lc-north-star declares the chain a downstream facet of the vibe with stage and fix-round discipline [D30, D29, D34], its interview now probes understanding [D32], and its quality gates reject prescriptive vibes [D20]; the vibe template's `Means:` field is now `Example:`; `docs/lifecycle.md` declares the vibe upstream of the artifact chain; lc-ticketize requires deliverable tickets with enumerated sub-tickets [D31]; lc-review-capture names endless fix rounds a failure mode [D34]; lc-project-state's AGENTS.md wiring points at `docs/vibe.md` when present. branch-closure and lc-phase-tracker were checked and already align. The improved lc-north-star gates were run against `docs/vibe.md` itself: pass on all gates (details in the session).

Known dependency constraint: the exact OMP development dependency brings optional model and image packages with five high-severity audit findings. `npm audit --omit=optional` reports zero findings. Keep this visible until upstream packages resolve it; do not run an automatic audit fix that changes the tested host version.

## Standing constraints

- An active wall-clock limit must be host-enforced; unsupported activation fails closed. [D4]
- Parent and child agents receive measured elapsed-time context at every turn; agents do not estimate task duration. [D5]
- Pi and OMP are the first enforcement targets; Codex and Claude are package targets only until tested seams exist. [D6]
- Every activation carries `block-new` or `abort-running`; the native slash command defaults an omitted choice to `block-new`. [D7, D15]
- `standup` is ticket-centered; `initiative-standup` is the separate path for cross-project work, must start with a Memex session ledger, and must not require or mutate Linear tickets. [documented]

- Compression preserves a working vertical slice and reports gaps honestly. [D8]
- MCP is optional and never enforces deadlines. [D9]

## Topic index

| Topic | Thinking and decisions | Code | Verified by | Tier |
| --- | --- | --- | --- | --- |
| Product contract | `docs/prds/2026-08-11-wall-clock/vibe.md`, `prd.md` | `plugins/wall-clock/` | `docs/review/2026-08-11-wall-clock-round-1-answers.md` | documented |
| Plugin capability boundary | `docs/prds/2026-08-11-wall-clock/plugin-capabilities.md` | `plugins/wall-clock/plugin.json`, `mcp.json`, `skills/wall-clock/SKILL.md` | `plugins/wall-clock/tests/plugin.test.ts` | documented |
| Runtime implementation | `proposals/wall-clock/design.md`, `docs/DECISIONS.md` | `plugins/wall-clock/src/`, `plugins/wall-clock/tests/` | `npm run check`, `npm test` (74 Node tests and 6 Bun native-runner tests), Pi and OMP command-line tests, isolated OMP install test, native TaskTool child tests, and the dated completion logs | verified-live |
| Nested assignment limits | `proposals/wall-clock/nested-assignment-limits.md` | not implemented | data-shape sign-off and Gate 0 still required | proposed |
| Initiative reporting | `skills/initiative-standup/SKILL.md` | `skills/initiative-standup/SKILL.md` plus Memex session inventory and transcript retrieval, with optional Herdr navigation | `memex index --include-agents` and the `nicosuave.memex` refresh action succeeded 2026-08-12 | documented |
| Understanding before delegation | `skills/understand/SKILL.md` | `skills/understand/SKILL.md` | skill contract inspection and fresh-eyes review | documented |
| Repo philosophy (the sieve) | `docs/vibe.md`, `docs/log/2026-08-13-sieve-vibe.md`, `docs/review/2026-08-13-vibe-round-{1,2,3}-answers.md` | lc- family revised downstream (lc-north-star, vibe template, lifecycle.md, lc-ticketize, lc-review-capture, lc-project-state) on `sieve-vibe`, unmerged per user direction | Plannotator rounds 1-3 applied (D20-D35); improved north-star gates pass on vibe.md; approval pending, edits direct | proposed |
| Direct execution lane | `skills/do-it-now/SKILL.md`, `plugins/wall-clock/src/host.ts` | `plugins/wall-clock/tests/host.test.ts` and skill contract inspection | documented |
| Papercut logging | `skills/papercut/SKILL.md` | `skills/papercut/scripts/papercut.sh` | append-only `~/PAPERCUTS.md`, `--path`/`PAPERCUTS_PATH`, `--repo` metadata | documented |
| Completion lane | `skills/wrap-it-up/SKILL.md`, `plugins/wall-clock/src/host.ts` | `plugins/wall-clock/tests/host.test.ts` | explicit-contract cleanup after terminal settlement, expiry enforcement through continuation, child-work retention, and skill contract inspection | documented |
| Decision log | `docs/DECISIONS.md` | — | this map | documented |
| Distilled taste | `docs/taste.md` | — | this map | documented |
| Review capture | `docs/review/2026-08-11-wall-clock-round-1-answers.md` | `.context/review/2026-08-11-wall-clock-round-1.md` | raw snapshot and answers doc | verified-live |

## Maintenance rule

Before editing, read this map and follow its pointers to the source documents or code. When work changes the project's understanding or implementation, update this map in the same commit. Keep the map short, keep review snapshots under `.context/`, and record future human decisions in the append-only `docs/DECISIONS.md` log.
