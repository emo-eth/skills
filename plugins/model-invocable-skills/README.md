# model-invocable-skills

A native Pi extension that shows which loaded skills the model can invoke automatically.

It adds one themed widget above the editor:

```text
[Model-invocable skills] ctx7-docs
```

Pi's built-in `[Skills]` section continues to show every loaded skill. Skills omitted from the model-invocable widget have `disable-model-invocation: true` and require explicit `/skill:<name>` invocation.

## Use

Load the extension from this checkout:

```sh
pi --extension ./plugins/model-invocable-skills/src/pi.ts
```

Run `/model-invocable-skills` to render or refresh the widget immediately. It also refreshes from Pi's authoritative loaded `systemPromptOptions.skills` before each agent run.

## Verify

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm pack --dry-run --json
```
