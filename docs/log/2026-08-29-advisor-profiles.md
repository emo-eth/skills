# Advisor profiles

## Delivered contract

`WATCHDOG.yml` is the shared roster across OMP, Pi, and Hermes. Each entry is a named advisor profile with `name`, `enabled`, `instructions`, optional `model`, and optional `tools`.

OMP uses its native advisor subsystem and `/advisor` command surface. The package does not replace or wrap that runtime.

Pi and Hermes use `plugins/advisor-profiles` and expose:

- `/advisor-profile status`
- `/advisor-profile list`
- `/advisor-profile use <name>`
- `/advisor-profile all`
- `/advisor-profile off`
- `/advisor-profile reload`

Selection is session-scoped. Every new session starts with all roster entries whose `enabled` value is not false.

## Review behavior

Pi and Hermes run one host-owned structured review per selected advisor after a completed main-agent turn. Each review returns pass or one note with severity `nit`, `concern`, or `blocker`.

A nit is status-only. A concern or blocker creates at most one marked user follow-up per main turn. Generated correction turns are not reviewed. Exact normalized notes are deduplicated per session. Review errors fail open for the main turn and remain visible in status.

`tools` is intentionally OMP-only. Pi and Hermes have no advisor tool loop and report that limitation rather than simulating one.

Pi resolves explicit `provider/model` selectors against its model registry and authorization state. Hermes splits the same selector into provider and model overrides and requires both `llm.provider_override` and `llm.model_override`; missing grants record `no_model` without changing host routing.

## Vibe advisor

The bundled example contains an enabled `vibe` advisor whose instructions import `@docs/vibe.md`. The import is resolved relative to the owning `WATCHDOG.yml`, so the review prompt receives the project contract without duplicating it.

## Verification

- TypeScript check passed for the Pi package.
- All 41 Pi package tests passed, including the settled-only correction fallback.
- All 79 Hermes adapter tests passed, including provider/model routing, session isolation, bounded state, one-follow-up arbitration, duplicate suppression, correction-turn skipping, malformed config, and fail-open review errors.
- Hermes Plugin Doctor loaded the standalone adapter and registered two hooks.
- OMP 18.0.10 loaded a temporary `WATCHDOG.yml` through its native advisor runtime. `/advisor status` reported `vibe` active and `dormant` paused.
- Pi 0.84.1 loaded the TypeScript extension in a real interactive process. `/advisor-profile status` reported one selected enabled advisor, the disabled advisor, zero follow-ups, and the OMP-only tools limitation.
- Hermes 0.20.4 loaded the plugin from an isolated `HERMES_HOME`. `/advisor-profile list` reported `vibe` enabled and `dormant` disabled. A real `gpt-5.6-sol` turn returned `VIBE_OK`; the following `/advisor-profile status` reported `vibe: pass`.

## Boundaries

- OMP direct edits to `WATCHDOG.yml` apply on the next session; `/advisor configure` is the native live TUI reload path.
- Pi and Hermes can reload the roster during a session with `/advisor-profile reload`.
- Pi and Hermes provide secondary review passes, not OMP-equivalent independent tool-using agent runtimes.
- The Hermes smoke used an isolated home and did not enable the plugin in the live default profile.
