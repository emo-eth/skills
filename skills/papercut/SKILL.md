---
name: papercut
description: Log small agent workflow frictions to a repo-local PAPERCUTS.md file with the papercut CLI.
version: 0.1.0
author: Emo / Springfield
license: MIT
---

# Papercut Logging

Use this skill whenever you notice a small friction while working in a repository: a misleading command, flaky setup step, unclear documentation, cache surprise, missing helper, path mismatch, template drift, or another annoyance that was not worth stopping for but should be visible later.

## Command

```bash
papercut -m <agent-or-model> "what you were doing -> what got in the way"
```

Examples:

```bash
papercut -m gpt-5.6-luna "Running the smoke test -> the documented path was package-relative but the test expected repo-root paths."
papercut --agent codex --file docs/setup.md "Following setup docs -> the command name had changed and the doc still used the old one."
```

## Rules

- Log it in the moment; do not wait for a perfect postmortem.
- Keep it to one or two sentences.
- Include the work context and the friction.
- Use `--file <path>` when one file caused the friction.
- Do not put secrets, tokens, private URLs, or copied logs with credentials in the message.
- This is for sandpaper, not big bugs. Real bugs still need the normal tracker/review path.

## Output

The CLI appends to `PAPERCUTS.md` at the nearest Git repository root. It creates the file if needed.
