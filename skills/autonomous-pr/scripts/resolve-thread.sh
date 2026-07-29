#!/usr/bin/env bash
# Mark a PR review thread as resolved after addressing it.
# Usage: resolve-thread.sh <thread_id>
#
# The thread ID is the GraphQL node ID from get-pr-feedback.sh output
# (e.g. "PRRT_kwDOABcD..."), not a numeric comment ID.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <thread_id>" >&2
  exit 1
fi

THREAD_ID="$1"

# GraphQL variable $id is interpolated server-side, not by the shell.
# shellcheck disable=SC2016
gh api graphql -f query='
mutation($id: ID!) {
  resolveReviewThread(input: {threadId: $id}) {
    thread { id isResolved }
  }
}' -f id="$THREAD_ID"
