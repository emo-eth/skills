---
name: pstack-runtime
description: Translate pstack workflow operations between OMP and Pi. Use whenever a pstack skill runs under OMP or Pi or names task, hub, subagent, todo, ask, skill paths, background processes, browser control, or runtime role configuration.
license: MIT
---

# Pstack runtime bridge

Choose one host branch from the tools that are actually present. Legacy OMP wording in a pstack skill names an operation, not a reason to call a missing OMP tool from Pi.

## Host branches

| Operation | OMP | Pi |
| --- | --- | --- |
| Parallel agents | One `task` batch | One `subagent` `workflowScript` using `runs.all` |
| Default writer | Omit the task item's `agent` | Use `worker` |
| Read-only worker | `scout` | `scout` |
| General reviewer | `reviewer` | `reviewer` |
| Worker status and steering | `hub jobs`, `hub inbox`, `hub send`, and `hub wait` | `subagent` actions `status`, `steer`, and `resume` |
| Persistent process | `hub start`, `logs`, `send`, and `stop` | `bg_run`, `bg_status`, `bg_logs`, and `bg_kill` |
| Task list | `todo` | `todo` |
| User decision | `ask` | `ask_user_question` |
| Browser surface | `browser` | `agent_browser` |
| Symbol intelligence | `lsp` | The active Pi LSP or pi-lens symbol tools |
| Skill support file | `skill://<name>/<path>` | `~/.pi/agent/skills/<name>/<path>` |
| Large agent artifact | `local://<name>` or a named file | A named file under `/tmp/pstack-<slug>/` |

Use the host's exact tool schema. The table maps intent; it does not authorize shell wrappers around missing tools.

## Delegation

OMP launches every independent slice in one `task` call. Pi launches the same wave in one `subagent` call whose `workflowScript` returns `runs.all([{ key, agent, task }, ...])`. Keep dependent waves separate. Give writers disjoint files or isolated worktrees. Keep read-only agents read-only.

When a pstack skill says `default`, OMP omits `agent` and Pi uses `worker`. Resolve optional roles from `~/.config/pstack/omp-agents.json` on OMP or `~/.config/pstack/pi-agents.json` on Pi. A missing or unavailable configured role falls back to the safest built-in role with the same mutation boundary.

Do not claim model-family diversity from different agent names. Report the actual configured models only when the runtime proves them.

## Bundled agents

`poteto-agent` and `comment-sicko` are optional registered agents. `/setup-pstack` installs their bundled definitions into the current host. If a definition is unavailable, use the skill's explicit fallback worker and report the fallback. Never silently replace Comment Sicko with an ordinary reviewer prompt.

## Surface proof

Use the real surface. OMP drives web and Electron through `browser`; Pi drives them through `agent_browser`. Both run the actual CLI or TUI for terminal behavior. Use a debugger or profiler only when the current host exposes one. Missing surface control is a reported verification gap, not a passing proxy test.

## Capability boundary

A pstack branch that requires a Cursor-only capability stays unavailable unless the skill names a complete host-native substitute. In particular, OMP and Pi cannot create Cursor Grok Bot routines or render Cursor secret-request cards. `make-bot-ui` therefore accepts an existing webhook and reads its key from local secret configuration. It never pretends to create that Cursor state.