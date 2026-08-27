#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_file="$root/agents/poteto-agent.agent.md"
mode="symlink"
if [[ "${1:-}" == "--copy" ]]; then
  mode="copy"
fi

installed=0
for agents_dir in "$HOME/.omp/agent/agents" "$HOME/.pi/agent/agents"; do
  if [[ ! -d "$(dirname "$agents_dir")" ]]; then
    continue
  fi
  mkdir -p "$agents_dir"
  target="$agents_dir/poteto-agent.md"
  rm -f "$target"
  if [[ "$mode" == "copy" ]]; then
    cp "$source_file" "$target"
  else
    ln -s "$source_file" "$target"
  fi
  printf 'Installed poteto-agent (%s) -> %s\n' "$mode" "$target"
  installed=$((installed + 1))
done

printf 'Installed poteto-agent into %s host agent directories.\n' "$installed"
