# Herdr skill management (2026-08-30)

## What changed

`skills/herdr/` is now a local fork of the upstream `herdrdev/herdr` skill
(`skills/herdr/SKILL.md` in that repository), installed over the upstream copy
in `~/.agents/skills/herdr/`. The lock entry now points at this repository, and
the chezmoi `run_z_sync-agent-plugins.sh` script reinstalls it from
`$HOME/dev/skills` on every `chezmoi apply`, so an upstream
`npx skills update` or Herdr-bundled reinstall cannot silently restore the
gate.

`skills/herdr-voice/SKILL.md` uses direct external CLI control by default:
the voice task selects one exact session and supplies explicit targets on every
targetable command. A Codex process inside a Herdr pane is the fallback when
direct control is unavailable.

## Why

The upstream herdr skill refused all control when `HERDR_ENV` was unset, which
blocked agents running outside Herdr panes (voice tasks, OMP sessions, cron)
from managing Herdr at the user's request. The fork keeps the upstream body
and replaces the refusal with explicit-target rules for outside-session
control: exact `--session <name>`, IDs parsed from list JSON, no `--current`,
no focus reliance.

The voice skill keeps the shortest safe path as its default: direct CLI control
with exact session and target selection. When a live Codex CLI owns the thread
writer or direct control is otherwise unavailable, the fallback relay uses an
addressable Codex task inside Herdr, verifies `HERDR_ENV=1`, and queues work
when direct thread messaging is blocked.

## Verification

- `~/.agents/skills/herdr/SKILL.md` contains the outside-session section and
  no `Requires HERDR_ENV` text after reinstall from this repository.
- `~/.agents/.skill-lock.json` records herdr with source `emo-eth/skills`.
- `~/.agents/skills/herdr-voice/SKILL.md` contains the direct-controller default and restart-aware relay fallback.
- chezmoi apply reinstalls herdr via `npx skills add "$HOME/dev/skills"
  --skill herdr` without error.

## Non-goals

No change to the Herdr CLI, OMP, Pi, or Codex. No auto-trigger policy change:
both skills still activate only on an explicit user request.
