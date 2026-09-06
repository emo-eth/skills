#!/usr/bin/env bash
# Emit one JSON status line for autonomous-pr iteration.
# Usage: status-log.sh key=value key=value ...
# Always includes ts. Numeric values unquoted; everything else string.

set -euo pipefail

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
out=$(jq -n --arg ts "$ts" '{ts: $ts}')

for arg in "$@"; do
  k="${arg%%=*}"
  v="${arg#*=}"
  if [[ "$k" == "ts" ]]; then continue; fi
  if [[ "$v" =~ ^-?[0-9]+$ ]]; then
    out=$(jq --arg key "$k" --arg value "$v" \
      '. + {($key): ($value | tonumber)}' <<<"$out")
  else
    out=$(jq --arg key "$k" --arg value "$v" \
      '. + {($key): $value}' <<<"$out")
  fi
done

jq -c . <<<"$out"
