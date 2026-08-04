# Papercuts

Small frictions agents hit while working in this repository. These are not full bug reports; they are sandpaper notes for later cleanup.

## Entries

- **2026-07-30T22:00:43.122Z** `gpt-5.6-luna`
  - cwd: `.`
  - note: While checking OMP agent frontmatter, the task-agent docs linked implementation source paths that are not addressable through omp://, so the direct read failed; the index should distinguish source links from readable documentation resources.
- **2026-08-04T00:13:49.635Z** `gpt-5`
  - cwd: `.`
  - note: Initializing the new wizard skill -> init_skill.py created the scaffold but rejected the documented nested policy.allow_implicit_invocation interface field; metadata must be added manually.
- **2026-08-04T00:18:21.487Z** `gpt-5`
  - cwd: `.`
  - note: Validating the new wizard skill -> quick_validate.py rejected Matt's disable-model-invocation frontmatter key even though the upstream skill uses it; the local validator only accepts the narrower standard key set, so the user-invocation restriction must live in agents/openai.yaml.
- **2026-08-04T00:18:46.589Z** `gpt-5`
  - cwd: `.`
  - note: Running a synthetic direct-execution smoke test -> the command wrapper rejected a safe temp-directory cleanup trap because it matched rm -f style protection; I reran without cleanup in the disposable /tmp test directory.
- **2026-08-04T00:20:10.459Z** `gpt-5`
  - cwd: `.`
  - note: Smoke-testing the wizard with piped input -> zsh rejected a generic status variable because it is read-only, and readline/promises can leave a pending question when piped EOF closes the interface after the first prompt; use task-specific shell variables and buffered scripted input for non-TTY runs.
- **2026-08-04T17:55:23.371Z** `gpt-5`
  - cwd: `.`
  - note: Running a no-input helper smoke test -> the command omitted ENV_FILE and wrote an empty .env in the repository root; disposable fixture tests must always set an explicit output path.
