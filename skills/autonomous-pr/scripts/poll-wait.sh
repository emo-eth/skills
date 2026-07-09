#!/usr/bin/env bash
# Phase-aware sleep that respects the Anthropic prompt-cache 5-min TTL.
#
# Usage: poll-wait.sh <phase>
#
# Phases (max sleep seconds):
#   active   — CI / Bugbot actively running, state changes expected soon (60s)
#   bugbot   — waiting for Bugbot to post at HEAD (90s; stays cache-warm)
#   settle   — 3-poll settle loop after green+clean (90s)
#   idle     — nothing expected soon; pay one cache miss for a long wait (1500s)
#
# Rationale: prompt cache TTL is ~5 min. Sleeps ≤270s keep every wake cache-warm
# (~10% of full input cost). Sleeps >300s pay a full cache miss. Don't pick 300s
# itself — it's worst-of-both. Either stay warm or commit to a long wait.
#
# The caller is responsible for the actual loop; this script just sleeps once.

set -euo pipefail

phase="${1:-active}"

case "$phase" in
  active)  secs=60 ;;
  bugbot)  secs=90 ;;
  settle)  secs=90 ;;
  idle)    secs=1500 ;;
  *) echo "Unknown phase: $phase (want: active|bugbot|settle|idle)" >&2; exit 1 ;;
esac

sleep "$secs"
