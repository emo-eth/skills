# Model-invocable skills extension — 2026-08-16

## Glossary

- **Model-invocable**: Pi includes the skill in the model-facing available-skills prompt because `disable-model-invocation` is not `true`.
- **User-only**: Pi loads the skill for explicit `/skill:<name>` use but excludes it from the model-facing skill list.
- **Widget**: A bounded Pi TUI block above the editor.
- **Native proof**: The pinned Pi host loads the real extension adapter and exposes or executes its command.

## Source and scope lock

Source: <https://x.com/asidorenko_/status/2089041951551095174>

The post recommends a Pi extension that reveals which loaded skills are model-invocable. Its screenshot shows a Pi startup resource list with `model-invocable-skills.ts` loaded.

Chosen contract:

- package: `plugins/model-invocable-skills/`;
- adapter: native Pi only;
- command: `/model-invocable-skills [show|list|hide]`;
- result: a bounded widget with model/user counts and names, plus a complete interactive list;
- automatic refresh: before each agent run, using Pi's own `systemPromptOptions.skills` objects;
- finish line: focused typecheck/tests/package dry run and real pinned-host command evidence.

## Implementation boundary

The extension uses Pi 0.84.1's public extension API:

- `registerCommand` for explicit startup-time inspection;
- `ExtensionCommandContext.getSystemPromptOptions()` for the authoritative loaded skill set;
- `before_agent_start.systemPromptOptions.skills` for automatic refresh after skills are loaded;
- `ui.setWidget`, `ui.select`, and `ui.notify` for visible output.

It does not re-scan skill directories or infer visibility from command registration. Pi already parses `disable-model-invocation` into `Skill.disableModelInvocation`; that field is the source of truth.

The widget is bounded to eight names per class. `/model-invocable-skills list` shows every loaded skill with `[model]` or `[user]` labeling.

## Receipts

Focused package checks:

- `npm run check`: pass;
- `npm test`: 5/5 pass;
- `npm pack --dry-run --json`: pass; package contains manifest, README, Pi adapter, shared implementation, tests, and TypeScript config.

Pinned native Pi 0.84.1 RPC load:

```text
get_commands -> model-invocable-skills (source: extension, path: src/pi.ts)
```

Pinned native Pi 0.84.1 command execution with one model-invocable skill and one user-only skill:

```text
/model-invocable-skills show
notify -> 1 model-invocable skill; 1 user-only skill.
response -> success: true
```

Pinned native Pi 0.84.1 interactive TUI smoke with the same two skills:

```text
1 model-invocable skill; 1 user-only skill.

[skills] 1 model-invocable · 1 user-only
● model  grok-search
○ user   do-it-now
/model-invocable-skills list|hide
```

## GAP

No screenshot artifact was captured, but the actual Pi 0.84.1 interactive TUI rendered the widget with the expected model/user classification. Pi's built-in startup resource list has no public extension styling seam in 0.84.1, so this package adds a separate accessible widget instead of monkey-patching private TUI internals.
