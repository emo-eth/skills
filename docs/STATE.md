# Wall Clock Project State

## What this is

Wall-clock is an Agent Plugins package with native Pi and OMP adapters for enforced time boundaries around agent sessions, assignments, and host actions. Codex and Claude are limited to portable package discovery, and Claude proprietary systems are excluded. The product document still has draft approval metadata, but the v0 implementation now matches its reviewed Pi and OMP contract and has real-host evidence.

## Where we are

Current phase: v1 turn-limit mode implementation complete on `main`. Pi 0.84.1 and OMP 17.2.15 load the native adapters, inject measured time plus phase-specific action guidance, enforce the selected expiry policy, and support `/wallclock turn-limit <duration>` plus `/wallclock set <duration>`. Normal deadline contracts remain active after terminal settlement, count down to zero, remain expired and enforced until `/wallclock stop`, and turn-limit contracts remain active, arm after terminal settlement, and reset the owner deadline at the next normal user message. Steering messages keep the current deadline; child deadlines are not extended by owner turn resets.

The package is installed and enabled in the normal local OMP profile from the wall-clock plugin checkout. A clean OMP process auto-loaded the extension, activated a one-millisecond contract, and blocked a real shell command after expiry. A newly installed OMP npm plugin needs a full process restart; `/reload-plugins` does not activate it in OMP 17.2.15. The original completion evidence is in `docs/log/2026-08-12-wall-clock-completion.md`; direct-start command and live-status evidence is in `docs/log/2026-08-12-wall-clock-command-ux.md`.

Native wall-clock contracts started by an explicit `/wallclock` command or
`wallclock_start` use terminal settlement for lifecycle handling. Normal
deadline contracts remain active after settlement and stay visible after
expiry until `/wallclock stop`. `turn-limit` contracts stay active after
settlement and start their next owner window at the next normal user message;
steering messages do not reset or extend that window. Expiry stays enforced
through the current turn, and active child work retains its own deadline.
Evidence is in the focused controller and host tests plus the Pi and OMP
native runner tests.

The current package includes the current persisted-state validation with mode
and configured-duration fields, assignment and report contracts, report-linked
plan revisions, Agent Plugin discovery, and optional MCP operations.
MCP refuses activation and does not replace or mirror native host enforcement.
Nested assignment limits are specified but not implemented in
`proposals/wall-clock/nested-assignment-limits.md`; that future data shape is
now version 5 and still requires separate user sign-off.

Known child-test boundary: the native OMP `TaskTool` tests set `async.enabled` to false, while OMP 17.2.15 defaults it to true. The nested-assignment proposal makes a one-level background-child characterization test its first gate. Current synchronous child evidence must not be presented as proof of normal background-task behavior.

Turn-summary v1 is now on `main` at `plugins/turn-summary/`. Native Pi and OMP adapters append one fixed end-of-turn reminder through the `context` seam; `/summary on|off` uses the optional native command seam. The package has no model calls, UI, or MCP surface. Installed local profiles are enabled, and the dated package and live-host evidence is in `docs/log/2026-08-13-turn-summary.md`.

Deferred: Codex and Claude activation [D10] until an open, tested enforcement seam exists; Claude proprietary systems; provider-specific remote cancellation; and a portable visual dashboard. Revisit D10 when v1 host support is scoped and revisit the last two when provider or user-interface requirements become active. From the vibe round: lost-chat recovery via session-history search [D27] and loop-duration recording [D28], revisit triggers in `docs/DECISIONS.md`. The full contract remains in `docs/prds/2026-08-11-wall-clock/prd.md`.

Codex support finding: current Codex hooks make a narrower `block-new` adapter technically possible for covered local tools, but no supported abort-running or universal tool boundary was found. The package-local copy is `plugins/wall-clock/CODEX-SUPPORT.md`; the dated research record and required smoke-test evidence are in `docs/log/2026-08-12-codex-support-finding.md`; v0 activation remains deferred under D10.

The repository now also publishes `skills/initiative-standup/SKILL.md`, a user-invoked standup for recent cross-project initiatives that do not need Linear tickets. It starts with a Memex session ledger across Memex-supported indexed agent sources and repositories, then uses full transcripts and named artifacts to derive initiatives [documented]. On this device, Memex indexes its supported local agent sources, but it does not index OMP sessions; the `nicosuave.memex` Herdr plugin is installed and its refresh action succeeded on 2026-08-12 [verified-live]. These are supporting local integrations, not wall-clock enforcement.
The repository now also publishes `skills/understand/SKILL.md`, a user-invoked workflow for building a working model before changing or delegating work. It uses a coverage map, evidence tiers, a gap sweep, teach-back, and a bounded delegation gate; it is documented but not yet field-tested.
The repository now also publishes `skills/scope-decision-form/SKILL.md`, a six-field investigation-close form (Goal / What we learned / Decision / One next action / Done when / Do not do). Use it to turn the end of research or a scope discussion into one decision and one next action, with tagged evidence and a visible finish line.
The repository now also publishes `skills/omp-plugin-iteration/SKILL.md`, a model-invoked workflow for changing an OMP runtime plugin, pushing the exact checkout to `main`, reinstalling it into an OMP profile, and separating installed-source verification from live-process verification. The user restarts OMP after installation; the agent owns reinstall.
The repository now also publishes `skills/grok-search/`, a model-invoked skill with a stdlib-only python3 CLI (`scripts/grok-search.py`) for X (Twitter) search, web search, post fetching, plain Grok inference (`prompt`), and model listing (`models`) through xAI's Responses API (server-side `x_search`/`web_search` tools). Credentials, in order: `XAI_API_KEY`; the grok CLI's subscription OAuth token in `~/.grok/auth.json` (never spends its single-use refresh token -- on expiry or 401/403-unauthenticated it runs a minimal `grok -p` call so the CLI rotates its own tokens); or the script's own loopback-PKCE OAuth (`login`/`logout`, tokens in `~/.config/grok-search/auth.json`, self-managed rotation) for machines without the grok CLI. `--brief` returns a raw source list for a smarter model to synthesize; citations are deduplicated by post ID and capped in markdown (`--max-citations`, full list in `--json`); query args accept `-` for stdin. Live-verified on this device: `x`, `fetch`, `web`, `ask`, `prompt` (with `--system` and stdin), `models`, and `auth`; `login` verified to discovery, PKCE URL, and callback bind only -- the browser grant needs a human [verified-live].
The repository now also publishes an OMP-native port of Lauren Tan's pstack at upstream `cursor/plugins` commit `46125561306434d8a1d7745d540d8932ab0cd2a2`. It includes 44 skills, the Comment Sicko prompt, the PR watcher and orchestrator helpers, and the upstream MIT license in every distributed skill. Cursor task, model, cloud-agent, rule, transcript, loop, and control-skill assumptions were replaced with OMP `task`, `hub`, `todo`, `ask`, `browser`, `debug`, `lsp`, `skill://`, `local://`, and `~/.omp/agent/sessions` contracts. `tdd` and `teach` are published as `pstack-tdd` and `pstack-teach` to avoid replacing installed skills from another source. Role configuration lives at `~/.config/pstack/omp-agents.json`. All 44 are installed through the Pi-compatible global skill target that OMP loads. Fresh OMP processes loaded `skill://poteto-mode` and the bundled `skill://no-comments/agents/comment-sicko.md` [verified-live].


The repository now also publishes `skills/rubber-stamp-travel-field-note/`, a model-invoked image-editing procedure that preserves each source travel/place photo on the left of an independent 4:3 poster and generates a small simplified multicolor rubber-stamp memory on warm paper at right. The bundled prompt reference carries the composition, material, typography, exclusion, and validation contract. Codex 0.142.5 built-in `$imagegen` was verified through the active ChatGPT subscription by generating and inspecting a 1448×1086 Venice poster with exact requested text [verified-live].

`docs/vibe.md` is the repo-level philosophy contract (progress through sifting: fast filter passes, few crystallization stages, deliverable breakdown, symbiotic understanding, recorded judgment, timed loops, in-the-moment friction logs, plus a companion turn-summary clause). Three review rounds are applied and captured (36 + 8 + 1 items, D20-D35, with D22 and D26 superseded), answers in `docs/review/2026-08-13-vibe-round-{1,2,3}-answers.md`. Review rounds are closed at the user's direction under the two-round bound [D34]; formal approval stays pending and the user edits directly instead. The vibe is the source of truth; skills and the artifact chain are downstream facets [D30, D33]. Proposals are in `docs/log/2026-08-13-sieve-vibe.md` (the user declined to r…

The direct local token report now lives in `tools/agent-skill-usage.ts` and supports four report harnesses: Claude, Codex, Pi, and OMP. It reads local JSONL logs directly; it does not use Memex for accounting. Claude skill attribution uses native `attributionSkill`. Other harnesses are attributed only when a skill field or `skill://` read appears on the same usage record; earlier user messages and separate tool records do not label later usage. Unlinked usage is `(none)`. Defaults are `~/.claude/projects` or `~/.config/claude/projects`, `~/.codex/sessions`, `~/.pi/agent/sessions`, and `~/.omp/agent/sessions`; environment variables can override each root [verified-focused].

Known dependency constraint: the exact OMP development dependency brings optional model and image packages with five high-severity audit findings. `npm audit --omit=optional` reports zero findings. Keep this visible until upstream packages resolve it; do not run an automatic audit fix that changes the tested host version.

The repository now also contains `plugins/focus-order/`, a Herdr plugin that stores ranked agent and worktree identities, focuses the highest-ranked urgent target's tab without stealing focus between equal-ranked agents in the same worktree, or opens a separate attention popup. Manager rendering is separated from input handling. It uses one-shot startup and event hooks, an atomic attention-owner marker, and optional Pi and OMP companion adapters. The implementation is verified with TypeScript compilation, 105 Node tests, local Herdr manifest linking, action discovery, and an isolated live Herdr session covering startup, hooks, ranking, focus mode, and modal popup opening; the plugin is published on `main`.
The repository now also contains `plugins/bug-command/`, a command-only native
Pi and OMP plugin with five personal log commands: `/bug`, `/fear`, `/journal`,
`/grasp`, and `/do`. Each command takes
`[--plugin <name>] [--skill <name>] <note>` and appends one context-rich JSON
record (repository, worktree, branch, session, turn, recent activity, plugin,
and skill metadata) to its own home file: `~/BUGS.md`, `~/FEARS.md`,
`~/JOURNAL.md`, `~/GRASP.md`, or `~/DO.md`, each overridable with
`BUGS_PATH`, `FEARS_PATH`, `JOURNAL_PATH`, `GRASP_PATH`, or `DO_PATH`. The
package checks and native OMP runner pass; Pi has package adapter proof. The
contract and GAPs are in `docs/log/2026-08-14-bug-command.md` and
`docs/log/2026-08-14-note-commands.md` [verified-focused].
The repository now also publishes `skills/agent-plugin/SKILL.md`, a
model-invoked fast path for building native Pi and OMP plugins. It standardizes
the minimal command or hook contract, shared implementation and thin
adapters, bounded context records, adapter tests, live-host proof, state
updates, and main-branch delivery. The original structural check and cold-reader
attempt are recorded in `docs/log/2026-08-14-agent-plugin-skill.md`; the skill
was then field-tested by the model-invocable-skills plugin with focused checks
and live Pi proof [verified-live].

The repository now also contains `plugins/model-invocable-skills/`, a native
Pi extension that classifies Pi's authoritative loaded skill objects as
model-invocable or user-only. `/model-invocable-skills` renders the source
video's one-line themed model-invocable widget; it refreshes before agent runs.
The pinned Pi 0.84.1 host loaded and executed the command through RPC and
rendered the expected one-line widget in an interactive TUI smoke. Evidence
is in `docs/log/2026-08-16-model-invocable-skills.md` [verified-live].

The repository now also contains `plugins/no-code-comments/`, a native Pi and
OMP `tool_call` input-rewrite extension. It strips prose comments before
`write`, replacement and patch `edit`, hashline, and `ast_edit` payloads run;
preserves semantic directives; and fails closed on likely comment syntax in
unsupported code extensions. Focused TypeScript, Node, package, and native OMP
ExtensionRunner checks pass. The exact enforcement boundary is in
`docs/log/2026-08-24-no-code-comments.md` [verified-focused].

## Standing constraints

- An active wall-clock limit must be host-enforced; unsupported activation fails closed. [D4]
- Parent and child agents receive measured elapsed-time context at every turn; agents do not estimate task duration. [D5]
- Pi and OMP are the first enforcement targets; Codex and Claude are package targets only until tested seams exist. [D6]
- Every activation carries `block-new` or `abort-running`; the native slash command defaults an omitted choice to `block-new`. [D7, D15]
- `turn-limit` is the persistent per-turn mode; terminal settlement arms the owner contract as explicit persisted `turnState: "armed"`, and the next normal user message starts its window. Steering messages keep the current deadline; child deadlines remain fixed. The `/wallclock turn-limit` command defaults to `block-new`; `abort-running` is explicit and fails closed unless the host proves a provider-abort seam. [D37, D38, D39]
- `standup` is ticket-centered; `initiative-standup` is the separate path for cross-project work, must start with a Memex session ledger, and must not require or mutate Linear tickets. [documented]

- Compression preserves a working vertical slice and reports gaps honestly. [D8]
- MCP is optional and never enforces deadlines. [D9]

## Topic index

| Topic | Thinking and decisions | Code | Verified by | Tier |
| --- | --- | --- | --- | --- |
| Product contract | `docs/prds/2026-08-11-wall-clock/vibe.md`, `prd.md` | `plugins/wall-clock/` | `docs/review/2026-08-11-wall-clock-round-1-answers.md` | documented |
| Plugin capability boundary | `docs/prds/2026-08-11-wall-clock/plugin-capabilities.md` | `plugins/wall-clock/plugin.json`, `mcp.json`, `skills/wall-clock/SKILL.md` | `plugins/wall-clock/tests/plugin.test.ts` | documented |
| Runtime implementation | `proposals/wall-clock/design.md`, `docs/DECISIONS.md` | `plugins/wall-clock/src/`, `plugins/wall-clock/tests/` | `npm run check`, serial Node suite (88 tests), 6 Bun native-runner tests, Pi and OMP command-line tests, isolated OMP install test, native TaskTool child tests, and the dated completion logs | verified-live |
| Turn summaries | `docs/DECISIONS.md` D39, `docs/vibe.md` companion clause | `plugins/turn-summary/` | `docs/log/2026-08-13-turn-summary.md`, package checks, installed-plugin Pi and OMP live evidence | verified-live |
| Nested assignment limits | `proposals/wall-clock/nested-assignment-limits.md` | not implemented | data-shape sign-off and Gate 0 still required | proposed |
| Initiative reporting | `skills/initiative-standup/SKILL.md` | `skills/initiative-standup/SKILL.md` plus Memex session inventory and transcript retrieval, with optional Herdr navigation | `memex index --include-agents` and the `nicosuave.memex` refresh action succeeded 2026-08-12 | documented |
| Understanding before delegation | `skills/understand/SKILL.md` | `skills/understand/SKILL.md` | skill contract inspection and fresh-eyes review | documented |
| Investigation close form | `skills/scope-decision-form/SKILL.md` | `skills/scope-decision-form/SKILL.md` | field-by-field walkthrough of the blank form and the Apex filled example | documented |
| Repo philosophy (the sieve) | `docs/vibe.md`, `docs/log/2026-08-13-sieve-vibe.md`, `docs/review/2026-08-13-vibe-round-{1,2,3}-answers.md` | not implemented; proposals P1-P5 in the log, P1/P4 reshaped by D31/D24 | Plannotator rounds 1-3 applied (36 + 8 + 1 items, D20-D35); rounds closed at user direction; approval pending, edits direct | proposed |
| Direct local token reporting | `tools/agent-skill-usage.ts`, `tools/agent-skill-usage-core.ts` | `fixtures/all-source-skill-usage/`, `tools/agent-skill-usage.test.ts` | focused direct-parser tests and live local Claude, Codex, Pi, and OMP smoke reports; Memex is not used for accounting | verified-focused |
| Focus order plugin | none yet | `plugins/focus-order/` | `npm run check`, 98 Node tests, `herdr plugin link`, `herdr plugin action list`, and isolated live Herdr focus/modal smoke | verified-live |
| Personal log commands (bug, fear, journal, grasp, do) | `docs/DECISIONS.md` D40, `docs/log/2026-08-14-bug-command.md`, `docs/log/2026-08-14-note-commands.md` | `plugins/bug-command/` | `npm run check`, 11 Node tests, native OMP runner test, and clean OMP RPC smoke | verified-focused |
| OMP plugin iteration | `skills/omp-plugin-iteration/SKILL.md` | `skills/omp-plugin-iteration/SKILL.md` | skill structure inspection and pushed-install workflow | documented |
| Agent plugin builder | `docs/DECISIONS.md` D41, `docs/log/2026-08-14-agent-plugin-skill.md`, `docs/log/2026-08-16-model-invocable-skills.md` | `skills/agent-plugin/SKILL.md` | structural check, cold-reader attempt, then successful model-invocable-skills field test with live Pi proof | verified-live |
| Skill invocation visibility | `docs/log/2026-08-16-model-invocable-skills.md` | `plugins/model-invocable-skills/` | `npm run check`, 4 Node tests, package dry run, and pinned Pi 0.84.1 RPC plus screenshot-matching interactive TUI smoke | verified-live |
| Comment-free code writes | `docs/log/2026-08-24-no-code-comments.md` | `plugins/no-code-comments/` | `npm run check`, 6 Node tests, package dry run, and native OMP ExtensionRunner input-rewrite smoke | verified-focused |
| Direct execution lane | `skills/do-it-now/SKILL.md`, `plugins/wall-clock/src/host.ts` | `plugins/wall-clock/tests/host.test.ts` and skill contract inspection | documented |
| Papercut logging | `skills/papercut/SKILL.md` | `skills/papercut/scripts/papercut.sh` | append-only `~/PAPERCUTS.md`, `--path`/`PAPERCUTS_PATH`, `--repo` metadata, and a judgment gate that skips harmless oddities without requiring a known fix | documented |
| X/web live search + Grok inference | `skills/grok-search/SKILL.md` | `skills/grok-search/scripts/grok-search.py` | live `x`/`fetch`/`web`/`ask`/`prompt`/`models` calls against api.x.ai with grok CLI OAuth, `--brief` source-list mode, validation error checks; own-OAuth `login` verified to callback bind | verified-live |
| OMP-native pstack | upstream `cursor/plugins@46125561306434d8a1d7745d540d8932ab0cd2a2` | 44 directories under `skills/`, rooted at `skills/poteto-mode/` | 44/44 frontmatter and licenses; relative links and OMP vocabulary; 52 Bun tests; strict TypeScript check; orchestrator and worktree-audit smokes; `npx skills` remote install; fresh OMP loads for poteto-mode and Comment Sicko | verified-live |
| Rubber-stamp travel field notes | `skills/rubber-stamp-travel-field-note/SKILL.md` | `skills/rubber-stamp-travel-field-note/references/poster-spec.md` | Codex 0.142.5 built-in `$imagegen` subscription smoke; 1448×1086 exact 4:3 output and visual acceptance audit | verified-live |
| Completion lane | `skills/wrap-it-up/SKILL.md`, `plugins/wall-clock/src/host.ts` | `plugins/wall-clock/tests/host.test.ts` | explicit-contract cleanup after terminal settlement, expiry enforcement through continuation, child-work retention, and skill contract inspection | documented |
| Decision log | `docs/DECISIONS.md` | — | this map | documented |
| Distilled taste | `docs/taste.md` | — | this map | documented |
| Review capture | `docs/review/2026-08-11-wall-clock-round-1-answers.md` | `.context/review/2026-08-11-wall-clock-round-1.md` | raw snapshot and answers doc | verified-live |

## Maintenance rule

Before editing, read this map and follow its pointers to the source documents or code. When work changes the project's understanding or implementation, update this map in the same commit. Keep the map short, keep review snapshots under `.context/`, and record future human decisions in the append-only `docs/DECISIONS.md` log.
