#!/usr/bin/env bash
# Install the subagents this skill depends on into the host agent's agents directory.
#
# `npx skills` distributes the skill directory (SKILL.md, references/, scripts/,
# agents/) but does NOT place subagents into a tool's agents directory. This
# script bridges that gap: it symlinks the bundled *.agent.md files into every
# known agents dir that exists on this machine, so contract-audit's reviewer
# panel actually resolves.
#
# Idempotent. Re-run after `npx skills update`. Symlinks by default so updates to
# the skill propagate; pass --copy to hard-copy instead.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # skill root
src="$here/agents"

mode="symlink"
[ "${1:-}" = "--copy" ] && mode="copy"

# Candidate agents dirs across tools that support subagents. Add more as needed.
candidates=(
  "$HOME/.claude/agents"
  "$HOME/.config/opencode/agents"
)

# Only install into dirs whose parent tool is actually present (parent dir exists).
targets=()
for d in "${candidates[@]}"; do
  parent="$(dirname "$d")"
  [ -d "$parent" ] && targets+=("$d")
done

if [ ${#targets[@]} -eq 0 ]; then
  echo "No known agent tool detected (looked for: ${candidates[*]}). Nothing to do." >&2
  exit 0
fi

count=0
for dest in "${targets[@]}"; do
  mkdir -p "$dest"
  for f in "$src"/*.agent.md; do
    [ -e "$f" ] || continue
    name="$(basename "$f")"
    rm -f "$dest/$name"
    if [ "$mode" = "copy" ]; then
      cp "$f" "$dest/$name"
    else
      ln -s "$f" "$dest/$name"
    fi
    count=$((count + 1))
  done
  echo "Installed $(ls "$src"/*.agent.md | wc -l | tr -d ' ') agents ($mode) → $dest"
done

echo "Done. $count agent link(s)/copy(ies) written."
