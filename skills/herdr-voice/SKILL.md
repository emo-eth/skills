---
name: herdr-voice
description: "Control Herdr from a Codex realtime voice task, using exact named-session CLI control by default and a Codex pane relay only when direct control is unavailable."
---

# Herdr voice control

Prefer direct external Herdr CLI control. Use a Codex process inside a Herdr pane only as a fallback. Do not patch Herdr, Codex, Pi, or OMP to establish either path.

Before control, read the installed `herdr` skill completely and preserve its authorization and safety boundaries. Never close a user workspace, tab, pane, session, or agent without an explicit request.

## Direct setup

1. Do not claim the voice task is inside Herdr, and do not set or fake `HERDR_ENV`.
2. Run `herdr session list --json` only to discover exact session names. Select the intended exact name.
3. Put global `--session <exact-name>` before the command group on every later Herdr command.
4. Discover workspace IDs and unique live agent names with session-scoped list commands. For every command that accepts a workspace, pane, or agent target, provide an explicit workspace ID, pane ID, or unique live agent name.

Never use `--current`, omit an optional target, or rely on UI focus or focused-state fallback. For background creation, use `--no-focus` and provide an explicit working directory.

## Fallback relay setup

Use this only when direct external control is unavailable.

1. Start Codex in a Herdr pane and send any first message. That first message creates an addressable Codex task.
2. Discover the new task and send it the Herdr work. If direct thread messaging is blocked because the live Codex CLI owns the writer, queue the message:

   ```bash
   codex queue --thread <thread-uuid-or-exact-name> --message "<work>"
   ```

3. Before any Herdr control, the relay reads the installed `herdr` skill completely and verifies:

   ```bash
   test "${HERDR_ENV:-}" = 1
   ```

After the relay restarts, send any first message in the replacement Codex session, then rediscover that replacement task before sending more work.

## Verification

- Direct mode: use the selected session to list workspaces, then inspect one intended workspace or pane with its explicit ID. Accept the actual Herdr CLI JSON as the result.
- Relay mode: use `read_thread` to confirm that the relay read the Herdr skill, verified `HERDR_ENV=1`, and returned the requested CLI result.
- Treat `read_thread` content and actual CLI results as authoritative. A task list or status label can be stale while the live CLI still works.
- Do not use screen capture for setup unless the current visible state is genuinely required.
