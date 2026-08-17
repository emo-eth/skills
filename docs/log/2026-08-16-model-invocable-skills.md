# Model-invocable skills extension — 2026-08-16

## Glossary

- **Model-invocable**: Pi includes the skill in the model-facing available-skills prompt because `disable-model-invocation` is not `true`.
- **User-only**: Pi loads the skill for explicit `/skill:<name>` use but excludes it from the model-facing skill list.
- **Widget**: A native Pi TUI block above the editor.
- **Native proof**: The pinned Pi host loads the real extension adapter and renders its widget.

## Source and scope lock

Source: <https://x.com/asidorenko_/status/2089041951551095174>

The post shows a separate native widget above Pi's editor:

```text
[Model-invocable skills] ctx7-docs
```

Pi's built-in `[Skills]` section lists every loaded skill. Comparing it with the custom line reveals which skills are user-only.

Chosen contract:

- package: `plugins/model-invocable-skills/`;
- adapter: native Pi only;
- command: `/model-invocable-skills`;
- result: one screenshot-matching themed line containing alphabetized model-invocable skill names;
- automatic refresh: before each agent run, using Pi's own `systemPromptOptions.skills` objects;
- finish line: focused typecheck/tests/package dry run and real pinned-host TUI evidence.

## Implementation boundary

The extension uses Pi 0.84.1's public extension API:

- `registerCommand` for immediate explicit inspection;
- `ExtensionCommandContext.getSystemPromptOptions()` for the authoritative loaded skill set;
- `before_agent_start.systemPromptOptions.skills` for automatic refresh after skills are loaded;
- `ui.setWidget(..., { placement: "aboveEditor" })` for visible output;
- `ui.theme.fg("mdHeading", ...)` and `ui.theme.fg("dim", ...)` for source-video styling.

It does not re-scan skill directories or infer visibility from command registration. Pi already parses `disable-model-invocation` into `Skill.disableModelInvocation`; that field is the source of truth.

There is no public extension seam for recoloring individual names inside Pi's built-in startup resource list. A separate widget is the native supported solution.

## Receipts

Focused package checks:

- `npm run check`: pass;
- `npm test`: 4/4 pass;
- `npm pack --dry-run --json`: pass; package contains manifest, README, Pi adapter, shared implementation, tests, and TypeScript config.

Pinned native Pi 0.84.1 RPC load:

```text
get_commands -> model-invocable-skills (source: extension, path: src/pi.ts)
/model-invocable-skills -> success: true, no LLM call
```

Pinned native Pi 0.84.1 interactive TUI smoke with one model-invocable skill and one user-only skill:

```text
[Skills]
  do-it-now, grok-search

[Extensions]
  pi.ts

[Model-invocable skills] grok-search
```

`grok-search` has `disableModelInvocation: false`; `do-it-now` has `true`. The live widget therefore matches Pi's authoritative classification and the source video's one-line form.

## GAP

The structured widget appears after `/model-invocable-skills` or the first `before_agent_start`. Pi exposes authoritative `Skill[]` data on those seams, not on untouched cold `session_start`. A provisional cold-start implementation would need to parse the system prompt and diff it against skill commands, which can be wrong when the `read` tool is disabled; this extension deliberately avoids that guess.
