# Executable repository verification — 2026-09-06

## Result and scope

Checked all twelve plugin packages, standalone TypeScript tools, and executable skill helpers. The original plugin checks and suites were green; contract review and focused reproductions exposed failures they did not cover. The corrected final package matrix passes. This is not a claim that every external-service integration has been exercised live.

The user excluded `skills/pstack/` from edits. Its baseline checks ran and source findings are listed below, but its code and tests remain unchanged. The user separately approved converting the locally authored no-code-comments plugin to advisory-only; it is not the pstack no-comments reviewer skill.

Terms: **native runner** means a pinned Pi/OMP extension runner with real host hooks/tools; it is not the user's currently running session. **isolated smoke** means the actual CLI or script ran against temporary files and fake external endpoints. **live-unverified** means this audit did not exercise the real external service or restarted user process.

## Fixed contracts

- **Wall-clock:** control operations remain admissible; sessionless inactive bash remains transparent; active missing-scope calls still fail closed. Restored turn-limit sessions can re-arm. Duration changes preserve wrap-up and assignment bounds. A live assignment/action prevents contract replacement. Initial async task results retain correlation until terminal lifecycle delivery. Context exposes measured elapsed fields. Fast-lane identity and call limits survive session reconstruction. The direct-hook regressions do not establish native inline-batch support.
- **Advisor profiles:** Hermes `use off` actually disables the profile; Pi displays nit feedback; an earlier duplicate nit no longer suppresses a later blocker in the same review batch.
- **Bug/skiterate recorders:** native turn start/end metadata and session-manager identity are used. Recorded repository URLs remove HTTP userinfo and SSH passwords while preserving valid SSH usernames and SCP-style remotes. Credential tests use synthetic credentials only.
- **Focus order:** native context UI/session APIs receive updates; failed workspace discovery is an error rather than identity loss; serialized, re-read state mutations preserve concurrent guard changes; blank Enter focuses the selected agent. Focusing intentionally leaves the modal open; disabling the guard closes it. The real attention CLI ran against a temporary socket/state directory, not the user's Herdr session.
- **Pi bots:** disposing a runtime cancels unanswered child requests, releases response listeners/timers, and rejects pending work promptly; repeated disposal is safe.
- **Plugin updater:** updating a disabled plugin restores its disabled state, including detached self-update. Failure to restore that state is reported as failure. Herdr minimum-version output is recognized. Tests execute a temporary stateful plugin-manager command, not a real update of every installed plugin.
- **Grok search:** both adapters own an explicit host confirmation before device authorization starts; approval metadata alone cannot bypass it. Status and completion remain noninteractive. Credentials are resolved each action rather than skipped because of stale OAuth hints. X status identity parsing rejects digit-prefix lookalikes while accepting legitimate media suffixes. Native tests stub provider subprocesses; this audit did not authorize a real new device.
- **No-code-comments v0.4.0:** policy prompt plus `/no-code-comments` only. TypeScript and Hermes scanners and rewriting hooks are removed. Actual Pi/OMP write/edit runner scenarios preserve valid commented source byte-for-byte. It remains uninstalled from the normal OMP profile.
- **Standalone CLIs:** lazy input handling fixes open-pipe help startup and exhausted-stdin hangs; arrow keys pass through the caller's normalizer. `--bin --input` uses local fixtures without Linear access. Empty assigned lists finish cleanly. Bin/top-k application checkpoints survive partial Linear failures and resume only pending authorized updates, without asking the user to repeat ranking decisions.
- **Skill helpers:** preflight includes nonignored untracked code without including its own scratch files, including macOS physical-path aliases. Failed comment retrieval preserves the previous refresh stamp and fails visibly. Status logging emits valid single-line JSON for multiline/tab/quoted strings and numeric `01`. Wizard templates consume input lazily and preserve blank answers.

## Final checks

Every package passed `npm run check`, `npm test`, and `npm pack --dry-run --json --ignore-scripts`. Advisor Hermes tests additionally ran with `uv run --with pyyaml python -m unittest discover -s hermes/tests -v`.

| Package | Node tests | Native Bun tests | Python tests |
| --- | ---: | ---: | ---: |
| advisor-profiles | 43 | — | 80 |
| bug-command | 14 | 1 | — |
| focus-order | 113 | — | — |
| grok-search | 31 | 3 | 28 |
| hard-update-restart | 13 | — | — |
| model-invocable-skills | 4 | — | — |
| no-code-comments | 4 | 2 | 2 |
| pi-bots | 85 | — | — |
| plugin-updater | 22 | — | — |
| skiterate | 9 | — | — |
| turn-summary | 8 | 1 | — |
| wall-clock | 108 | 7 | — |
| **Total** | **454** | **14** | **110** |

Additional evidence:

- All 29 `tools/*.test.ts` tests pass, including actual CLI child processes with local fixture data and a stateful fake Linear executable.
- All 35 enumerated shell/Python helpers parse (`bash -n` or Python AST parsing).
- Baseline pstack Bun tests/typecheck passed before the user excluded changes. This does not negate its source-review findings below.
- Isolated agent-skill-usage CLI: one fixture file, two usage records, 45 total tokens; alpha attributed 40, unknown 5.
- Baseline-vs-fixed shell smokes: multiline status JSON changes from invalid to valid; failed refresh changes from success/stamp overwrite to failure/stamp preservation; untracked source changes from omitted to included, without scratch pollution.
- Review CLI `--help` succeeds with stdin left open. Prioritizer `--input -` reaches its pause path at EOF rather than an unsettled top-level await. Attention CLI receives blank Enter, dispatches focus, and exits cleanly after guard disable.

Local raw evidence is under ignored `.context/verification/`: `<package>-check.log`, `<package>-test.log`, `<package>-pack.log`, `tools-final.log`, `advisor-hermes-final.log`, `focus-enter-only.log`, `script-smokes.json`, `syntax-final.json`, and `final-counts.json`. These local logs are not distributed with the repository; this record carries their results and reproducible commands.

## Confirmed limits and excluded findings

1. **Native OMP inline wall-clock batches are unsupported on pinned 17.2.15.** Parsing a real task item drops `wallClock` before the admission hook: input contains the field; parsed output contains only `agent` and `task`. A schema-only extension preserving native task-call correlation was not found. No wrapper with unproven call-ID behavior was added. Use one pre-created unbound assignment for one task call. Changing the native batch contract requires upstream host work, not another direct-hook test.
2. **Background child cancellation is not fully proven in the native default async mode.** Existing native TaskTool tests disable async. A focused lifecycle regression now protects initial-running-result correlation, but does not establish end-to-end background cancellation. Nested assignment enforcement also remains deferred.
3. **Pstack findings remain unfixed by user direction:** review-thread pagination can miss later unresolved threads; cyclic PR stacks can loop; watcher deadlines and subprocess spawn failures lack complete handling; stale-lock takeover and inbox drain/read have concurrency races; worktree paths with spaces are truncated; the plan checker mishandles valid fence forms. These are source-review findings, not claims that each scenario was executed against live GitHub or user stores.
4. **External-service boundaries:** no real Linear issues were changed; no real xAI device authorization, billing/quota exhaustion, or token rotation was attempted; no user Herdr panes were controlled. Native runners and fake CLIs cannot establish those live behaviors. Existing earlier live evidence in STATE remains scoped to its named scenarios.
5. **Dependency risk remains visible:** the previously documented pinned-host optional model/image dependency audit findings were not automatically upgraded away. This run did not claim a new security audit.

## Publication and installed processes

The agent owns commit/push to `main` and reinstalling the enabled wall-clock and bug-command packages from that exact pushed checkout into the normal OMP profile. No-code-comments was uninstalled successfully and must not be reinstalled as part of this audit. Other plugin enablement remains unchanged.

The user's only required installation action is a full OMP restart. Installing or uninstalling changes the profile on disk, not hooks already loaded in the current process; `/reload-plugins` is insufficient for this npm-plugin cutover. After restart, the agent must run a live smoke before claiming these patches are active in the user's session.
