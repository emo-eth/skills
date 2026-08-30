# plugin-updater (2026-08-30)

`plugins/plugin-updater/` is a Herdr plugin that checks installed
GitHub-managed plugins for upstream updates and reinstalls the ones the user
explicitly confirms. Herdr 0.8.x has no `herdr plugin update`; reinstall via
`herdr plugin install owner/repo[/subdir] --yes` is the refresh path, so the
plugin automates compare-preview-confirm-reinstall around it.

- `check` action: `plugin list --json` -> GitHub plugins only -> one
  `git ls-remote --symref` per repo -> classify `current` / `behind` /
  `pinned` / `error`; behind plugins additionally get a preview from the
  managed checkout (`git fetch` + `diff --shortstat` scoped to the subdir,
  versions from `git show` of both manifests). Local-linked plugins are
  excluded and counted. Report goes to stdout (command log) and
  `last-check.json` in `HERDR_PLUGIN_STATE_DIR`.
- `update` action: detached opener launches the `updater` popup
  (`placement = "popup"`), which shows the report and per-plugin previews,
  then requires `(a) update all`, `(s) per-plugin y/N` (default No), or
  cancels. No TTY -> refuse and exit 1; EOF/closed popup counts as No.
- Safety: pinned installs (tag/commit refs) are skipped; `plugin-updater`
  itself updates last via a detached helper (`self-update.ts`) because the
  reinstall replaces the running checkout; `min_herdr_version` refusals are
  surfaced with a "update Herdr first" hint.

Evidence, all on live Herdr 0.8.2 with the real installed plugin set:
manifest link + action discovery; `check` classified 6 behind / 1 current /
1 commit-pinned / local excluded with real version deltas (memex 0.11.6 ->
0.12.2 etc.); non-TTY updater run exited 1 with nothing installed; PTY
cancel exited 0 with nothing installed; PTY selective update moved
`herdr-file-viewer` 71d4c1c -> 647f032, kept its config-dir marker file, and
touched no other plugin; `update` action opened the popup (closed via
`popup.close`) with nothing installed; GitHub install from
`emo-eth/skills/plugins/plugin-updater` registered v0.1.0 at fa8e4d7; a
later push made the installed copy behind and the updater reinstalled
itself through the detached self-update path. 20 focused Node tests and
strict `tsc` cover parsing, classification, preview scoping, reinstall
args, self-last ordering, and fail-closed ls-remote handling.
