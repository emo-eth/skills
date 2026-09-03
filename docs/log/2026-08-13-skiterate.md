# Skiterate v1 evidence

## Glossary

- **Agent Plugin**: A package that a host loads through its native extension system.
- **Native command**: A slash command registered directly with the host, not a skill wrapper.
- **Skill prompt marker**: Text or message metadata the host emits for a user-invoked skill.
- **GAP**: A capability or proof boundary that is not established and must not be promised.

## Scope

D36 names `skiterate` as a command-only Agent Plugins package. V7 requires one or two raw sentences captured during use. The package has no MCP component, skill wrapper, or standing-instructions file.

## Capability gate

### Pi 0.84.1

- `ExtensionAPI.registerCommand(name, options)` exposes native slash-command registration. The handler receives `(args, ctx)`.
- `ExtensionAPI.on("before_agent_start", handler)` exposes the expanded prompt. Pi's skill expansion source constructs `<skill name="..." location="...">` blocks for `/skill:<name>` commands.
- No dedicated `last-invoked skill` field exists in the inspected extension context or event types. Skiterate parses the tested skill block marker and the `message_start` content fallback.
- Evidence: `plugins/skiterate/tests/adapters.test.ts` registers the command and captures a Pi skill marker; `plugins/skiterate/tests/record.test.ts` checks the output record.

### OMP 17.2.15

- `ExtensionAPI.registerCommand(name, options)` exposes native slash-command registration. The handler receives `(args, ctx)`.
- `ExtensionAPI.on("before_agent_start", handler)` exposes the prompt, and `on("message_start", handler)` exposes the user-attributed skill message.
- OMP's user skill prompt template emits `[IMPORTANT: User invoked the "<name>" skill; ...]`. The `skill-prompt` message carries `details.name`.
- No dedicated `last-invoked skill` field exists in the inspected extension context or event types. Skiterate parses the prompt marker and `skill-prompt` details.
- Evidence: `plugins/skiterate/tests/adapters.test.ts` registers the command and captures OMP skill details; clean-process evidence below used the exact 17.2.15 package binary.

## GAPs

- Automatic skill capture depends on the host's tested prompt or message markers. A host change that removes or changes those markers will leave `skill` null until the adapter is updated.
- Explicit `/skiterate --skill <name> <note>` does not depend on automatic skill visibility.
- No separate live Pi process was run for this v1 brief. Pi command registration and marker capture are covered by package tests. The required clean OMP process was run.

## Implementation

- `plugins/skiterate/plugin.json`: Agent Plugins manifest.
- `plugins/skiterate/package.json`: native Pi and OMP entry points.
- `plugins/skiterate/src/record.ts`: argument parsing, Git metadata, model and skill extraction, and append-only Markdown record writing.
- `plugins/skiterate/src/host.ts`: shared command and marker wiring.
- `plugins/skiterate/src/pi.ts`: Pi entry point.
- `plugins/skiterate/src/omp.ts`: OMP entry point.
- `plugins/skiterate/tests/`: package, recorder, and adapter tests.

Each entry is one line: a Markdown list prefix followed by one JSON object. The default path is `~/SKITERATE.md`; `SKITERATE_PATH` overrides it. The record contains `datetime`, `repo`, `worktree`, `branch`, `cwd`, `agent`, `model`, `skill`, and `note`.

## Verification

From `plugins/skiterate/`:

- `npm run check`: passed.
- `npm test`: 7 tests passed, 0 failed.
- `jq -R -e 'select(length > 2) | .[2:] | fromjson | (.datetime and .repo and .worktree and .branch and .cwd and .agent and .model and .skill and .note)' /tmp/skiterate-live.md`: returned `true`.

Clean OMP proof:

```text
SKITERATE_PATH=/tmp/skiterate-live.md ./node_modules/.bin/omp --mode rpc --no-extensions --no-skills --no-rules --extension "$PWD/src/omp.ts" --session-dir /tmp/skiterate-live-session
```

The RPC prompt was:

```text
/skiterate --skill lc-ticketize live OMP note
```

The resulting record contained `agent: "OMP"`, `model: "openai-codex/gpt-5.6-luna"`, `skill: "lc-ticketize"`, `note: "live OMP note"`, branch `skiterate`, and the expected repository, worktree, cwd, and ISO datetime fields. The process loaded the extension in a fresh OMP 17.2.15 process. OMP's known full-process restart requirement remains: `/reload-plugins` was not used as a substitute.
