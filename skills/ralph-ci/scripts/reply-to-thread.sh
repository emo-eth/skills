#!/usr/bin/env bash
# Post a reply to a PR review thread, then resolve it.
# Usage: reply-to-thread.sh <thread_id> <body>
#
# Use this when a bot comment is a genuine false positive — reply explaining
# why, then resolve. Do NOT use this to dismiss comments you haven't actually
# evaluated.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <thread_id> <body>" >&2
  exit 1
fi

THREAD_ID="$1"
BODY="$2"

# GraphQL variables ($threadId, $body, $id) are interpolated server-side, not by the shell.
# shellcheck disable=SC2016
gh api graphql -f query='
mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body}) {
    comment { id }
  }
}' -f threadId="$THREAD_ID" -f body="$BODY" >/dev/null

# shellcheck disable=SC2016
gh api graphql -f query='
mutation($id: ID!) {
  resolveReviewThread(input: {threadId: $id}) {
    thread { id isResolved }
  }
}' -f id="$THREAD_ID"
