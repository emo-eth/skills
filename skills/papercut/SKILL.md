---
name: papercut
description: Log small agent workflow frictions to a repo-local PAPERCUTS.md file with the bundled shell helper.
license: MIT
---

# Papercut Logging

Use this skill whenever you notice a small friction while working in a repository: a misleading command, flaky setup step, unclear documentation, cache surprise, missing helper, path mismatch, template drift, or another annoyance that was not worth stopping for but should be visible later.

There is no global `papercut` command. Use the bundled `scripts/papercut.sh` helper directly.

## Resolve the helper

Run this once in the shell where you will log the papercut. Set `PAPERCUT_SKILL_DIR` to the directory containing this `SKILL.md` when the skill system gives you that path. The other candidates cover the standard global skill locations.

```bash
papercut_skill_script=""
for papercut_candidate in \
  "${PAPERCUT_SKILL_DIR:-}/scripts/papercut.sh" \
  "${CODEX_HOME:-$HOME/.codex}/skills/papercut/scripts/papercut.sh" \
  "$HOME/.agents/skills/papercut/scripts/papercut.sh" \
  "$HOME/.claude/skills/papercut/scripts/papercut.sh" \
  "$HOME/dev/skills/skills/papercut/scripts/papercut.sh"
do
  if [[ -n "$papercut_candidate" && -f "$papercut_candidate" ]]; then
    papercut_skill_script="$papercut_candidate"
    break
  fi
done

if [[ -z "$papercut_skill_script" ]]; then
  echo "papercut skill: scripts/papercut.sh was not found" >&2
  exit 127
fi
```

Use the resolved path directly:

```bash
bash "$papercut_skill_script" -m <agent-or-model> "what you were doing -> what got in the way"
bash "$papercut_skill_script" --agent codex --file docs/setup.md "Following setup docs -> the command name had changed and the doc still used the old one."
```

For repeated calls in one interactive shell, an optional shell-local function avoids repeating `bash` without installing a command globally:

```bash
papercut() { bash "$papercut_skill_script" "$@"; }
papercut -m codex "what you were doing -> what got in the way"
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
