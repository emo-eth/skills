---
name: herdr-voice
description: "Run Herdr work from a Codex realtime voice task by delegating to text subagents that own the Herdr CLI. The voice agent plans, dispatches, and reports; it never drives Herdr panes, agents, or the herdr CLI directly."
---

# Herdr voice control

The voice agent is an orchestrator. It listens, plans, splits work into written tasks, dispatches them to text subagents, tracks completion, and reports results aloud. All Herdr control — session and workspace targeting, pane layout, agent start, prompt, read, and wait — belongs to the text subagents. The voice agent does not issue `herdr` commands itself.

Use this skill only when the user explicitly asks for Herdr control. Delegation authority does not grant authority to approve prompts, interrupt work, or change unrelated state. Never close a user workspace, tab, pane, session, or agent without an explicit request. Do not patch Herdr, Codex, Pi, or OMP to establish any path.

## Dispatch model

1. Identify the text subagents available for delegation: an existing Codex task or thread, or a fresh one the user starts. Confirm the exact thread name or UUID before dispatch.
2. Send each subagent one self-contained written task. Include everything it needs: the exact Herdr session name, the explicit workspace, pane, or agent IDs or the discovery commands to run, the command or outcome wanted, and the observable result to return.
3. Require every subagent to follow the `herdr` skill: parse IDs from CLI JSON, pass an explicit target on every command, use `--session <exact-name>` when it is not inside that Herdr session, never use `--current` or UI focus, and use `--no-focus` for background creation.
4. Track the work through the subagent's reply. Do not inspect Herdr state from the voice task to check progress.
5. Escalate to the user when a subagent reports it is blocked, asks a question, or returns an error. Do not retry the Herdr control directly from the voice task.

## Sending work to a Codex subagent

If the addressed thread's writer is owned by the live Codex CLI, queue the message instead of writing directly:

```bash
codex queue --thread <thread-uuid-or-exact-name> --message "<full written task>"
```

If the addressed task dies or its pane restarts, stop sending work to the dead address. Have the user send any first message in the replacement session, rediscover the replacement task, then continue.

## What the voice agent may do itself

- Ask the user which session, workspace, or agent the work targets.
- Split, rephrase, and sequence tasks across subagents, and read subagent replies.
- Relay the Herdr CLI JSON a subagent returned as the authoritative result.

## What the voice agent must not do

- Run any `herdr` command that inspects or controls sessions, workspaces, tabs, panes, or agents, including read-only listing. Route it through a subagent.
- Approve prompts, interrupt agents, or close user-owned state without an explicit request.
- Claim to be inside Herdr, or set or fake `HERDR_ENV`.

## Verification

- A dispatched task is verified by the Herdr CLI JSON in the subagent's reply, relayed verbatim.
- Treat `read_thread` output and returned CLI results as authoritative; a task list or status label can be stale while the live CLI still works.
- Do not use screen capture for verification unless the current visible state is genuinely needed.
