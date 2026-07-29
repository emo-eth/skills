#!/usr/bin/env bash
# Install context-steering's bundled read-only agent into detected host agent dirs.
# Run explicitly from the installed skill directory. Symlinks are the default so
# `npx skills update` refreshes the installed prompt; use --copy to freeze it.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$here/agents/context-reflector.agent.md"
mode="symlink"
target=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --copy) mode="copy" ;;
    --target)
      [ "$#" -ge 2 ] || { echo "--target needs a directory" >&2; exit 2; }
      target="$2"
      shift
      ;;
    -h|--help)
      printf 'Usage: %s [--copy] [--target AGENTS_DIR]\n' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
  shift
done

[ -f "$src" ] || { echo "Missing bundled agent: $src" >&2; exit 1; }

if [ -n "$target" ]; then
  targets=("$target")
else
  candidates=(
    "$HOME/.codex/agents"
    "$HOME/.claude/agents"
    "$HOME/.config/opencode/agents"
  )
  targets=()
  for candidate in "${candidates[@]}"; do
    [ -d "$(dirname "$candidate")" ] && targets+=("$candidate")
  done
fi

if [ "${#targets[@]}" -eq 0 ]; then
  echo "No known host agent directory detected. Use --target AGENTS_DIR if needed."
  exit 0
fi

for dest in "${targets[@]}"; do
  mkdir -p "$dest"
  name="$(basename "$src")"
  rm -f "$dest/$name"
  if [ "$mode" = "copy" ]; then
    cp "$src" "$dest/$name"
  else
    ln -s "$src" "$dest/$name"
  fi
  printf 'Installed %s (%s) -> %s\n' "$name" "$mode" "$dest"
done
