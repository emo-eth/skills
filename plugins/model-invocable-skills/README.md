# model-invocable-skills

A native Pi extension that makes skill invocation visibility obvious.

- `● model` means Pi includes the skill in the model's available-skills prompt.
- `○ user` means the skill has `disable-model-invocation: true` and only runs through explicit `/skill:<name>` invocation.

## Use

Load the extension from this checkout:

```sh
pi --extension ./plugins/model-invocable-skills/src/pi.ts
```

Then run:

```text
/model-invocable-skills          # show the bounded widget
/model-invocable-skills list     # inspect every loaded skill
/model-invocable-skills hide     # remove the widget
```

The widget refreshes from Pi's loaded `systemPromptOptions.skills` before each agent run. It shows at most eight names per class and reports the remaining count instead of taking over the terminal.

## Verify

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm pack --dry-run --json
```
