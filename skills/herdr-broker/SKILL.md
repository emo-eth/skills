---
name: herdr-broker
description: "Route spoken or typed Herdr requests to the Herdr voice broker. Use when the user mentions Herdr, Herder, header, or any transcription of Herdr, the voice broker, or broker workstreams, or asks to start, run, check, message, update, or cancel delegated work. Executes only $HOME/.local/bin/voicebroker; never omp, never direct herdr, never a subagent."
---

# Herdr broker voice routing

This skill is the sole voice route for broker work. Run `$HOME/.local/bin/voicebroker` directly in the shell. Never invoke `omp`, never run `herdr` commands yourself, never spawn a subagent for broker work, and never patch Herdr, Codex, Pi, or OMP to establish another path. There is no OMP or direct-Herdr fallback: if the broker CLI fails, report the error exactly and stop.

The wrapper already has network access and targets the broker at `http://127.0.0.1:7749` by default; do not try to fix connectivity by switching tools.

## Five operations

Every request maps to exactly one verb. Always pass `--json` and read the JSON output.

| User intent | Verb |
| --- | --- |
| Start, run, take care of, handle, delegate work | `delegate` |
| Tell, reply, answer, send a note to a workstream | `message` |
| Check, is it up, does it work, what is running, how is it going | `status` |
| What happened, any news, progress, new events | `updates` |
| Stop, kill, abort, call off a workstream | `cancel` |

### delegate

```bash
$HOME/.local/bin/voicebroker delegate --title "<short title>" --prompt "<the user's request, verbatim>" --json
```

Optional `--priority 0-4` (default 2). The reply is `{"id":"ws_...","title":...,"priority":...,"state":"queued"}`. Delegation is asynchronous: the workstream is queued and the returned ID is the whole result. Tell the user the ID immediately and stop — never wait for the manager, never poll for completion. Completion arrives later through `updates` or a later `status` request.

### message

```bash
$HOME/.local/bin/voicebroker message --workstream <id> --body "<text, verbatim>" --json
```

Reply: `{"id":...,"state":...,"delivered":true|false}`. Report the new state and whether the message was delivered.

### status

```bash
$HOME/.local/bin/voicebroker status --json
$HOME/.local/bin/voicebroker status <id> --json
$HOME/.local/bin/voicebroker status --state working --json
```

State filters: `queued`, `starting`, `working`, `waiting`, `blocked`, `completed`, `failed`, `cancelled`; also `--priority 0-4`. Reply: `{"workstreams":[{id,title,priority,state,...}]}`. Summarize each workstream as title, state, and ID; speak timestamps only when asked.

### updates

```bash
$HOME/.local/bin/voicebroker updates --json
$HOME/.local/bin/voicebroker updates --after <cursor> --limit 20 --json
```

Reply: `{"events":[...],"cursor":N}`. Save `cursor` and pass it as `--after` next time so follow-ups return only new events. Summarize events per workstream by `type` (`delegated`, `manager`, `state`, `message`, `report`, `heartbeat`, `recovery`) instead of dumping raw JSON.

### cancel

```bash
$HOME/.local/bin/voicebroker cancel --workstream <id> [--reason "<why>"] --json
```

Reply: `{"id":...,"state":...}`. Confirm the new state to the user.

## Routing rules

- Vague health checks are never delegation. "Try the Herder Voice broker", "does the broker work", "is the broker up", "what is running", "anything new?" map to `status` (plus `updates` when the user asks for news). Run `delegate` only when the user actually hands over work to do.
- One request, one verb. If the user asks two things ("check on the deploy and start a new one"), run each verb separately and report both results.

## Speech transcription

Realtime transcription mangles "Herdr". "Herder", "header", "hurdle", "the Herder broker", "Herder Voice", "voice broker", and plain "the broker" all mean this skill. Route any such mention by intent; never ask the user to spell it.

## Resolving targets

- Explicit ID (`ws_...`): use it directly.
- Name or description ("the iPhone one", "the deploy workstream"): run `status --json` and match `title` case-insensitively; use the match.
- "It", "that one", "the same one": use the workstream ID from earlier in this conversation.
- No match or several plausible matches: read the candidate titles and states to the user and ask which one. Ask only then — every other target resolves from context.

## Conversation memory

Within the voice conversation, remember every workstream ID the user touched or you delegated, and the latest `updates` cursor. Follow-ups like "check on it" or "what did it say" reuse them: `status <id>` for a specific workstream, `updates --after <cursor>` for news. Never re-delegate just to refresh; answer from the broker's own data.

## Errors and boundaries

- Report command failures exactly: quote the CLI's stderr text and say the command failed. Never paraphrase into a guess, never retry silently, never claim success.
- Wrapper errors like `env file not readable`, `env file has no supervisor token`, or `release CLI missing` mean the deployment is broken; relay the message verbatim. Do not edit the wrapper, its env file, or broker config from the voice task.
- Never run `herdr`, never set or fake `HERDR_ENV`, never claim to be inside Herdr, never spawn subagents, never call `omp`.
