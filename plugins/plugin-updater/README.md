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

## Combined updates and restart

For one action that also updates Herdr, OMP, Pi, OMP plugins, and Pi extensions,
install the companion from this repository:

```sh
herdr plugin install emo-eth/skills/plugins/hard-update-restart --yes
herdr plugin action invoke all --plugin hard-update-restart
```

Choose **Update everything and hard-restart** in the command palette, then type
`update` in its confirmation popup. This replaces the companion's former
`runtimes` and `runtimes-and-extensions` actions.

The companion snapshots its worker and this package's update engine into durable
plugin state, then runs outside the pane's process group and without `HERDR_ENV`.
Herdr 0.9.0 can update its binary while compatible servers remain running.
Plugin updates finish before shutdown because restoring disabled plugins uses
the live server. The worker waits for idle/done agents again before stopping
and replacing the selected server; it does not use live handoff, which would
keep old agent processes and loaded plugins alive.

This stops **every pane process in that Herdr session**. Non-agent commands
return as fresh shells, not running dev servers. Missing, duplicate, invalid,
or unavailable native conversation references prevent shutdown. A partial update
failure remains a failure even when the restart recovers the agents. Pinned and
locally linked Herdr plugins are not upgraded; this is not a global skill-library
update or a config-source synchronization command.

The worker compares restored native session identities, not merely server
readiness. If the client does not reconnect automatically, run `herdr` or
`herdr --session <name>`. Recovery is checked for five minutes. The plugin's
state directory retains `latest-job.json` and each job's `status.json`,
`output.log`, and `agents.json`. An unfinished job retains its lock when the
worker cannot clean up; inspect that job before retrying.

Both source modules ship in the full managed repository checkout used by
Herdr's GitHub subdirectory installer. Do not copy just the companion directory
out of this repository. No separate installation of `plugin-updater` is needed.

Verification: both package typechecks and 31 Node tests pass. A macOS Herdr
0.9.0 smoke in an isolated named session ran the native Herdr updater against
a temporary binary (already current), upgraded a real GitHub plugin from
0.1.0 to 0.1.2 while preserving its disabled state and config file, and resumed
the same OMP conversation in a different process that loaded a changed
project-extension config marker. OMP/Pi download commands used isolated fixture
executables; this did not upgrade or restart the user's live agents. Other
platforms and a real Herdr binary-version change were not exercised.

## Development

```sh
npm install
npm run check
npm test
herdr plugin link "$(pwd)"
```

Unlink before installing the GitHub copy (`herdr plugin unlink plugin-updater`);
Herdr refuses to install over a locally linked plugin.
