#!/usr/bin/env bash
# Emit one JSON status line for autonomous-pr iteration.
# Usage: status-log.sh key=value key=value ...
# Always includes ts. Numeric values unquoted; everything else string.

set -euo pipefail

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
out="{\"ts\":\"$ts\""

for arg in "$@"; do
  k="${arg%%=*}"
  v="${arg#*=}"
  # Skip caller-provided ts — script owns the timestamp field.
  if [[ "$k" == "ts" ]]; then continue; fi
  if [[ "$v" =~ ^-?[0-9]+$ ]]; then
    out="$out,\"$k\":$v"
  else
    v_escaped=$(printf '%s' "$v" | sed 's/\\/\\\\/g; s/"/\\"/g')
    out="$out,\"$k\":\"$v_escaped\""
  fi
done

out="$out}"
echo "$out"
