---
name: herdr-voice
description: "Control Herdr from a Codex realtime voice task, using exact named-session CLI control by default and a Codex pane relay only when direct control is unavailable."
---

# Herdr voice control

Prefer direct external Herdr CLI control. Use a Codex process inside a Herdr pane only as a fallback. Do not patch Herdr, Codex, Pi, or OMP to establish either path.

Use either mode only when the user explicitly asks for Herdr control. Control authority does not grant authority to approve prompts, interrupt work, or change unrelated state. Never close a user workspace, tab, pane, session, or agent without an explicit request.

## Direct setup

1. Do not claim the voice task is inside Herdr, and never set or fake `HERDR_ENV`.
2. Run `herdr session list --json` only to discover exact session names. Select the intended exact name.
3. Put global `--session <exact-name>` before the command group on every later control command. Keep it on every command for that session.
4. Discover workspace IDs and unique live agent names with session-scoped list commands. For every command that accepts a workspace, pane, or agent target, provide an explicit workspace ID, pane ID, or unique live agent name.

Never use `--current`, omit an optional target, or rely on UI focus or focused-state fallback. Parse targets from CLI results instead of deriving them from visible order. For background creation, prefer `--no-focus` and provide an explicit working directory.

## Fallback relay setup

Use this only when direct external control is unavailable.

1. The user starts Codex in a Herdr pane and sends any first message. That first message creates an addressable Codex task.
2. The voice coordinator discovers the new task and sends it the Herdr work. If direct thread messaging is blocked because the live Codex CLI owns the writer, queue the message:

   ```bash
   codex queue --thread <thread-uuid-or-exact-name> --message "<work>"
   ```

3. Before any Herdr control, the relay verifies that it is inside a Herdr-managed pane:

   ```bash
   test "${HERDR_ENV:-}" = 1
   ```

After the pane restarts, the old task is no longer the relay. The user sends any first message in the replacement Codex session, and the coordinator rediscovers that replacement task before sending more work.

## Verification

- Direct mode: use the selected session to list workspaces, then inspect one intended workspace or pane with its explicit ID. Accept the actual Herdr CLI JSON as the result.
- Relay mode: use `read_thread` to confirm that the relay verified `HERDR_ENV=1` and returned the requested CLI result.
- Treat `read_thread` output and actual CLI results as authoritative. A task list or status label can be stale while the live CLI still works.
- Do not use screen capture for setup unless the current visible state is genuinely needed.
