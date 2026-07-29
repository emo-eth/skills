# Host-format receipts

The reflection protocol is transport-agnostic, but host agent files are not:

- Codex's current custom-agent documentation requires standalone TOML under `~/.codex/agents/` (personal) or `.codex/agents/` (project) with `name`, `description`, and `developer_instructions`. This skill bundles `agents/context-reflector.toml` and sets `sandbox_mode = "read-only"`.
- OpenCode's current agent documentation supports Markdown under `~/.config/opencode/agents/` (global) or `.opencode/agents/` (project), with `mode: subagent` and permissions. This skill bundles `agents/context-reflector.opencode.md` and denies `edit` and `bash`.
- Claude-style hosts use the bundled `agents/context-reflector.agent.md` adapter. The installer only targets a directory explicitly supplied with `--target` for this generic Markdown adapter, or the detected Claude directory in auto mode.

These formats and paths are host facts, not part of the reflection JSON contract. Re-check the host's current documentation if its agent format changes.

References:

- Codex / ChatGPT Learn: https://learn.chatgpt.com/docs/agent-configuration/subagents
- OpenCode: https://opencode.ai/docs/agents/
