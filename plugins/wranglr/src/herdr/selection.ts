// Pure helpers for list selection movement and viewport scrolling in the
// manager pane. Kept out of manager.ts so they are testable without running
// the TUI entrypoint.

export type Section = "agents" | "worktrees";
export type Selection = {
  section: Section;
  key?: string;
};

/**
 * Anchor a selection to the given row keys (display order): keep a key that
 * is still on the list, otherwise snap to the first row. An empty list clears
 * the key.
 */
export function anchorSelection(rows: string[], selection: Selection): Selection {
  if (rows.length === 0) return { section: selection.section };
  return {
    section: selection.section,
    key: selection.key !== undefined && rows.includes(selection.key) ? selection.key : rows[0],
  };
}

/**
 * Move a key-based selection through `rows` (row keys in display order).
 * No key yet, or a stale key that no longer exists in `rows`, snaps to the
 * first row instead of deriving an out-of-range index from `indexOf === -1`.
 * Movement clamps at both ends; it never wraps.
 */
export function moveSelectionKey(
  rows: string[],
  key: string | undefined,
  delta: -1 | 1,
): string | undefined {
  if (rows.length === 0) return undefined;
  const index = key === undefined ? -1 : rows.indexOf(key);
  if (index === -1) return rows[0];
  const next = Math.max(0, Math.min(rows.length - 1, index + delta));
  return rows[next];
}

/**
 * Slice `lines` to a window of at most `height` lines that keeps `focusLine`
 * visible. With no focus line (or one out of range) the window starts at the
 * top, so an overflowing pane shows the head of the content instead of the
 * terminal scrolling it to the tail.
 */
export function viewportLines(
  lines: string[],
  focusLine: number | undefined,
  height: number,
): string[] {
  if (height <= 0 || lines.length <= height) return lines;
  const focus = focusLine !== undefined && focusLine >= 0 && focusLine < lines.length
    ? focusLine
    : 0;
  const start = Math.max(0, Math.min(focus - Math.floor(height / 2), lines.length - height));
  return lines.slice(start, start + height);
}
