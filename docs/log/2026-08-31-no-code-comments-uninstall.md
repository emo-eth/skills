# No-code-comments uninstall and correction (2026-08-31)

## What changed

The extension is uninstalled from every harness. OMP's installed copy was
removed with `omp plugin uninstall @emo-eth/no-code-comments-plugin`, the
chezmoi `run_z_sync-agent-plugins.sh` no longer installs it, and Pi and
Hermes were confirmed to have no live registration (`~/.pi/agent/npm`
package list has no entry; `~/.hermes` config and plugin directories have
no reference). Sessions started before the uninstall may keep an
in-process copy until they restart.

The repository source remains at `plugins/no-code-comments/`, bumped to
0.3.0 and corrected:

- Unrecognized extensions, including markdown and all of its derivatives
  (`.md`, `.mdx`, `.qmd`, `.rmd`, and anything else unrecognized), now pass
  through untouched. The fail-closed block for unsupported extensions with
  likely-comment content was removed from the Pi/OMP adapter and the
  Hermes adapter, and the Hermes `pre_tool_call` gate hook was deleted
  along with `block_reason`.
- A scheme-adjacent guard stops `//` directly preceded by `:` from being
  treated as a line comment, keeping URLs in JSX text intact.
- The preserved-directive list now also covers `# pragma`, `# nosec`,
  `# isort`, `# flake8`, `# shellcheck`, `# vim`, `# region`,
  `# endregion`, `//#region`/`//#endregion`, `biome-ignore`, `deno-lint`,
  `swiftlint`, `nolint`, `noinspection`, `clang-format`, and
  `markdownlint`/`stylelint` HTML comment directives.

## Why

The extension blocked a markdown `SKILL.md` write because markdown is not
a code family and its heading `#` characters look like comments to the
fail-closed gate. Comment stripping also risks tooling directives that
ride comment syntax; an allowlist is inherently incomplete, so the
correction favors doing nothing over doing harm for anything the stripper
does not positively recognize.

## Verification

- `npm run check`, 8 Node tests, the native OMP ExtensionRunner Bun test,
  and 8 Hermes Python tests all pass.
- `omp plugin list` no longer contains the plugin and
  `~/.omp/plugins/node_modules/@emo-eth/no-code-comments-plugin` is gone.
- Markdown, markdown derivatives, and unknown extensions pass through
  byte-identical in both adapters (pinned by tests).

## Residual risk and revival guidance

The lexers remain hand-rolled state machines: JSX text other than
scheme-adjacent URLs, template-literal interpolation, and regex-vs-division
disambiguation are heuristic. Any revival should either run advisory
(report, never rewrite) or parse with a real grammar instead of a lexer.
