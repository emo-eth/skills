# Wranglr rename, manager sorting, and selection/scroll fix

Session work on the Herdr plugin formerly named `focus-order`.

## Rename to Wranglr

- `plugins/focus-order/` -> `plugins/wranglr/` via `git mv`; all identifier
  forms rewritten with `subvert` (`--case abolish --styles identifier`,
  173 replacements in 28 files, plus 3 exact `Focus Order` -> `Wranglr`
  replacements). Two mixed-case manifest titles were hand-edited.
- Clean cutover, no migration: package is `@emo-eth/wranglr`, the plugin id is
  `wranglr`, the companion command is `wranglr`, and state now lives at
  `~/.config/herdr/wranglr/wranglr.json`. Old `focus-order` state is ignored.
- `bunx subvert-cli` was unusable (broken cached install missing its `diff`
  dependency); `npx -y subvert-cli` worked because no brace groups were needed.

## Manager pane: selection/scroll bug

Reported: pane opened with a line near the bottom highlighted; down jumped to
the last item, then to the first, then walked down and stopped one short.

Root causes in `src/herdr/manager.ts`:

- The pane opened with no selection key, so nothing was anchored and the
  terminal cursor sat at the bottom of the frame.
- `moveSelection` used `rows.indexOf(key)` and treated a missing or stale key
  as index `-1`/`0`, so the first presses produced wrap-looking jumps.
- The frame is written top-to-bottom into a 24-row popup; content taller than
  the popup made the terminal scroll to the tail, hiding the `>` marker.

Fix (`src/herdr/selection.ts`, wired into `manager.ts`):

- `anchorSelection` snaps the selection to the first row on open and whenever
  the stored key disappears from the row list.
- `moveSelectionKey` clamps at both ends, never wraps, and treats a stale key
  as the first row.
- `viewportLines` windows the rendered frame to the pane height and keeps the
  selected line visible; with no selection it shows the head, not the tail.

## Manager pane: column sorting

- `src/herdr/table-sort.ts`: `t` cycles rank -> status -> agent -> project ->
  worktree; `T` flips direction. The header row marks the active column with
  `^`/`v`. Default (rank ascending) reproduces the existing priority order
  exactly. Sort is view-only pane state, never persisted. Selection is
  key-based, so the selected row keeps its identity across re-sorts.
- Mouse header clicks were not implemented: the pane receives raw stdin only;
  there is no mouse-event plumbing in the Herdr plugin pane protocol, and
  enabling xterm mouse reporting plus row hit-testing was not worth it when
  two keys cover the feature.

## Verification

- `npm run check` (tsc) clean; 125 Node tests pass (25 suites), including new
  `tests/selection.test.ts` and `tests/table-sort.test.ts`.
- Live PTY smoke run of `src/herdr/manager.ts` against the local Herdr socket:
  first row selected on open, arrow movement walks rows in order, `t`/`T`
  moved the header marker (`RANK^` -> `STATUS^` -> `STATUSv`) and regrouped
  the rows, `q` exits.

## Infrastructure friction

All five delegated subagents in this session were hard-blocked by the
wall-clock host gate ("lifecycle contract was invalid or incomplete",
`plugins/wall-clock/src/host.ts` child coordination) even though wall-clock
reported inactive for the session. Two later recovered when the gate lifted;
the work was finished by the main session. Logged in `PAPERCUTS.md`.
