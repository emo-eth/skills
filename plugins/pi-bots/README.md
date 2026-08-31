# Pi Bots

Persistent domain-owning teammates for Pi. Pi Bots validates a `BOTS.yml` roster, materializes it as project-native `pi-subagents` agent files, gives every bot durable private memory and owner-written shared domain records, and leaves execution, background work, schedules, model fallback, and observability to `pi-subagents`.

## Requirements

- Pi `0.84.4` or newer
- `pi-subagents` `0.59.0` or newer loaded by Pi
- Node.js `22.6` or newer

For a local-path install, install the runtime dependency once:

```sh
cd /absolute/path/to/plugins/pi-bots
npm install --omit=dev
```

Then add both packages to `~/.pi/agent/settings.json` (or use `pi install` for each source):

```json
{
  "packages": [
    "npm:pi-subagents",
    "/absolute/path/to/plugins/pi-bots"
  ]
}
```

Copy `BOTS.example.yml` to `~/.pi/agent/BOTS.yml` for a user-wide roster or `.pi/BOTS.yml` for a project roster, then restart Pi. Project definitions replace same-named user definitions as whole bots. Every enabled domain must have exactly one owner.

## Use

`/bots` lists the roster, ownership, runtime names, configuration sources, and native-agent availability.

```text
/bots
/bots run research Find the primary sources for this decision.
/bots context research
/bots doctor
/bots reload
```

The model receives the same roster and can call the `bots` tool:

- `list`: inspect bots, domains, and runtime names
- `run`: run one bot in the foreground through the supported `pi-subagents` delegation API
- `context`: read bounded live domain records and the caller bot's private memory
- `record`: append an `observation`, `inference`, or evidence-backed `verified` record to a domain the caller owns
- `remember`: append durable private memory for the caller bot

Bots call peers with Pi's native `subagent` tool and exact runtime names such as `bot.research`. `bots run` is intentionally foreground-only. Native `pi-subagents` remains the only background lifecycle and control surface.

For background work, ask Pi naturally or use a workflow:

```js
{
  workflowScript: `return runs.run("research", {
    agent: "bot.research",
    task: "Monitor the primary sources and record material changes"
  })`,
  async: true
}
```

For recurring work, use the existing scheduler:

```js
{
  action: "schedule.create",
  every: "6h",
  workflowScript: `return runs.run("operations", {
    agent: "bot.operations",
    task: "Run the maintenance routine, record evidence, and report exceptions"
  })`
}
```

Use native `subagent` status, steer, stop, resume, FleetView, missions, and schedule commands for those runs. Scheduled work requires the `pi-subagents` schedule launcher; Pi Bots does not add a daemon.

## Configuration

```yaml
version: 1
instructions: Shared roster instructions
defaults:
  memory: project
  context: fresh
  timeoutMs: 900000
  maxSubagentDepth: 3
bots:
  - name: research
    title: Research Bot
    description: Owns source-grounded research.
    domains: [research]
    model: openai-codex/gpt-5.5
    fallbackModels: [openai-codex/gpt-5.4-mini]
    thinking: high
    tools: [read, grep, find, ls, bash, web_search, source_check, fetch_content]
    skills: [agent-reach]
    delegates: [engineering]
    memory: project
    context: fresh
    timeoutMs: 900000
    maxSubagentDepth: 3
    enabled: true
    instructions: Prefer primary sources and preserve URLs and dates.
```

Configuration discovery reads `BOTS.yml` or `.yaml` from `PI_CODING_AGENT_DIR` (default `~/.pi/agent`), then ancestor `.pi/BOTS.yml` or `.yaml` files through the project root. A closer project file wins. Unknown fields, invalid delegates, duplicate names, and duplicate domain ownership fail closed. `/bots reload` validates and renders a complete immutable generation before atomically replacing the stable generated-roster pointer.

## State

The effective roster is mirrored into standard recursively discovered Pi agent files:

```text
.pi/agents/pi-bots.generated/bot.<name>.md
```

The stable path is a symlink to an immutable generation under `.pi/pi-bots-generations/`; staging and cleanup live outside recursively scanned `.pi/agents`. Discovery follows the effective `pi-subagents` project root: nearest `.pi` or `.agents` by default, or the configured `subagents.projectRootResolution`. Generated bot definitions load a generated child extension carrying the same Pi agent-directory override. Do not define a separate project agent with the same `bot.<name>` runtime identity.

Project-scoped state:

```text
.pi/agent-memory/pi-bots/<bot>/MEMORY.md
.pi/team-context/<domain>.md
```

User-scoped state:

```text
~/.pi/agent/agent-memory/pi-bots/<bot>/MEMORY.md
~/.pi/agent/team-context/<domain>.md
```

Shared domain records follow the bot definition scope: project-defined bots write under the project, and user-defined bots write under the Pi agent directory. Private memory follows the explicit `memory: project | user | off` setting independently of where the bot was defined. Records carry owner, domain, kind, timestamp, and evidence provenance. Domain and memory files retain the newest complete entries within a 32 KiB persisted window. Only the enabled owner can append through the `bots` tool. Private memory is readable and writable only by its bot; a parent may read shared domain records but not bot-private memory.

The filesystem is a coordination boundary, not an operating-system security sandbox. A process with direct filesystem tools can bypass extension-level ownership. Bot prompts require the state tool for writes, and the state store itself fails closed on identity, ownership, path containment, symlink, or non-regular-file mismatch.

## Design boundaries

Pi Bots adds no runner, scheduler, model client, memory daemon, mission store, or chat transport. It composes standard `pi-subagents` agent files with the public structured-delegation events. The file mirror is necessary because nested Pi children are separate processes and cannot see a parent process's dynamic runtime-agent registry. This matches the useful Grok Bot and Hermes Bot Mode primitives while keeping Pi's existing lifecycle authoritative:

- named persistent specialists
- isolated private memory
- explicit domain ownership
- shared-readable, owner-written records
- peer collaboration
- background runs and routines through the native scheduler
- visible model fallback and run evidence

Primary references:

- [Grok Bot announcement](https://x.ai/news/introducing-grok-bot)
- [Grok Bot skills, routines, and automations](https://docs.x.ai/grok-bot/skills-routines-and-automations)
- [Hermes Bot Mode](https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode)
- [Hermes domain-ownership proposal](https://github.com/NousResearch/hermes-agent/issues/4529)
- [pi-subagents extension API](https://github.com/nicobailon/pi-subagents/blob/main/docs/extension-api.md)
