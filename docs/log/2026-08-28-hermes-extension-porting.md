# Hermes extension porting start

## Scope

The repository was fast-forwarded from `e9494b7` to `9b4c52b`, bringing the local `main` checkout even with `origin/main` before porting work began. Existing runtime packages were classified by whether Hermes has a real native seam and whether the capability is still useful there.

## First port

`plugins/no-code-comments/hermes/` is the first native Hermes adapter:

- `plugin.yaml` declares a default-off standalone plugin.
- `tool_request` middleware rewrites `write_file`, replacement-mode `patch`, and V4A patch additions before guardrails, approvals, and execution.
- `pre_tool_call` blocks likely comment syntax for unsupported code extensions.
- A bounded system-prompt section states the policy; it is guidance, not the enforcement claim.
- `/no-code-comments` renders the active policy.
- The stdlib-only Python implementation has no install-time dependencies.

The adapter is intentionally a host-specific Python boundary beside the shared Pi/OMP TypeScript package rather than a core Hermes patch. It can be installed from the repository subdirectory and remains disabled until explicitly enabled.

## Candidate order

1. `no-code-comments` — ported and real-host verified.
2. `bug-command` — good next port because Hermes directly supports slash commands and session-aware hooks; preserve append-only records and explicit path overrides.
3. `turn-summary` — technically straightforward through `pre_llm_call`, but first check whether it adds anything beyond Hermes/BMO's existing response contract.
4. `wall-clock` — useful but not a mechanical port. It needs a Hermes lifecycle, session persistence, delegation, pre-tool gating, and cancellation capability map before implementation.
5. `model-invocable-skills` — likely reference-only for Hermes because Hermes already exposes skill discovery and explicit `skill_view`; do not clone Pi's widget without a missing Hermes UX.
6. `grok-search` — Hermes already has `x_search` and xAI web tooling. Port only capabilities absent from the native surface instead of creating duplicate tools.
7. `focus-order` and `hard-update-restart` — remain Herdr plugins. Their agent companions may gain Hermes support separately, but the Herdr control-plane code should not be disguised as a Hermes plugin.

## Verification receipt

- Hermes Plugin Doctor passed runtime discovery, manifest parsing, import, and registration.
- Six Python unit tests passed.
- Existing TypeScript check, six Node tests, and native OMP runner test passed.
- An isolated real Hermes host rewrote an actual `write_file` dispatch and blocked an unsupported write before file creation.
- A real `execute_code` child called `hermes_tools.write_file`; the nested write traversed middleware and landed comment-free.
- The live default Hermes profile was not changed or restarted in this first port.
