# plugin-updater

A Herdr plugin that checks installed GitHub-managed plugins for upstream
updates and reinstalls the ones you explicitly confirm.

Herdr 0.8.x has no `herdr plugin update`; the supported refresh path is
reinstalling from GitHub. This plugin automates that: it compares each
plugin's recorded `resolved_commit` against the remote head of its tracked
ref, shows a preview, and re-runs `herdr plugin install` for the plugins you
approve.

## Install

```sh
herdr plugin install emo-eth/skills/plugins/plugin-updater
```

Requires `git` (already required by `herdr plugin install`) and Node.js
>= 22.6.

## Actions

- `check` — read-only report. For every GitHub-managed plugin: installed
  commit vs the upstream commit of the tracked ref, classified as `current`,
  `behind`, `pinned`, or `error`, plus a version delta and changed-files
  summary for `behind` plugins. Local-linked plugins are excluded. The report
  is also saved to `last-check.json` in the plugin state directory.
- `update` — opens a popup with the same report plus a per-plugin preview
  (old -> new commit, version delta, changed files). Updates run only after
  you confirm:
  - `a` updates everything listed (explicit opt-in),
  - `s` asks per plugin, default No,
  - Enter or anything else cancels; nothing is installed.

Invoke them from the command palette or:

```sh
herdr plugin action invoke check --plugin plugin-updater
herdr plugin action invoke update --plugin plugin-updater
```

`check` output lands in the plugin command log:

```sh
herdr plugin log list --plugin plugin-updater --limit 1
```

## Safety model

- The updater never applies updates when it cannot ask for confirmation
  (no interactive terminal): it prints the preview and exits non-zero.
- Pinned installs (`--ref` at a tag or commit) are never moved; they are
  reported as `pinned` and skipped.
- Reinstalls preserve each plugin's config and state directories; only the
  managed source checkout is replaced.
- `plugin-updater` itself, when selected, is reinstalled last from a
  detached helper, because the reinstall replaces the checkout the updater
  runs from.
- `--yes` is only passed to `herdr plugin install` after an explicit
  confirmation in the popup.
- When an update fails because the plugin now requires a newer Herdr
  (`min_herdr_version`), the raw error is shown with a hint to update Herdr
  first.

## Development

```sh
npm install
npm run check
npm test
herdr plugin link "$(pwd)"
```

Unlink before installing the GitHub copy (`herdr plugin unlink plugin-updater`);
Herdr refuses to install over a locally linked plugin.
