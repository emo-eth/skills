#!/usr/bin/env bash
# Emit required PR checks as structured JSON.
#
# Uses `gh pr checks` as the authoritative source of blocking status across
# GitHub Actions and external providers surfaced in PR checks.
#
# Flags:
#   --summary   Emit only PR info, summary, and blocking checks.
#   --all       Include non-required checks as well.

set -euo pipefail

MODE="full"
REQUIRED_FLAG="--required"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --summary) MODE="summary"; shift ;;
    --all) REQUIRED_FLAG=""; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

PR_JSON=$(gh pr view --json number,url,headRefName 2>/dev/null || true)
if [[ -z "$PR_JSON" ]]; then
  echo '{"error":"No PR found for current branch"}' >&2
  exit 1
fi

PR_NUMBER=$(jq -r '.number' <<<"$PR_JSON")
PR_URL=$(jq -r '.url' <<<"$PR_JSON")
PR_BRANCH=$(jq -r '.headRefName' <<<"$PR_JSON")

OUT_FILE=$(mktemp)
ERR_FILE=$(mktemp)
trap 'rm -f "$OUT_FILE" "$ERR_FILE"' EXIT

set +e
gh pr checks "$PR_NUMBER" $REQUIRED_FLAG \
  --json bucket,completedAt,description,event,link,name,startedAt,state,workflow \
  >"$OUT_FILE" 2>"$ERR_FILE"
GH_EXIT=$?
set -e

GH_STDOUT=$(cat "$OUT_FILE")
GH_STDERR=$(cat "$ERR_FILE")

if [[ -n "$GH_STDOUT" ]] && jq -e . >/dev/null 2>&1 <<<"$GH_STDOUT"; then
  CHECKS_JSON="$GH_STDOUT"
elif [[ $GH_EXIT -eq 1 && "$GH_STDERR" == *"no required checks reported"* ]]; then
  CHECKS_JSON='[]'
else
  echo "gh pr checks failed with exit code $GH_EXIT" >&2
  if [[ -n "$GH_STDERR" ]]; then
    printf '%s\n' "$GH_STDERR" >&2
  fi
  if [[ -n "$GH_STDOUT" ]]; then
    printf '%s\n' "$GH_STDOUT" >&2
  fi
  exit 1
fi

RESULT=$(jq -n \
  --arg number "$PR_NUMBER" \
  --arg url "$PR_URL" \
  --arg branch "$PR_BRANCH" \
  --arg required_only "$([[ -n "$REQUIRED_FLAG" ]] && echo true || echo false)" \
  --argjson checks "$CHECKS_JSON" '
  ($checks | map(
    . + {
      provider: (
        if ((.workflow // "") | length > 0) or ((.link // "") | test("github\\.com/.*/(actions/runs|runs)/")) then "github-actions" else "external" end
      ),
      is_blocking: (.bucket == "fail" or .bucket == "pending" or .bucket == "cancel")
    }
  )) as $normalized
  | {
      pr: {
        number: ($number | tonumber),
        url: $url,
        branch: $branch
      },
      required_only: ($required_only == "true"),
      checks: $normalized,
      blocking_checks: ($normalized | map(select(.is_blocking))),
      summary: {
        total_count: ($normalized | length),
        passing_count: ($normalized | map(select(.bucket == "pass")) | length),
        failing_count: ($normalized | map(select(.bucket == "fail")) | length),
        pending_count: ($normalized | map(select(.bucket == "pending")) | length),
        cancelled_count: ($normalized | map(select(.bucket == "cancel")) | length),
        skipping_count: ($normalized | map(select(.bucket == "skipping")) | length),
        blocking_count: ($normalized | map(select(.is_blocking)) | length),
        all_green: (($normalized | map(select(.is_blocking)) | length) == 0)
      }
    }')

if [[ "$MODE" == "summary" ]]; then
  jq '{pr, required_only, blocking_checks, summary}' <<<"$RESULT"
else
  jq '.' <<<"$RESULT"
fi
