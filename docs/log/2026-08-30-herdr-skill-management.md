# Herdr skill management (2026-08-30)

## What changed

`skills/herdr/` is now a local fork of the upstream `herdrdev/herdr` skill
(`skills/herdr/SKILL.md` in that repository), installed over the upstream copy
in `~/.agents/skills/herdr/`. The lock entry now points at this repository, and
the chezmoi `run_z_sync-agent-plugins.sh` script reinstalls it from
`$HOME/dev/skills` on every `chezmoi apply`, so an upstream
`npx skills update` or Herdr-bundled reinstall cannot silently restore the
gate.

`skills/herdr-voice/SKILL.md` is rewritten from direct-CLI-first to
delegation-first: the Codex realtime voice task plans, dispatches, and
reports; text subagents own every `herdr` invocation. The voice agent never
runs `herdr` itself, even for read-only listing.

## Why

The upstream herdr skill refused all control when `HERDR_ENV` was unset, which
blocked agents running outside Herdr panes (voice tasks, OMP sessions, cron)
from managing Herdr at the user's request. The fork keeps the upstream body
and replaces the refusal with explicit-target rules for outside-session
control: exact `--session <name>`, IDs parsed from list JSON, no `--current`,
no focus reliance.

The voice skill inverted its own default: direct CLI control from a voice task
was fragile (session targeting, timeouts, spoken confirmation of JSON), while
text subagents already follow the full herdr skill. Delegation also composes
with the fork: subagents may sit outside Herdr sessions and still control
them with explicit IDs.

## Verification

- `~/.agents/skills/herdr/SKILL.md` contains the outside-session section and
  no `Requires HERDR_ENV` text after reinstall from this repository.
- `~/.agents/.skill-lock.json` records herdr with source `emo-eth/skills`.
- `~/.agents/skills/herdr-voice/SKILL.md` contains the delegation contract.
- chezmoi apply reinstalls herdr via `npx skills add "$HOME/dev/skills"
  --skill herdr` without error.

## Non-goals

No change to the Herdr CLI, OMP, Pi, or Codex. No auto-trigger policy change:
both skills still activate only on an explicit user request.
