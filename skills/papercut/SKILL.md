---
name: papercut
description: Log actionable agent workflow friction to a user-global PAPERCUTS.md file with the bundled shell helper.
license: MIT
---

# Papercut Logging

Use this skill only when a small workflow friction points to a concrete change in a repository, owned tool, documentation, or agent process. A papercut is not merely surprising: it must be likely to affect another agent or future session, and someone must be able to act on it.

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

- Before logging, name the concrete change that could prevent the friction. If there is no plausible change, do not log it.
- Log only problems in code, configuration, documentation, tools, or agent processes that we own or can change.
- Do not log a third-party command's unusual output or exit code unless our documentation, wrapper, or automation depends on that behavior and needs a specific change.
- Do not log a typo, expected behavior, harmless quirk, or one-off transient failure without evidence of a maintained-system problem.
- After these checks pass, log it in the moment; do not wait for a perfect postmortem.
- Keep it to one or two sentences. Include the work context, the friction, and the proposed action.
- Use `--file <path>` when one file caused the friction.
- Do not put secrets, tokens, private URLs, or copied logs with credentials in the message.
- This is for small, actionable improvements, not big bugs. Real bugs still need the normal tracker or review path.

For example, do not log "`vendor --help` returned an unusual exit code." Log it only when the repository has an incorrect assumption to fix, such as "The setup check treats `vendor --help` exit 1 as unavailable -> change the check to use `vendor --version`."

Each entry records the repository identity, worktree, branch (or detached commit), current folder, agent, related files, and note. Paths are local metadata; do not log secrets in paths or messages.

## Output

The CLI appends to the global `PAPERCUTS.md` path, creating its parent directory and file if needed. The default is `~/PAPERCUTS.md`; set `PAPERCUTS_PATH` or pass `--path` to choose another file. Output is never written into the repository.

`--repo <path>` sets the project root used to compute relative metadata (worktree, branch or detached commit, and folder); it does not change the global output location.
