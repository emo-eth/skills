# Herdr voice delegation (2026-08-30)

## What changed

`skills/herdr-voice/SKILL.md` is now delegation-only. The voice task never
runs Herdr commands and never manages task subagents. It spins up one OMP
delegate with `omp -p`, hands it the user's Herdr request verbatim, relays
the delegate's printed final output, and continues the same session with
`omp -p -c` for follow-ups and answers to the delegate's questions. Direct
external CLI control from the voice task and the Codex-in-Herdr relay
fallback are removed; if OMP cannot start or the delegate fails, the voice
task reports that instead of controlling Herdr itself.

## Why

The voice agent should only ever delegate. It must not control Herdr
directly and must not be responsible for managing task subagents. Spinning
up OMP and telling it to manage Herdr agents keeps the voice loop to
handoff, relay, and follow-up, while the OMP delegate reads the installed
`herdr` skill, follows external-controller rules, and owns any subagent
management it needs.

## Verification

- Live read-only smoke of the exact handoff template: `omp -p` from
  outside Herdr used the installed herdr skill, listed the running
  sessions, and enumerated the default session's workspaces and tabs with
  explicit session targeting. The delegate reported the full layout (9
  workspaces) and changed nothing; wall time 98 seconds.
- `npx skills add "$HOME/dev/skills" --skill herdr-voice --global --agent universal --yes`
  reinstalled the skill, and the installed copy at
  `~/.agents/skills/herdr-voice/SKILL.md` matches the repository exactly.

## Non-goals

No change to the `herdr` skill, the Herdr CLI, OMP, Pi, or Codex. No
auto-trigger policy change: the skill still activates only on an explicit
user request for Herdr control from a voice task.
