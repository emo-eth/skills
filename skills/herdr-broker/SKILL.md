---
name: herdr-broker
disable-model-invocation: true
description: "Route spoken or typed requests about Herdr voice-broker work: the user references Herdr (any transcription, e.g. Herder or header), the voice broker, or a broker workstream, and asks to start, check, message, update, connect, inspect output, or cancel that delegated work. Do not use for generic start/check/run requests with no broker context. Uses herdr_broker_* MCP tools when available; otherwise executes $HOME/.local/bin/voicebroker in the shell. Never omp, never direct herdr, never a subagent."
---

# Herdr broker voice routing

This skill routes spoken or typed requests to the Herdr Voice Broker running at `http://127.0.0.1:7749`.

## Primary route: 2026 MCP tools

In voice sessions (such as Codex Mobile Voice) where shell/terminal execution is unavailable, use the mounted `herdr_broker_*` MCP tools directly:

| User intent | MCP tool | Key arguments |
| --- | --- | --- |
| Check status, what is running, how is work going | `herdr_broker_status` | `workstreamId?`, `state?` (`working`, `queued`, etc.), `priority?` (0-4) |
| Delegate, start, handle, run new work | `herdr_broker_delegate` | `title`, `prompt`, `priority?` (0-4, default 2) |
| Attach existing work, connect in-flight pane | `herdr_broker_connect` | `worktreePath?`, `paneId?`, `title?`, `priority?` |
| Inspect live terminal output, read what worker printed | `herdr_broker_read_output` | `workstreamId`, `lines?` (default 60) |
| Send note, reply, steer running worker | `herdr_broker_message` | `workstreamId`, `body` |
| What happened, any news, new events | `herdr_broker_updates` | `after?` (cursor integer), `limit?` (default 20) |
| Cancel, stop, abort a workstream | `herdr_broker_cancel` | `workstreamId`, `reason?` |

### Dual-layer voice response
Every `herdr_broker_*` tool returns dual-layer content:
1. First text block: natural, concise spoken text designed specifically for text-to-speech (TTS). Read this aloud to the user. Keep voice turns short and conversational (1-2 sentences).
2. Second text block: complete structured JSON payload. Use this for programmatic inspection if follow-up details are needed.

Delegation is asynchronous: `herdr_broker_delegate` queues the workstream and returns the ID immediately. Report the ID and status right away—never block or poll waiting for completion. Completion arrives later through `herdr_broker_updates` or `herdr_broker_status`.

## v0 attention signals

The broker is the durable alert channel. A voice session does not receive a push while it is closed, so never claim that it did.

At the start of a relevant broker voice turn, check `herdr_broker_updates` with the latest remembered cursor. Also check `herdr_broker_status` for `waiting`, `blocked`, and `failed` workstreams when the user asks what needs attention or returns after a break. If a workstream needs a decision, speak that concise attention summary before handling the user's new request.

Persist the returned `cursor` in the conversation and use it on the next updates call. Do not dump raw events or terminal output; summarize the workstream, state, evidence, and the one decision needed.

## Fallback route: CLI wrapper

If MCP tools are not mounted in this session and local shell access is available, run `$HOME/.local/bin/voicebroker` directly with `--json`:

- `delegate`: `$HOME/.local/bin/voicebroker delegate "<short title>" --prompt "<the user's request, verbatim>" --json`
- `message`: `$HOME/.local/bin/voicebroker message <id> --body "<text, verbatim>" --json`
- `status`: `$HOME/.local/bin/voicebroker status [--state <state>] [<id>] --json`
- `updates`: `$HOME/.local/bin/voicebroker updates [--after <cursor>] --limit 20 --json`
- `cancel`: `$HOME/.local/bin/voicebroker cancel <id> [--reason "<why>"] --json`

## Routing rules

- Vague health checks are never delegation. "Try the Herder Voice broker", "does the broker work", "is the broker up", "what is running", "anything new?" map to `status` (plus `updates` when the user asks for news). Run `delegate` only when the user actually hands over work to do.
- One request, one action. If the user asks two things ("check on the deploy and start a new one"), execute each action separately and report both results.

## Speech transcription

Realtime transcription mangles "Herdr". "Herder", "header", "hurdle", "the Herder broker", "Herder Voice", "voice broker", and plain "the broker" all mean this skill. Route any such mention by intent; never ask the user to spell it.

## Resolving targets

- Explicit ID (`ws_...`): use it directly.
- Name or description ("the iPhone one", "the deploy workstream"): run `status` and match `title` case-insensitively; use the match.
- "It", "that one", "the same one": use the workstream ID from earlier in this conversation.
- No match or several plausible matches: speak the candidate titles and states to the user and ask which one. Ask only then — every other target resolves from context.

## Conversation memory

Within the voice conversation, remember every workstream ID the user touched or you delegated, and the latest `updates` cursor. Follow-ups like "check on it" or "what did it say" reuse them: `status` for a specific workstream, `updates` with `after` cursor for news. Never re-delegate just to refresh; answer from the broker's own data.

## Errors and boundaries

- Report command or tool failures exactly. Server rejections come back with error codes (e.g. `not_found`) — relay the message clearly.
- Outside an explicit broker repair request, never run `herdr` CLI directly, never set or fake `HERDR_ENV`, never claim to be inside Herdr, never spawn subagents, and never call `omp`.
