# Repository Project State

## What this is

This repository publishes personal skills and twelve executable plugin packages. Wall-clock is the largest runtime package: native Pi and OMP adapters enforce time boundaries around sessions, assignments, and host actions. Codex and Claude remain portable discovery targets, not enforcement hosts.

## Where we are

The shared library is restored to its original 69 skills under `~/.agents/skills`: 68 explicit-only, with `herdr` the sole model-invokable skill. Importing other hosts' libraries had expanded it to 437; the user rejected that expansion, and all 368 additions are now archived outside discovery. `AGENTS.md` explicitly forbids promoting host-specific, bundled, or plugin libraries during path consolidation without user selection. Fresh OMP/Pi loaders and Codex's native `skills/list` each verified 69 active canonical skills; explicit OMP expansion passed, and all three loaders reported no warnings or errors. Codex's bundled source and 35 original plugin skill entries remain disabled independently of plugin tools. Claude has no native shared-root discovery. Hermes remains unsupported by explicit user decision: it ignores invocation metadata and recreates its essential skill under `~/.hermes/skills`; the shared root is now external/read-only rather than its creation target. Restart existing processes to discard loaded catalogs.

The September executable audit covers all twelve packages plus standalone tools and skill helpers. It corrected native adapter, cancellation, persistence, consent, credential-recording, concurrency, input, and partial-application failures. Evidence and remaining boundaries are in `docs/log/2026-09-06-executable-verification.md`. Pstack was inspected but left unchanged at the user's direction. The separately authored `plugins/no-code-comments/` is now advisory-only v0.4.0 and remains uninstalled; it never rewrites tool arguments. A full OMP restart is required to remove its old hooks from an already-running process.

Wall-clock's previously claimed v0 completion was too broad. Pi 0.84.1 and OMP 17.2.15 load native adapters, inject measured time, block late work, and abort tested native bash executors under `abort-running`. `/wallclock` accepts an optional `start`, defaults to `block-new`, and submits an optional trailing prompt after activation. The status display recalculates once per second. Pre-created single OMP assignments are tested; inline batch delegation is not supported by the pinned host because its native task schema strips `tasks[].wallClock` before admission. Do not infer batch support from direct-hook tests. Nested delegation remains deferred. Explicit `/do-it-now` and `/wrap-it-up` invocations apply a fixed two-minute guard.

The package is installed and enabled in the normal local OMP profile from the wall-clock plugin checkout. A clean OMP process auto-loaded the extension, activated a one-millisecond contract, and blocked a real shell command after expiry. A newly installed OMP npm plugin needs a full process restart; `/reload-plugins` does not activate it in OMP 17.2.15. The original completion evidence is in `docs/log/2026-08-12-wall-clock-completion.md`; direct-start command and live-status evidence is in `docs/log/2026-08-12-wall-clock-command-ux.md`.

Normal contracts started by `/wallclock` or `wallclock_start` persist until explicit stop. Configured turn-limit contracts return to armed state after terminal settlement, waiting for the next real turn. The September regressions cover armed-session restoration, duration changes, and fast-lane call-limit persistence. The older self-clear log is historical evidence, not the current contract.

The current package includes persisted-state validation with mode and
configured-duration fields, assignment and report contracts, report-linked
plan revisions, and skill-only Agent Plugin discovery. The root `mcp.json`,
standalone MCP server, and MCP tests were removed under D42 because OMP
enumerated both MCP and native copies of the wall-clock operations even though
MCP could not enforce activation. Native Pi and OMP tools are now the sole
operation catalog.
Nested assignment limits are specified but not implemented in
`proposals/wall-clock/nested-assignment-limits.md`; that future data shape is
now version 5 and still requires separate user sign-off.

An OMP task child spawned when no wall-clock contract was invoked stays
outside wall-clock coordination. An uncorrelated child lifecycle fails closed
only when a listener can identify an active parent contract; inactive or
unidentified ordinary lifecycle events remain transparent. The host-level
event-bus regression and native OMP `TaskTool` runner cover this boundary.
OMP 18.1.4 sessionless RPC processes are also transparent while wall-clock is
inactive. Tool admission now requires a stable session scope only when the
controller has an active contract; active contracts still fail closed when
scope is unavailable. The focused missing-scope regression and a fresh
`omp --mode rpc --no-session` run both cover this boundary, with native
`grok_auth` completing successfully after the fix.
The native Pi runner separately verifies that an inactive parent admits a
`subagent` proposal and an independent inactive child session executes a real
`read`. This covers the Pi adapter boundary without claiming a model-backed
`pi-subagents` process smoke, which still requires configured Pi credentials.

Known child-test boundary: the native OMP `TaskTool` tests set `async.enabled` to false, while OMP 17.2.15 defaults it to true. The nested-assignment proposal makes a one-level background-child characterization test its first gate. Current synchronous child evidence must not be presented as proof of normal background-task behavior.

Deferred: Codex and Claude activation [D10] until an open, tested enforcement seam exists; Claude proprietary systems; provider-specific remote cancellation; and a portable visual dashboard. Revisit D10 when v1 host support is scoped and revisit the last two when provider or user-interface requirements become active. From the vibe round: lost-chat recovery via session-history search [D27] and loop-duration recording [D28], revisit triggers in `docs/DECISIONS.md`. The full contract remains in `docs/prds/2026-08-11-wall-clock/prd.md`.

Codex support finding: current Codex hooks make a narrower `block-new` adapter technically possible for covered local tools, but no supported abort-running or universal tool boundary was found. The package-local copy is `plugins/wall-clock/CODEX-SUPPORT.md`; the dated research record and required smoke-test evidence are in `docs/log/2026-08-12-codex-support-finding.md`; v0 activation remains deferred under D10.

The repository now also publishes `skills/initiative-standup/SKILL.md`, a user-invoked standup for recent cross-project initiatives that do not need Linear tickets. It starts with a Memex session ledger across indexed agent sources and repositories, then uses full transcripts and named artifacts to derive initiatives [documented]. On this device, Memex indexes local agent history and the `nicosuave.memex` Herdr plugin is installed; its refresh action succeeded on 2026-08-12 [verified-live]. These are supporting local integrations, not wall-clock enforcement.
The repository now also publishes `skills/understand/SKILL.md`, a user-invoked workflow for building a working model before changing or delegating work. It uses a coverage map, evidence tiers, a gap sweep, teach-back, and a bounded delegation gate; it is documented but not yet field-tested.
The repository now also includes `plugins/skiterate/`, the command-only Agent Plugins package named by D36 for V7's in-the-moment skill notes. It registers `/skiterate` in Pi 0.84.1 and OMP 17.2.15, appends one Markdown-prefixed JSON record to `SKITERATE_PATH` or `~/SKITERATE.md`, and records datetime, repository identity, worktree, branch or detached commit, cwd, host agent, model, note, and explicit or detected skill [verified-live]. Both hosts expose native command registration and lifecycle events; neither exposes a dedicated last-invoked-skill field, so adapters parse Pi skill blocks and OMP skill-prompt markers/details. The capability gate, GAPs, and clean OMP proof are in `docs/log/2026-08-13-skiterate.md`.

`docs/vibe.md` is the repo-level philosophy contract (progress through sifting: fast filter passes, few crystallization stages, deliverable breakdown, symbiotic understanding, recorded judgment, timed loops, in-the-moment friction logs, plus a companion turn-receipt clause). Three review rounds are applied and captured (36 + 8 + 1 items, D20-D35, with D22 and D26 superseded), answers in `docs/review/2026-08-13-vibe-round-{1,2,3}-answers.md`. Review rounds are closed at the user's direction under the two-round bound [D34]; formal approval stays pending and the user edits directly instead. The vibe is the source of truth; skills and the artifact chain are downstream facets [D30, D33]. Proposals are in `docs/log/2026-08-13-sieve-vibe.md` (the user declined to review it; it stands as session minutes). Defaults taken at close-out: the receipt clause stays inside vibe.md. The ticketize/standup overlap audit ran in herdr worktree w2C and is at `docs/log/2026-08-13-ticketize-standup-overlap.md`: standup does not replace lc-ticketize; the verdict is keep-and-revise (explicit deliverable/sub-ticket shape [D31], a stated boundary against standup's daily delta, one canonical ticket contract instead of the two drift-prone copies, a named owner for parent-close aggregation, and no claim to own understanding measurement). Open gaps the audit named: no skill owns the pre-ticketize understanding check, the parent-close handoff, the branch-closure-to-standup transfer, or one shared sub-ticket data shape. The skill-scoped notes proposal (P4) is now implemented as `plugins/skiterate/`, the command-only package named by D36; capability and live evidence are in `docs/log/2026-08-13-skiterate.md`. The name remains provisional pending any rename. Receipt delivery is also a plugin, staged [D37]: v1 succinct per-turn reminder via the wall-clock turn-context seam, v2 collapsible above-the-fold UI, v3 companion model; the global-instruction route is dropped. One provisional rule: D35.

The downstream revision developed on `sieve-vibe` is now on `main` (PR #2): lc-north-star declares the chain a downstream facet of the vibe with stage and fix-round discipline [D30, D29, D34], its interview probes understanding [D32] and batches all currently known blocking questions instead of serializing independent questions one per turn, and its quality gates reject prescriptive vibes [D20]; the vibe template's `Means:` field is now `Example:`; `docs/lifecycle.md` declares the vibe upstream of the artifact chain; lc-ticketize requires deliverable tickets with enumerated sub-tickets [D31]; lc-review-capture names endless fix rounds a failure mode [D34]; lc-project-state's AGENTS.md wiring points at `docs/vibe.md` when present. branch-closure and lc-phase-tracker were checked and already align. The improved lc-north-star gates were run against `docs/vibe.md` itself: pass on all gates (details in the session).

On `ticketize-revision` (2026-08-13), the overlap-audit follow-on gives
`lc-ticketize` one parent ticket per deliverable with tracked sub-tickets and
named dependencies, routes unsettled input to `synthesize` or `understand`,
keeps `standup` on small deltas, uses one canonical ticket contract, and names
the child-proof handoff to parent close.

Both finished fanout branches are merged into `sieve-vibe` (2026-08-13):
`ticketize-revision` (docs revision above; the merge also restored the
"merge alone does not close a parent whose proof needs live behavior or a
measurement" sentence) and `skiterate` (v1 command plugin; package tests 7/7
reproduced by the orchestrator). The third tree, `turn-receipt`, completed
v1 with clean-OMP injection evidence, but its worktree is mid-rename to
`turn-summary` under the user's hands (plugin installed, working tree
uncommitted). It is not integrated; the tree stays untouched until the user
says the rename settled.

The repository also includes `plugins/grok-search/` v0.2.2, a native Pi and OMP X-retrieval plugin whose product contract is `docs/prds/2026-09-02-grok-search/vibe.md`. It exposes only `grok_search`, `grok_fetch`, and `grok_auth`; resolves credentials for every action; prefers supported subscription OAuth over API-key billing; treats quota exhaustion as terminal; and requires host approval before device authorization contacts xAI. Returned authored, related, and discussion objects survive only when their exact X identities appear in xAI's comprehensive citation list and their relations match the requested provenance. Status fetches now direct `grok-4` to run targeted `conversation_id:<id> from:<actual handle>`, `quoted_tweet_id:<id>`, and `in_reply_to_status_id:<id>` X searches, which makes each returned expansion independently citable. Fresh OMP 18.1.4 runs verified natural search and URL-fetch routing, cited search with sparse/conflicting-evidence caveats, `grok-4` forwarding, the `grok-4-fast` default, and anchor retrieval with media. A live authored fetch returned the cited continuation with no warnings, and a live discussion fetch returned four cited examples from ten citations with no warnings. Pi loads the worktree adapter and truthfully reports missing Pi-scoped authorization; OMP reuses its supported host xAI OAuth. Human device completion, token rotation, quota exhaustion, and X Article retrieval remain live-unverified.

Three harness-surface feel contracts are approved: `docs/prds/2026-09-02-local-model-router/vibe.md`, `docs/prds/2026-09-02-session-history/vibe.md`, and `docs/prds/2026-09-02-agent-memory/vibe.md`. The router is a normal tailnet inference provider with exact model identities, fair responsiveness, fail-fast unavailable/capacity errors, invisible caller placement, and linked operator diagnostics. Session history is one provenance-preserving corpus across every user-approved connected source, searchable by any authenticated tailnet agent on explicit nudges or clear plot continuity, with concise cited answers and honest few-minute freshness. Agent memory is selective, provenance-bearing shared judgment with user governance, explicit conflicts, global and scoped applicability, and proactive high-confidence recall. CASS is the likely session-history mechanism, not part of its feel contract.

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
| Global skill policy | `AGENTS.md` installation contract | installed-source `SKILL.md` frontmatter and `agents/openai.yaml`; wall-clock plugin skill | native OMP/Pi discovery, explicit OMP expansion, Codex `skills/list` plus invocation metadata, published metadata checks, focused wall-clock package checks | verified-live for named checks; Hermes unsupported |
| Product contract | `docs/prds/2026-08-11-wall-clock/vibe.md`, `prd.md` | `plugins/wall-clock/` | `docs/review/2026-08-11-wall-clock-round-1-answers.md` | documented |
| Plugin capability boundary | `docs/prds/2026-08-11-wall-clock/plugin-capabilities.md` | `plugins/wall-clock/plugin.json`, `skills/wall-clock/SKILL.md` | `plugins/wall-clock/tests/plugin.test.ts` | documented |
| Runtime implementation | `proposals/wall-clock/design.md`, `docs/DECISIONS.md` | `plugins/wall-clock/src/`, `plugins/wall-clock/tests/` | September audit log for current checks and limitations; older completion logs for the specific live scenarios they exercised | verified-live for named scenarios only |
| Nested assignment limits | `proposals/wall-clock/nested-assignment-limits.md` | not implemented | data-shape sign-off and Gate 0 still required | proposed |
| Skiterate notes | `docs/DECISIONS.md` D36, `docs/vibe.md` V7 | `plugins/skiterate/` | package `npm run check`, `npm test`, and clean OMP 17.2.15 RPC with `SKITERATE_PATH` override | verified-live |
| Initiative reporting | `skills/initiative-standup/SKILL.md` | `skills/initiative-standup/SKILL.md` plus Memex session inventory and transcript retrieval, with optional Herdr navigation | `memex index --include-agents` and the `nicosuave.memex` refresh action succeeded 2026-08-12 | documented |
| Understanding before delegation | `skills/understand/SKILL.md` | `skills/understand/SKILL.md` | skill contract inspection and fresh-eyes review | documented |
| Repo philosophy (the sieve) | `docs/vibe.md`, `docs/log/2026-08-13-sieve-vibe.md`, `docs/review/2026-08-13-vibe-round-{1,2,3}-answers.md` | lc- family revisions (lc-north-star, vibe template, lifecycle.md, lc-ticketize, lc-review-capture, lc-project-state) on `main` | Plannotator rounds 1-3 applied (D20-D35); improved north-star gates pass on vibe.md; approval pending, edits direct | proposed |
| Direct execution lane | `skills/do-it-now/SKILL.md`, `plugins/wall-clock/src/host.ts` | `plugins/wall-clock/tests/host.test.ts` and skill contract inspection | documented |
| Papercut logging | `skills/papercut/SKILL.md` | `skills/papercut/scripts/papercut.sh` | append-only `~/PAPERCUTS.md`, `--path`/`PAPERCUTS_PATH`, `--repo` metadata | documented |
| Completion lane | `skills/wrap-it-up/SKILL.md`, `plugins/wall-clock/src/host.ts` | `plugins/wall-clock/tests/host.test.ts` | fixed fast-lane guard, expiry enforcement, child-work retention, and persisted call-limit regression | source-verified |
| Grok X retrieval | `docs/prds/2026-09-02-grok-search/vibe.md` | `plugins/grok-search/src/`, `plugins/grok-search/scripts/`, `plugins/grok-search/tests/` | September audit for current consent and URL-identity checks; prior live search/fetch evidence described above | verified-live for named scenarios only |
| Executable repository audit | `docs/log/2026-09-06-executable-verification.md` | twelve plugin packages, `tools/`, non-pstack executable skill helpers | package checks, native runners, isolated CLI/script smokes; explicit external-service and host gaps | source-verified and isolated-runtime-verified |
| Local model router | `docs/prds/2026-09-02-local-model-router/vibe.md` | not implemented | Batched north-star interview and explicit user approval on 2026-09-03 | documented |
| Session history | `docs/prds/2026-09-02-session-history/vibe.md` | not implemented; CASS is the likely mechanism | Batched north-star interview and explicit user approval on 2026-09-03 | documented |
| Agent memory | `docs/prds/2026-09-02-agent-memory/vibe.md` | not implemented | Batched north-star interview and explicit user approval on 2026-09-03 | documented |
| Decision log | `docs/DECISIONS.md` | — | this map | documented |
| Distilled taste | `docs/taste.md` | — | this map | documented |
| Review capture | `docs/review/2026-08-11-wall-clock-round-1-answers.md` | `.context/review/2026-08-11-wall-clock-round-1.md` | raw snapshot and answers doc | verified-live |

## Maintenance rule

Before editing, read this map and follow its pointers to the source documents or code. When work changes the project's understanding or implementation, update this map in the same commit. Keep the map short, keep review snapshots under `.context/`, and record future human decisions in the append-only `docs/DECISIONS.md` log.
