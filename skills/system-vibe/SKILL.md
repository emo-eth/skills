---
name: system-vibe
disable-model-invocation: true
description: "Personal operating-system contract for the home fleet, sync, SSH, skills, Herdr, and local inference. Use when diagnosing or changing machines, chezmoi, SSH, skill distribution, Windows sleep/wake, or the local model router. This is the qualitative list of what must stay true; agents invent enforcement from the clauses, not from tribal setup lore."
license: MIT
---

# System vibe: the home setup just works

Status: draft. Not yet approved. Do not treat this as load-bearing until the user signs it.

This is not the skills-repo philosophy vibe (`docs/vibe.md`). That one is how work should feel. This one is what must be true of the machines, sync, and local inference so work can happen from any seat without a scavenger hunt.

## Glossary

Definitions here describe. They do not prescribe a mechanism.

- **Fleet**: the named machines on the tailnet that the user actually uses: Mac Studio (`studio`), two DGX Sparks (`spark0`, `spark1`), Windows 5090 (`emo-win`), Windows 4090 (`emo-4090`), and the MacBook (`mbp-16-m4` / `mbp-16-24`).
- **Source of truth**: the one place a kind of thing is authored. Copies exist; authors do not.
- **Sync**: getting a machine to match the source of truth without a hand-written snowflake.
- **Unattended SSH**: an agent or script can open a shell on a fleet box with no human at a prompt, no password, and no "agent refused operation."
- **Local provider**: one OpenAI-shaped inference API in front of the fleet. Callers pick a model id, not a machine.
- **Idle**: nobody is using the keyboard or mouse, and nobody is asking that box for tokens.
- **Game mode**: a real game (or anything else holding serious GPU memory that is not inference) owns the Windows GPU. Inference must get out of the way.

## Vibe Promise

Sitting down at any machine, or sending an agent from any machine, should feel like using one system. Names resolve. SSH lands. Skills and dotfiles match. Local models answer through one provider. The Windows box sleeps when it is unused and wakes when something actually needs it. If a piece of that is broken, that is a bug in the system, not a puzzle the user has to re-solve from chat.

## Ideal Reality Dump

User language, kept close to the original:

- "it'd be nice to have a list of my expectations about how my system, sync, etc works. like a vibe contract for what i expect/want/need to be true. and then agents can figure out how to enforce that"
- "it is not acceptable that it can't ssh to emo win"
- "windows needs to sleep when not in use - urgent"
- "awake when inferring or inference is requested. asleep when not or not in use. also i'd like to use it as a gaming pc too and when i do it should not pollute the vram/be available for inference"
- "full local-inference api working and distributing workload, full windows pc setup with sleep enabled and wake enabled over lan/ssh/whatever"
- "every protection, automation, or behavior I ask for must hold across all projects, sessions, agents, models, and harnesses -- forever"
- Skills live in one repo; every device installs from there and updates from there; an unpushed skill edit exists on exactly one machine and drifts from every other one.
- Ask with the structured ask tool. Do not dump numbered questions into chat.

## Use Circumstances

- An agent on the Studio needs to fix or sleep the Windows box without the user babysitting SSH.
- The user is about to leave town and the fleet has to keep working without a sitting debug session.
- A new machine, or a machine that sat off for days, should come back onto the same system rather than a fork of it.
- The user sits down to game on the 5090; inference must not be sitting on the GPU.
- The user (or an agent) wants local tokens and should not have to remember which box is on, or which model lives where, beyond the model id.
- Something feels "off" (SSH flaps, skills missing, Windows still hot at 3am). The first move is: check this contract, then fix the broken clause.

## Vibe Clauses

### S1. One author for each kind of thing

- Promise: each kind of durable thing has one authoring place. Agents edit there. Everywhere else is a copy.
- Example: skills are authored in the skills repo and installed out; dotfiles are authored in chezmoi and applied out; agent stance lives in the global AGENTS.md that chezmoi ships; project memory lives in that project's STATE.md / DECISIONS.md; work tracking lives in Linear.
- Does not mean: no caches, no installed copies, no worktrees. Copies are fine. Second authors are not.
- Violation: a skill edited under `~/.claude/skills` or a harness plugin dir; a one-off SSH config on one box that chezmoi will smash or never ship; a "we'll remember this in chat."
- Check: ask "if this machine caught fire, where do I re-type this from?" There should be one answer, and it should not be a transcript.

### S2. Named machines, always the same names

- Promise: fleet machines have stable names on the tailnet. Those names are how humans and agents talk about them. A box that is powered on and logged in is on the tailnet under that name.
- Example: `studio`, `spark0`, `spark1`, `emo-win`, `emo-4090`, the MacBook names. SSH hosts match those names.
- Does not mean: every box is online 24/7. Sleeping is allowed. Vanishing from the tailnet while powered on and logged in is not.
- Violation: "the Windows box" with no name; a second hostname that only one person remembers; `emo-4090` powered on in the house and missing from the tailnet.
- Check: `tailscale status` shows the named fleet. Powered-on boxes are `online` or idle, not "last seen days ago" while someone is sitting at them.

### S3. Sync is boring

- Promise: bringing a machine up to date is a small, known motion, not an archaeology project. After that motion, skills, dotfiles, and agent instructions match the source of truth.
- Example: chezmoi apply for dotfiles; `npx skills update` (or add) for skills; git pull on the checkouts that machine actually uses. Skill edits land on `origin/main` before they are "done."
- Does not mean: every machine clones every repo. It means the machines that run a thing run the same thing.
- Violation: Studio has a skill the MacBook does not; a fleet SSH stanza that exists only in `~/.ssh/config.fleet` and not in the chezmoi template; an agent "fixes SSH" in a way that dies on reboot or on the next chezmoi apply.
- Check: pick a fact (an alias, a skill, an SSH host). It is present on two machines, or there is a documented reason it is machine-local.

### S4. Unattended SSH is a floor, not a luxury

- Promise: from the Studio, an agent can SSH into every fleet box that is reachable, in batch mode, without a human at a prompt. Signing keys is a solved, always-on path (today that means the 1Password agent, or whatever replaces it), not a lucky interactive terminal.
- Example: `ssh -o BatchMode=yes emo-win` and `ssh -o BatchMode=yes emo-win-admin` both land. Same idea for sparks and the MacBook. A locked Mac login must not be the only way to sign fleet keys if an agent is expected to keep working.
- Does not mean: password SSH, or agents storing private keys in chat. It also does not mean Tailscale SSH as a surprise extra protocol unless that is the chosen path for a box.
- Violation: `agent refused operation`; `Permission denied (publickey)` while the box is up and HTTP to it works; fleet config pointing at an empty Apple ssh-agent that cannot sign.
- Check: one non-interactive SSH to each online box succeeds. A failure is an incident against this clause, not a side quest.

### S5. Windows has two honest doors

- Promise: the Windows box can be administered as Windows, and used as Linux, without one door pretending to be the other.
- Example: one port or host alias lands in native PowerShell with enough privilege to change power, services, and GPU; another lands in WSL for the Linux workflow. Opening the Windows door does not boot WSL just to say hello.
- Does not mean: WSL is forbidden. It means a Windows admin session is actually Windows, and a WSL session is actually WSL.
- Violation: every SSH to the Windows box starts WSL and then the box cannot sleep; "admin" SSH that is still a bash wrapper; no way to `powercfg` without a scavenger hunt.
- Check: the admin alias can run `powercfg` / `Get-Service` without `wsl.exe`. The Linux alias is a normal Linux shell.

### S6. Idle machines sleep; needed machines wake

- Promise: a fleet box that is idle goes to sleep. A request that needs that box wakes it, does the work, and lets it sleep again. Wake over LAN (and whatever else actually works from this house) is part of the contract, not a manual button.
- Example: `emo-win` sleeps after a short idle. Inference on the 5090 starts only when something asks. Studio can send a magic packet and then ask the box to start inference. Sparks can stay up if that is their job; the Windows gaming box cannot sit at full GPU 24/7 "just in case."
- Does not mean: yanking power under an active session, or sleeping a box the user is sitting at. Keyboard and mouse keep it awake.
- Violation: ninfer running all night with nobody calling it; STANDBYIDLE set but WSL or a GPU process silently forbidding S3; wake documented but never tested.
- Check: after true idle, the box is asleep (or the contract names a documented exception). After a wake-and-infer request, it answers, then can return to idle-sleep.

### S7. Human GPU use beats inference

- Promise: when the user is gaming (or otherwise using the Windows GPU as a GPU), inference is not occupying VRAM and is not advertised as available on that box.
- Example: a game holding real GPU memory causes inference to stop. The router treats that box as unavailable until the GPU is free and someone asks for tokens again.
- Does not mean: Chrome or the desktop compositor counts as a game. A 20 MiB overlay must not hold the whole fleet down.
- Violation: 24 GB of weights sitting on the 5090 while a game launches; the router still sending `qwen3.8-27b` to a box that refused to start because a game is up, and hanging.
- Check: start a game, watch inference stop and VRAM drop. Stop the game, request inference, watch it come back.

### S8. Local inference is one provider

- Promise: local tokens feel like a normal provider. The caller chooses a model id. Placement is the fleet's problem. A model id is an exact contract, not a nickname for "whatever is free."
- Example: Sparks serve Ornith. The 5090 serves Qwen3.8-27B. The Studio router is the door. OMP may list that door as an extra provider; it does not silently become the default cloud model.
- Does not mean: every model on every box, or the 4090 already serving something it does not have. Missing hardware is unavailable, not a silent substitute.
- Violation: sparks serving 3.8-27B after the user said they should serve Ornith; a caller having to pass a hostname; truncation or a hang where a normal provider would 429/503.
- Check: hit the router with a model id from a generic client. Get that model, or a fast ordinary error. Never a different model wearing the same id.

### S9. Agent-agnostic, or it does not count

- Promise: a protection or automation the user asked for works in every harness, on every machine, forever. A Cursor hook is not the implementation.
- Example: PATH wrappers, chezmoi, git hooks, files every agent already reads (this skill, global AGENTS.md), the tool's own config.
- Does not mean: never use a harness hook. Hooks may be extra. They may not be the only copy of the rule.
- Violation: "in your Cursor settings"; a wall-clock that only exists in one plugin host; SSH that only works in an interactive Ghostty the user is looking at.
- Check: a fresh agent in a different harness, on a different machine, still meets the clause.

### S10. Broken setup is a bug, not a briefing

- Promise: when a clause here is false, the job is to restore it (or get a decision to change the clause). The job is not to narrate the breakage and wait.
- Example: SSH to `emo-win` failing while the box answers HTTP is an S4 incident. Fix signing, config, or the box. Do not write a three-page status that ends with "please unlock 1Password" as the only path if another path exists.
- Does not mean: smash through a locked vault, or sleep a box the user is using. Ask when a human action is actually required, with the ask tool, once.
- Violation: treating "Permission denied" as weather; leaving the Windows box hot because the agent could not SSH and then moving on to a different topic.
- Check: the session either restored the clause, filed a Linear ticket with a real next action, or asked one concrete human step. It did not only describe the failure.

## Anti-Vibes

| Anti-vibe | Why it violates the contract | Clause |
| --- | --- | --- |
| A snowflake fix on one machine | The next machine, or the next chezmoi apply, undoes it | S1, S3 |
| "Whatever the Windows box is called this week" | Agents and humans cannot share a map | S2 |
| Interactive SSH as the only working path | Agents cannot operate the fleet | S4 |
| WSL coming along for every Windows login | Sleep never happens; admin is fake | S5, S6 |
| 5090 inferring all night | Power, heat, and a GPU the user cannot game on | S6, S7 |
| Pick a hostname to get tokens | That is a homelab console, not a provider | S8 |
| "I added it to this harness's settings" | The next agent will not see it | S9 |
| A long report that the fleet is sad | The user asked for a working system, not a briefing | S10 |

## Enforcement

This file is the contract. It is not the enforcement machinery.

When a clause is false, an agent should:

1. Name the clause.
2. Restore the source of truth (chezmoi template, skills repo, fleet config, router contract), not a local bandage, unless the bandage is the only way to stop ongoing harm (for example, stop a 24/7 GPU job) and the durable fix follows in the same sitting.
3. Prove the clause with the check, not with a claim.
4. If the clause itself is wrong, stop and ask. Do not silently rewrite the contract.

Do not invent a second competing checklist in chat.

## Approval

- Approved by:
- Approved on:
- Amendment rule: this vibe changes only by explicit user request or direct user edit.
