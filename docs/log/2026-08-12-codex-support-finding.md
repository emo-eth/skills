# Codex Support Finding - 2026-08-12

## Glossary

- **Agent Plugins**: The vendor-neutral package format for Agent Skills and Model Context Protocol (MCP) servers.
- **Codex**: OpenAI's agent runtime and command-line client.
- **Codex plugin**: Codex's client-specific package format with a `.codex-plugin/plugin.json` manifest.
- **Hook**: A Codex lifecycle callback that can inspect or control supported events.
- **PreToolUse**: A hook that runs before a supported tool call.
- **Covered tool**: A tool path that Codex sends through its local hook system.
- **Block-new**: An expiry policy that rejects new work but does not stop work already running.
- **Abort-running**: An expiry policy that also stops running wall-clock-owned work.
- **Native adapter**: Host-specific code that connects wall-clock policy to a client's lifecycle and execution events.
- **Advisory assignment**: A recorded child objective with model guidance but no hard executor deadline.

## Finding

Codex support is possible as a narrower `block-new` integration. Full parity with the existing Pi and OMP adapters is not currently possible to claim.

Codex exposes skills, MCP servers, plugins, lifecycle hooks, and `PreToolUse` interception for supported local tools. It does not expose a tested universal executor boundary or a supported abort signal for an already-running action. Wall-clock can therefore enforce only the tool calls that Codex routes through `PreToolUse`, and only before those calls start.

The existing wall-clock controller is reusable. The Codex work would be a new native adapter and Codex package view, not a replacement for the portable Agent Plugins package.

## Package boundary

The current wall-clock package follows Agent Plugins 1.0.0:

```text
plugin.json
skills/
mcp.json
```

Codex uses a separate client-specific package shape:

```text
.codex-plugin/
  plugin.json
skills/
.mcp.json
hooks/
  hooks.json
```

The shared `skills/wall-clock/SKILL.md` and wall-clock controller can remain common. Codex-specific manifest fields and lifecycle hook files must be added separately. Agent Plugins does not define Codex marketplace or hook behavior.

## Feasible Codex contract

### Activation

- The user selects a duration or local deadline.
- The user selects `block-new`.
- Activation fails closed when the required hooks are disabled, unavailable, or not trusted.
- A request for `abort-running` is rejected. It must not silently downgrade to `block-new`.

Suggested rejection:

```text
Cannot start wall-clock in Codex.

Codex cannot stop an already-running command through its supported plugin hook interface.
Available Codex policy: block-new.
Use Pi or OMP for abort-running enforcement.
```

### Enforcement

`PreToolUse` can deny supported calls such as:

- Bash commands.
- `apply_patch` file edits.
- MCP tools.
- Many local function tools.
- Some subagent-related local calls.

The adapter must not claim coverage for:

- Hosted tools such as web search.
- Specialized paths that bypass the local hook system.
- Work already admitted and still running.

When the hook does not receive an action, wall-clock cannot report that it blocked the action.

### Child work

Codex can add assignment context at `SubagentStart` and can block some child-creation calls when those calls pass through `PreToolUse`.

Codex cannot currently prove a hard child executor budget or a supported way to terminate a running child. Child assignments must therefore be labeled advisory. They are not equivalent to OMP's tested bounded child path.

## User experience

The product should call this **Codex block-new mode** or **Codex limited mode**, not only "wall-clock active".

Activation:

```text
Codex wall-clock mode

Duration: 30 minutes
Policy: block-new
Hard deadline: 22:08
Wrap-up starts: 22:02

Covered:
- Bash
- file edits
- MCP tools
- supported local function tools

Not covered:
- hosted tools
- specialized paths outside Codex hooks
- work already running at the deadline

Running work will continue after expiry.
```

Wrap-up:

```text
WALL-CLOCK: CODEX LIMITED
4m 58s remaining

New delegation and destructive edits are blocked where Codex exposes them
through PreToolUse. Finish the current acceptance target. Do not start adjacent work.
```

Expiry before a covered tool starts:

```text
Blocked by wall-clock expiry.

The deadline passed. This Bash call was not started.
No running command was cancelled.
```

Expiry while a command is running:

```text
Deadline passed while an admitted command was running.

Result: command completed with exit code 0.
Cancellation: none.
Reason: Codex block-new mode does not stop running work.
```

A report must distinguish blocked-before-start, completed-after-deadline, and confirmed-cancelled. The Codex contract should never call an action cancelled unless Codex reports an actual cancellation result.

## Required implementation shape

The shared `HostEnforcement` boundary in `plugins/wall-clock/src/host.ts` already separates policy from host capabilities. A Codex adapter could reuse the controller and provide:

- Session state keyed by Codex `session_id` and persisted under plugin data.
- Session and turn hooks for restoring state and adding measured context.
- `PreToolUse` hooks for covered-tool admission decisions.
- `PostToolUse` hooks for result observation and action completion.
- Subagent hooks for advisory assignment context and lifecycle reporting.
- A Codex package manifest and bundled hook configuration.

The adapter must set `canBlockNew` only for the covered Codex hook path. It must not provide `abortRunning`, because no supported Codex executor abort contract was found.

## Evidence and open verification

Official Codex documentation states that:

- Codex plugins can package skills, MCP servers, and optional lifecycle hooks.
- `PreToolUse` can deny supported Bash, `apply_patch`, MCP, and local function calls.
- Hosted tools such as web search do not use the local function-tool hook path.
- `PostToolUse` cannot undo a completed side effect.
- `SubagentStart` can add context but cannot prevent a subagent from starting.
- Plugin hooks require review and trust before execution.

The local executable is `codex-cli 0.147.0`. Its feature list reports `plugins` and `hooks` as stable, but reports `plugin_hooks` as removed. The official hook documentation describes bundled plugin hooks. This discrepancy requires a real Codex smoke test before implementation. It is not evidence that bundled hooks work in the installed binary.

The minimum implementation evidence would be:

1. Codex discovers and enables a local wall-clock plugin.
2. The plugin's bundled `PreToolUse` hook runs after trust review.
3. A covered Bash call is blocked after expiry and does not execute.
4. A covered file edit is blocked after expiry and does not execute.
5. An uncovered hosted or specialized path is documented as outside enforcement.
6. A command admitted before expiry is allowed to finish and is not falsely reported as cancelled.
7. `abort-running` activation is rejected.
8. Session state restores correctly for a new turn and does not cross session identifiers.
9. A child receives advisory context without a claim of a hard child deadline.

## Recommendation

Add Codex support only if the reduced contract is acceptable:

- `block-new` only.
- Covered tools only.
- Explicit disclosure of unsupported paths.
- No `abort-running` claim.
- No hard child budget claim.
- Fail-closed activation when hooks cannot enforce the requested policy.

Keep Codex as package-discovery-only if the product requires universal tool coverage, hard child limits, or cancellation of running work.

This finding does not change the current v0 decision to defer Codex activation. It identifies an actionable v1 path that depends on a successful Codex smoke test and an explicit acceptance of the narrower contract.

## Sources

- [Codex plugin architecture](https://developers.openai.com/plugins/concepts/plugins)
- [Codex plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Agent Plugins specification](https://agent-plugins.org/specification)
- [Agent Plugins conformance checklist](https://agent-plugins.org/client-implementers/conformance)
- Existing host boundary: `plugins/wall-clock/src/host.ts`
- Current deferred decision: `docs/DECISIONS.md`, D10
