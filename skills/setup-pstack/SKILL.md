---
name: setup-pstack
description: Configure pstack agents and runtime support for OMP or Pi. Use for /setup-pstack, configuring pstack roles, registering poteto-agent or Comment Sicko, or repairing a pstack installation.
---

# Setup pstack

Read `pstack-runtime`. Configure only the current host branch.

## 1. Check host support

OMP requires its native `task`, `hub`, `todo`, `ask`, and browser surfaces.

Pi requires these installed extensions:

- `pi-subagents`
- `@juicesharp/rpiv-todo`
- `@juicesharp/rpiv-ask-user-question`
- `pi-background-tasks`
- `pi-agent-browser-native`

Inspect the current host. Name every missing prerequisite. Install a missing Pi extension with `pi install npm:<package>` when setup is running interactively, then tell the user that Pi must restart before that extension is available.

## 2. Register bundled agents

Run both installed scripts for the current host:

- OMP uses `bash ~/.agents/skills/poteto-mode/scripts/install-agents.sh` and `bash ~/.agents/skills/no-comments/scripts/install-agents.sh`.
- Pi uses `bash ~/.pi/agent/skills/poteto-mode/scripts/install-agents.sh` and `bash ~/.pi/agent/skills/no-comments/scripts/install-agents.sh`.

The scripts install only `poteto-agent` and `comment-sicko`. Re-running them converges on the current bundled definitions.

## 3. Detect agent types

OMP reads the current `task` roster from the system context. Pi calls `subagent` with `action: \"list\"`. The live roster is authoritative. Do not invent a type.

## 4. Load current roles

OMP uses `~/.config/pstack/omp-agents.json`. Pi uses `~/.config/pstack/pi-agents.json`. Preserve valid current choices. Replace unavailable roles with the safest built-in role that keeps the same read or write boundary.

## 5. Write the role map

Create the parent directory. Overwrite the current host's file so repeated setup converges.

OMP defaults:

```json
{
  "feature": "default",
  "refactoring": "default",
  "bug-fix": "default",
  "perf-issue": "default",
  "hillclimb": "default",
  "judgment-and-prose": "default",
  "hardest-tasks": "default",
  "how-explorer": "scout",
  "how-explainer": "scout",
  "how-critics": ["reviewer", "reviewer"],
  "why-investigators": "scout",
  "why-synthesizer": "reviewer",
  "reflect-tooling": "reviewer",
  "reflect-judgment": "reviewer",
  "arena-runners": ["default", "default", "default"],
  "arena-cross-judge": "reviewer",
  "swarm-workers": "default",
  "architect-runners": ["default", "default", "default"],
  "interrogate-reviewers": ["reviewer", "reviewer", "security-reviewer"]
}
```

Pi defaults:

```json
{
  "feature": "worker",
  "refactoring": "worker",
  "bug-fix": "worker",
  "perf-issue": "worker",
  "hillclimb": "worker",
  "judgment-and-prose": "reviewer",
  "hardest-tasks": "oracle",
  "how-explorer": "scout",
  "how-explainer": "researcher",
  "how-critics": ["reviewer", "reviewer"],
  "why-investigators": "researcher",
  "why-synthesizer": "reviewer",
  "reflect-tooling": "reviewer",
  "reflect-judgment": "reviewer",
  "arena-runners": ["worker", "worker", "worker"],
  "arena-cross-judge": "reviewer",
  "swarm-workers": "worker",
  "architect-runners": ["worker", "worker", "worker"],
  "interrogate-reviewers": ["reviewer", "reviewer", "oracle"]
}
```

List-valued roles set panel size. Repeated types are valid independent agents. They do not prove model-family diversity.

## 6. Verify setup

Read both registered agent definitions through the host's agent discovery surface. Confirm the role file parses and every configured role exists. Report the host, written path, agent registrations, installed prerequisites, substitutions, and any restart still required.

## 7. Offer a verification skill

Check whether the current project has a real-surface verification harness or an installed `verify-*` skill. If neither exists, offer `/create-verification-skill` once.
