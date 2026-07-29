#!/usr/bin/env bash
# Install context-steering's bundled read-only agent in the host's native format.
# Run explicitly from the installed skill directory. Symlinks are the default so
# updates refresh the prompt; use --copy to freeze it. Existing different definitions
# are refused; use --force to replace one with a backup.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
claude_src="$here/agents/context-reflector.agent.md"
codex_src="$here/agents/context-reflector.toml"
opencode_src="$here/agents/context-reflector.opencode.md"
mode="symlink"
force=0
target=""
host="auto"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --copy) mode="copy" ;;
    --force) force=1 ;;
    --target)
      [ "$#" -ge 2 ] || { echo "--target needs a directory" >&2; exit 2; }
      target="$2"
      shift
      ;;
    --host)
      [ "$#" -ge 2 ] || { echo "--host needs codex, claude, opencode, or generic" >&2; exit 2; }
      host="$2"
      shift
      ;;
    -h|--help)
      printf 'Usage: %s [--copy] [--force] [--target AGENTS_DIR] [--host codex|claude|opencode|generic]\n' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
  shift
done

case "$host" in
  auto|codex|claude|opencode|generic) ;;
  *) echo "Unknown host: $host" >&2; exit 2 ;;
esac

[ -f "$claude_src" ] || { echo "Missing bundled Claude-style agent: $claude_src" >&2; exit 1; }
[ -f "$codex_src" ] || { echo "Missing bundled Codex agent: $codex_src" >&2; exit 1; }
[ -f "$opencode_src" ] || { echo "Missing bundled OpenCode agent: $opencode_src" >&2; exit 1; }

md_targets=()
codex_targets=()
opencode_targets=()

if [ -n "$target" ]; then
  case "$host" in
    codex) codex_targets=("$target") ;;
    opencode) opencode_targets=("$target") ;;
    auto|claude|generic) md_targets=("$target") ;;
  esac
else
  case "$host" in
    auto)
      [ -d "$HOME/.codex" ] && codex_targets+=("$HOME/.codex/agents")
      [ -d "$HOME/.claude" ] && md_targets+=("$HOME/.claude/agents")
      [ -d "$HOME/.config/opencode" ] && opencode_targets+=("$HOME/.config/opencode/agents")
      ;;
    codex) codex_targets=("$HOME/.codex/agents") ;;
    claude) md_targets=("$HOME/.claude/agents") ;;
    opencode) opencode_targets=("$HOME/.config/opencode/agents") ;;
    generic) md_targets=("$HOME/.claude/agents") ;;
  esac
fi

if [ "${#md_targets[@]}" -eq 0 ] && [ "${#codex_targets[@]}" -eq 0 ] && [ "${#opencode_targets[@]}" -eq 0 ]; then
  echo "No known host agent directory detected. Use --target AGENTS_DIR and --host codex|claude|opencode if needed."
  exit 0
fi

install_one() {
  local src="$1"
  local dest="$2"
  local name="$3"
  local path="$dest/$name"
  local stage_dir=""
  local stage_path=""
  local backup=""

  mkdir -p "$dest"

  if [ -e "$path" ] || [ -L "$path" ]; then
    if [ "$mode" = "copy" ] && [ -f "$path" ] && cmp -s "$src" "$path"; then
      printf 'Already installed %s (copy) -> %s\n' "$name" "$dest"
      return 0
    fi
    if [ "$mode" = "symlink" ] && [ -L "$path" ] && [ "$(readlink "$path")" = "$src" ]; then
      printf 'Already installed %s (symlink) -> %s\n' "$name" "$dest"
      return 0
    fi
    if [ "$force" -ne 1 ]; then
      echo "Refusing to replace existing agent: $path" >&2
      echo "Use --force to replace it; the old file will be backed up." >&2
      return 3
    fi
  fi

  stage_dir="$(mktemp -d "$dest/.context-steering-install.XXXXXX")"
  stage_path="$stage_dir/$name"
  if [ "$mode" = "copy" ]; then
    cp "$src" "$stage_path"
  else
    ln -s "$src" "$stage_path"
  fi

  if [ -e "$path" ] || [ -L "$path" ]; then
    backup="$path.bak.$(date +%Y%m%d%H%M%S).$$"
    suffix=0
    while [ -e "$backup" ] || [ -L "$backup" ]; do
      suffix=$((suffix + 1))
      backup="$path.bak.$(date +%Y%m%d%H%M%S).$$.$suffix"
    done
    mv "$path" "$backup"
    if ! mv "$stage_path" "$path"; then
      mv "$backup" "$path" || true
      rm -rf "$stage_dir"
      echo "Failed to install $name; restored $path" >&2
      return 1
    fi
    rm -rf "$stage_dir"
    printf 'Installed %s (%s) -> %s; backup=%s\n' "$name" "$mode" "$dest" "$backup"
  else
    mv "$stage_path" "$path"
    rm -rf "$stage_dir"
    printf 'Installed %s (%s) -> %s\n' "$name" "$mode" "$dest"
  fi
}

for dest in "${codex_targets[@]}"; do
  install_one "$codex_src" "$dest" "context-reflector.toml"
done
for dest in "${md_targets[@]}"; do
  install_one "$claude_src" "$dest" "context-reflector.agent.md"
done
for dest in "${opencode_targets[@]}"; do
  install_one "$opencode_src" "$dest" "context-reflector.md"
done
