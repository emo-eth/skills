#!/usr/bin/env bash
# Get failure details for blocking PR checks.
# Usage:
#   get-failed-logs.sh [--run-id ID]
#   get-failed-logs.sh [--check-name NAME]
#
# If the blocking check is a GitHub Actions run, fetch failed logs via `gh run view`.
# If the blocking check is external (for example Cloud Build surfaced in PR checks),
# emit the failing check metadata plus the nearest local parity commands.

set -euo pipefail

RUN_ID=""
CHECK_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_ID="$2"; shift 2 ;;
    --check-name) CHECK_NAME="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if [[ -z "$RUN_ID" && -z "$CHECK_NAME" ]]; then
  CHECK_NAME=$("$SCRIPT_DIR/get-pr-checks.sh" --summary | jq -r '.blocking_checks[] | select(.bucket == "fail") | .name' | head -n 1)
  if [[ -z "$CHECK_NAME" ]]; then
    echo "No failed PR checks found." >&2
    exit 1
  fi
fi

if [[ -n "$RUN_ID" ]]; then
  echo "--- Failed logs for GitHub Actions run $RUN_ID ---"
  gh run view "$RUN_ID" --log-failed
  exit 0
fi

if [[ -z "$CHECK_NAME" ]]; then
  echo "No blocking check found." >&2
  exit 1
fi

CHECK_JSON=$("$SCRIPT_DIR/get-pr-checks.sh" | jq -c --arg name "$CHECK_NAME" '.checks[] | select(.name == $name)' | head -n 1)
if [[ -z "$CHECK_JSON" ]]; then
  echo "Could not find PR check named: $CHECK_NAME" >&2
  exit 1
fi

PROVIDER=$(jq -r '.provider' <<<"$CHECK_JSON")
CHECK_LINK=$(jq -r '.link // empty' <<<"$CHECK_JSON")

if [[ "$PROVIDER" == "github-actions" && -n "$CHECK_LINK" ]]; then
  LINK_RUN_ID=$(sed -nE 's|.*/actions/runs/([0-9]+).*|\1|p' <<<"$CHECK_LINK")
  if [[ -n "$LINK_RUN_ID" ]]; then
    echo "--- Failed logs for check $CHECK_NAME (run $LINK_RUN_ID) ---"
    gh run view "$LINK_RUN_ID" --log-failed
    exit 0
  fi
fi

echo "--- Blocking PR check is external to GitHub Actions ---"
jq '.' <<<"$CHECK_JSON"
echo
echo "--- Nearest local parity commands ---"
"$SCRIPT_DIR/derive-local-parity.sh" "$CHECK_NAME"
