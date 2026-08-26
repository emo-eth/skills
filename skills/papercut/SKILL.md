---
name: papercut
description: Log small agent workflow friction that affected the work to a user-global PAPERCUTS.md file with the bundled shell helper.
license: MIT
---

# Papercut Logging

Use this skill when a small workflow friction affects how the work goes: it costs time, causes confusion, forces a retry or workaround, or makes the result less reliable. Log it while the context is fresh. Do not turn this into an eligibility review.

The helper writes to one user-global append-only file, not the repository. The default is `~/PAPERCUTS.md`; set `PAPERCUTS_PATH` or pass `--path` to choose another file.

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

- Log workflow or system friction when it affects the work, even if it is small, happens once, comes from a third party, or has no known fix.
- The effect on the work is enough. Do not require recurrence, ownership, severity, a proposed action, or proof that the note will matter later.
- Skip irrelevant oddities that had no effect on the work and self-corrected mistakes that the system did not contribute to.
- When unsure whether an effect was important enough, log it; importance is not a separate threshold.
- Log it in the moment; do not wait for a perfect postmortem.
- Keep it to one or two sentences. Include the work context, the friction, and its effect.
- Use `--file <path>` when one file caused the friction.
- Do not put secrets, tokens, private URLs, or copied logs with credentials in the message.
- This is for small workflow problems, not big bugs. Real bugs still need the normal tracker or review path.

For example, do not log "`vendor --help` returned an unusual exit code" when the work was unaffected. Do log it when that behavior misled you, forced a workaround, delayed the task, or made the result uncertain, even if the tool is third-party and you do not know the fix.

Each entry records the repository identity, worktree, branch (or detached commit), current folder, agent, related files, and note. Paths are local metadata; do not log secrets in paths or messages.

## Output

The CLI appends to the global `PAPERCUTS.md` path, creating its parent directory and file if needed. The default is `~/PAPERCUTS.md`; set `PAPERCUTS_PATH` or pass `--path` to choose another file. Output is never written into the repository.

`--repo <path>` sets the project root used to compute relative metadata (worktree, branch or detached commit, and folder); it does not change the global output location.
