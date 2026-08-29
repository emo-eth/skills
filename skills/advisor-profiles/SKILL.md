---
name: advisor-profiles
description: "Configure and operate custom advisors and advisor profiles across OMP, Pi, and Hermes: create the WATCHDOG.yml roster (vibe advisor, code-quality advisor, any named profile), enable it with OMP's native /advisor commands or the Pi/Hermes /advisor-profile commands, and know each host's live-switch and restart gaps."
---

# Advisor Profiles

Named advisor profiles are `WATCHDOG.yml` roster entries — each advisor is a selectable reviewer role with its own instructions, optional model, and enable flag. OMP runs the advisor subsystem natively; Pi and Hermes read the same roster through host-owned adapters (`plugins/advisor-profiles`). One file, three hosts, different runtimes: do not pretend parity.

## 1. Create the roster

Write `WATCHDOG.yml` at the repository root. Discovery walks the user agent directory, then project ancestors down to the leaf project; advisors merge by slug (leaf replaces ancestor replaces user), and top-level shared `instructions` concatenate. `@path` instruction imports expand relative to the file's own directory, so a root roster reaches `docs/vibe.md` with `@docs/vibe.md`.

Copy the bundled example (`references/example-watchdog.yml`) to the repository root and trim it. Minimal shape:

```yaml
advisors:
  - name: vibe
    enabled: true
    instructions: |
      Enforce @docs/vibe.md on every review.
  - name: code-quality
    enabled: false
    instructions: |
      Watch for regressions and broken invariants.
```

Each advisor supports `name`, optional `model` (OMP advisor model selector; Pi/Hermes host-owned review route), optional `tools`, optional `instructions`, and optional `enabled` (default true — new sessions activate every advisor whose `enabled` is not false).

## 2. Operate on OMP (native)

- `advisor.enabled: true` in config, or `/advisor on` — start the subsystem for this session.
- `/advisor status` — per-advisor runtime state, model, context, and usage.
- `/advisor configure` — TUI editor for `WATCHDOG.yml`; saving re-discovers the file and rebuilds runtimes in place, no restart. This is the only mid-session re-discovery path, and it is TUI-gated: editing `WATCHDOG.yml` directly takes effect at the next session start.
- `/advisor off` — stop the whole subsystem live; session-scoped, not persisted.
- `enabled: false` renders an advisor paused; there is no per-advisor live toggle — switching one advisor mid-session needs a configure save or a restart.
- `/advisor dump` / `dump raw` — compact or full advisor transcript.
- Optional `WATCHDOG.md` at the same discovery locations adds standing review priorities; it reaches advisors only, never the main agent.

OMP advisors are full agent runtimes with their own tool session: default grant is read/grep/glob, `tools` may grant more, and notes arrive as nit/concern/blocker advisories.

## 3. Operate on Pi and Hermes (adapters)

`plugins/advisor-profiles` implements the cross-runtime command surface:

- `/advisor-profile status` — per-advisor state and recent notes.
- `/advisor-profile list` — roster entries with enabled state.
- `/advisor-profile use <name>` — select one advisor; `/advisor-profile all` — every enabled advisor; `/advisor-profile off` — none. `use all` and `use off` are accepted aliases. All selections are session-scoped: a new session defaults to every advisor whose `enabled` is not false, not to your last selection.
- `/advisor-profile reload` — re-read `WATCHDOG.yml` and refresh the active roster.

Pi/Hermes run one host-owned secondary-model pass per selected advisor after a completed main-agent turn: pass, or one note at severity nit/concern/blocker. Concern/blocker notes become one marked user follow-up the main agent must address; generated correction turns are not re-reviewed; exact duplicate notes are suppressed per session; an advisor failure never fails the main turn and is visible in status.

## 4. Host limits, stated plainly

- OMP: native multi-advisor runtimes, live whole-subsystem toggle, TUI-gated roster reload, advisor tool grants, per-advisor paused states.
- Pi/Hermes: one post-turn review per selected advisor, session-scoped selection, reload command, no tool loop. `tools` is OMP-only; do not present it as supported on Pi/Hermes — say the host cannot, and route tool-granted advisor needs to OMP.
- Hermes `provider/model` selectors require both `llm.provider_override` and `llm.model_override`; a missing grant records `no_model` instead of silently changing routes. Pi likewise reports unavailable or unauthorized selectors instead of falling back.
