---
name: herdr
description: "Control Herdr, a terminal multiplexer for coding agents. Use only when the user explicitly asks to inspect or control Herdr panes, tabs, workspaces, commands, or agents. Requires either an in-pane Herdr context or an exact named session with explicit targets."
---

# Herdr

Herdr organizes terminals into workspaces, tabs, and panes, recognizes coding agents running inside panes, and exposes sessions through the `herdr` CLI.

Use this skill only when the user explicitly mentions Herdr or asks for Herdr control. Do not use it merely because a task could benefit from a background terminal, delegation, or parallel work.

## Choose one controller mode

### In-pane mode

Use in-pane mode when this process is running inside a Herdr-managed pane:

```bash
test "${HERDR_ENV:-}" = 1
```

The inherited session and caller IDs are valid in this mode. `--current` may target the calling pane when that is the user's intent.

### Explicit external-controller mode

Use external mode only when the user explicitly asked for Herdr control and this process is outside a Herdr pane. Herdr subcommands do not require `HERDR_ENV`; only `--current` depends on inherited pane context. Never manually set or fake `HERDR_ENV`.

Discover the exact session name before entering external-controller mode. Session listing is the only Herdr discovery command that may omit global `--session` because it does not control a session:

```bash
herdr session list --json
```

Select one exact session from that result. Global `--session <exact-name>` selects that session's socket and overrides inherited socket routing. Put it before the command group on every later Herdr command:

```bash
herdr --session <exact-name> workspace list
herdr --session <exact-name> pane list --workspace <workspace-id>
herdr --session <exact-name> agent list
```

External mode has these strict rules:

- Never use `--current`.
- Never omit an optional workspace, pane, or agent target.
- Never rely on UI focus or focused-state fallback; omitted optional targets can use focused state.
- Every targetable operation must use an explicit workspace ID, pane ID, or unique live agent name.
- Keep global `--session <exact-name>` on every command after session discovery.

Use only session-scoped list or snapshot commands for discovery after selecting the session. Use their returned IDs and names for all later targetable operations.

## Learn the current CLI

The installed binary is the authority for command syntax. In in-pane mode, start with:

```bash
herdr --help
```

In external mode, retain the selected session even while reading help:

```bash
herdr --session <exact-name> --help
```

Then print only the relevant command group. In external mode, prefix every example below with `herdr --session <exact-name>` instead of `herdr`:

```bash
herdr agent
herdr pane
herdr workspace
herdr tab
herdr worktree
herdr terminal
herdr notification
herdr integration
herdr session
```

Do not run bare `herdr` for discovery; it launches or attaches the TUI. Do not probe a mutating nested command by omitting arguments. Commands such as `herdr workspace create` are valid with defaults and will execute.

Most control commands return JSON. Read identifiers and state from those responses instead of predicting them.

## Understand layout, panes, and agents

Choose the primitive that matches the job:

- Workspace, tab, and pane topology organize terminal locations.
- Pane commands control raw terminals, shells, tests, servers, input, and output.
- Agent commands control the recognized coding agent currently occupying a pane.

A pane exists whether or not it contains an agent. `agent start` requires an existing available shell pane and never creates, splits, or moves layout. Use pane commands for ordinary processes. Use agent commands when Herdr must validate agent identity or interpret `idle`, `working`, `blocked`, `done`, and `unknown` lifecycle states.

Agent commands accept either a unique live agent name or the pane ID currently hosting that agent. They do not accept terminal IDs or bare agent-kind labels. Names must match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents. A name follows the current pane occupant and is cleared when that agent exits, is released, or is replaced.

`idle` means the agent is ready for input and its tab has been seen in the focused Herdr UI. `done` is the same underlying idle state after unseen background work finishes. Focusing the tab or targeting the pane or agent with a focus command marks it seen. CLI reads do not mark it seen. `blocked` means Herdr recognized an approval or question UI. `unknown` means an agent is present but Herdr cannot classify it confidently; it does not prove completion.

## Use IDs and caller context

Public IDs are opaque stable handles:

- workspace: `w1`
- tab: `w1:t1`
- pane: `w1:p1`

Closed tab and pane IDs are not reused. A pane moved into another workspace receives a new workspace-qualified pane ID. After `pane move`, continue with `.result.move_result.pane.pane_id` or the live agent name. The old value is reported as `.result.move_result.previous_pane_id`; only the moved process's inherited caller context keeps resolving that old ID, so do not use it as a general agent target.

Herdr injects the caller's context into each managed pane. These variables exist only inside a Herdr-managed pane:

```bash
printf '%s\n' "$HERDR_WORKSPACE_ID" "$HERDR_TAB_ID" "$HERDR_PANE_ID"
```

In in-pane mode, prefer `--current` when a pane command should target the calling pane. Omitting a target may use the UI-focused pane, which can belong to the user or another client.

In external mode, caller context is unavailable or irrelevant. Always use the selected session and an explicit target. Do not use `--current`, and do not omit a target that the command accepts.

Discover live state in in-pane mode with:

```bash
herdr workspace list
herdr tab list --workspace "$HERDR_WORKSPACE_ID"
herdr pane current --current
herdr pane list --workspace "$HERDR_WORKSPACE_ID"
herdr agent list
```

Use the corresponding session-prefixed commands and returned explicit IDs in external mode.

Creation responses expose the IDs to use next. `workspace create` returns `.result.workspace`, `.result.tab`, and `.result.root_pane`. `tab create` returns `.result.tab` and `.result.root_pane`. `pane split` returns the new pane as `.result.pane`.

## Start and coordinate an agent

Default to a sibling pane in the selected workspace and the current working directory. Do not create a workspace, tab, worktree, or different cwd unless the user explicitly requests that topology or location.

Honor a direction requested by the user. Otherwise inspect the target pane. In in-pane mode this can be:

```bash
herdr pane layout --pane "$HERDR_PANE_ID"
```

In external mode, use the selected session and an explicit pane ID.

Split a wide pane to the right and a narrow or tall pane down. Avoid repeated same-direction splits that create unusably narrow columns or short rows. Keep user focus unchanged and explicitly preserve the working directory:

```bash
herdr pane split --pane <pane-id> --direction right --cwd "$PWD" --no-focus
```

In external mode, prefix that command with global `--session <exact-name>`. Replace `right` with `down` when appropriate. Read the new pane ID from `.result.pane.pane_id`.

For any external background creation, use `--no-focus` and provide an explicit `--cwd`. Do not let omitted defaults select a focused target or an unintended directory.

An available shell pane must be at its interactive prompt, with the shell itself in the foreground and no foreground command, editor, or agent running. Start a supported agent in that pane with a useful unique name:

```bash
herdr agent start reviewer --kind codex --pane <returned-pane-id>
```

In external mode, retain global `--session <exact-name>`. Use the kind requested by the user. Run the relevant `agent` help in the selected controller mode to inspect the installed kind list and options. Pass native agent arguments only after `--`:

```bash
herdr agent start reviewer --kind codex --pane <returned-pane-id> -- <agent-args...>
```

A successful `agent start` returns only after Herdr detects the expected agent in the same pane and considers it ready for interactive input. If the agent is blocked during startup, the command returns `agent_not_ready` immediately but keeps the name available for `agent read` and `agent send-keys`. Wait until the agent becomes idle before prompting it. Startup defaults to a 30-second timeout.

Submit work through the agent surface:

```bash
herdr agent prompt reviewer "Review the current diff and report only actionable findings." --wait --timeout 120000
```

In external mode, retain global `--session <exact-name>` and use the unique live agent name or its explicit pane ID. `agent prompt` honors the pane's live bracketed-paste mode and sends text followed by encoded Enter after a short delay. It rejects an agent already waiting at an approval or question dialog with `agent_blocked` before sending any input. Inspect the blocked UI and ask the user before answering it. For normal agent work, `--wait` is enough: it waits for the first settled `idle`, `done`, or `blocked` state. Do not repeat those defaults with `--until`.

A prompt sent from a non-working state must produce an observed lifecycle change within five seconds. Otherwise Herdr returns `agent_prompt_stalled` instead of waiting indefinitely. This wait tracks lifecycle state, not an individual turn; if the agent is already working, completion of the active turn may satisfy it.

Use `--until` only for a state-specific workflow, such as waiting for an already-running agent to request input:

```bash
herdr agent wait reviewer --until blocked --timeout 120000
```

Without `--until`, standalone `agent wait` uses the same settled-state defaults as `agent prompt --wait`.

Use logical keys for interactive agent UI controls:

```bash
herdr agent send-keys reviewer esc
herdr agent send-keys reviewer ctrl+c
```

Herdr validates all keys before writing any bytes. Read the result through the resolved agent:

```bash
herdr agent get reviewer
herdr agent read reviewer --source recent-unwrapped --lines 120
```

In external mode, retain global `--session <exact-name>` on all of these commands. If a wait fails or returns `blocked`, inspect `agent get` and `agent read` before deciding what input to send. Use the pane surface only when raw terminal control is intentional.

## Run an ordinary command in another pane

Create a sibling pane with the same geometry rule, preserve the working directory, and keep user focus unchanged:

```bash
herdr pane split --pane <pane-id> --direction right --cwd "$PWD" --no-focus
```

In external mode, retain global `--session <exact-name>`. Read the new pane ID from `.result.pane.pane_id`, then run and inspect the command with that explicit ID:

```bash
herdr pane run <returned-pane-id> "just test"
herdr pane wait-output <returned-pane-id> --match "test result" --timeout 120000
herdr pane read <returned-pane-id> --source recent-unwrapped --lines 120
```

`pane run` atomically sends command text and Enter. `pane wait-output` searches the selected snapshot immediately, so output that already exists can match. Use `--match <text>` for a literal substring or `--regex <pattern>` for a Rust regular expression. Omitting `--timeout` allows an indefinite wait.

Use the read source that matches the task:

- `visible`: the currently rendered viewport.
- `recent`: recent rendered output, including soft wraps.
- `recent-unwrapped`: recent output with soft wraps joined; prefer it for logs and transcripts.
- `detection`: the plain-text bottom-buffer snapshot used for agent detection.

Use `--format ansi` when colors and terminal styling are evidence. Otherwise use text.

`--lines` asks Herdr for more rows from the pane's available screen and host scrollback. If increasing it does not reveal more of a completed response, the pane is probably running the agent on the terminal's alternate screen. Rows that leave the alternate screen do not enter Herdr's host scrollback, so a larger line count cannot recover them.

After that failed read, ask the agent to write its complete response as Markdown in a temporary directory and reply only with the file path, then read the file directly. Use this only as a fallback; do not request file output in the initial prompt.

## Safety and coordination rules

- Use `--no-focus` for background work unless the user asked to switch context.
- Use an explicit pane ID or a unique agent name. In-pane mode may use `--current` for the calling pane; external mode must not.
- In external mode, keep global `--session <exact-name>` and explicit targets on every targetable command.
- Parse IDs from JSON responses. Do not derive them from sidebar order or examples.
- Never close a user workspace, tab, pane, session, or agent without an explicit request.
- Never run `herdr server stop` from an active session unless the user explicitly intends to stop the server and its pane processes.
- Never kill the main Herdr process. Use named test sessions for experiments that need an isolated server.
- CLI server errors are JSON on stderr with exit status 1. CLI syntax errors exit with status 2.
