#!/usr/bin/env bash
# Emit actionable PR feedback as structured JSON.
#
# Primary signal is `unresolved_threads` — PR review threads whose `isResolved`
# is false. This is the authoritative "needs action" list for bugbot/CodeRabbit/
# Greptile/etc. The REST comments endpoint has no resolved state; GraphQL does.
#
# Flags:
#   --summary   Emit only counts + latest timestamps. Tiny output (~150 bytes)
#               suitable for polling loops where you only need to detect change.
#               Fetches no review/comment bodies (saves tokens in model context).
#   (default)   Emit full schema with thread/review bodies.
#
# Full output schema:
#   {
#     "pr": {"number": N, "url": "..."},
#     "unresolved_threads": [
#       {"id": "...", "path": "...", "line": N, "isOutdated": bool,
#        "author": "...", "isBot": bool,
#        "body": "...", "commentCount": N, "createdAt": "..."}
#     ],
#     "bot_reviews": [
#       {"id": "...", "author": "...", "state": "COMMENTED",
#        "body": "...", "createdAt": "..."}
#     ],
#     "bot_issue_comments": [
#       {"id": N, "author": "...", "body": "...", "createdAt": "..."}
#     ],
#     "summary": {"unresolved_count": N, "bot_review_count": N,
#                 "bot_issue_comment_count": N,
#                 "latest_thread_ts": "...", "latest_review_ts": "...",
#                 "latest_issue_comment_ts": "...",
#                 "latest_review_commit_sha": "...",
#                 "current_head_sha": "...",
#                 "latest_review_matches_head": bool}
#   }
#
# --summary output schema (bodies stripped):
#   {
#     "pr": {"number": N, "url": "..."},
#     "summary": { ...counts + latest_*_ts + latest_review_commit_sha... }
#   }

set -euo pipefail

MODE="full"
BUGBOT_TIMEOUT_MIN="${BUGBOT_TIMEOUT_MIN:-6}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --summary) MODE="summary"; shift ;;
    --timeout-min) BUGBOT_TIMEOUT_MIN="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

PR_JSON=$(gh pr view --json number,url 2>/dev/null || true)
if [[ -z "$PR_JSON" ]]; then
  echo '{"error": "No PR found for current branch"}' >&2
  exit 1
fi

PR_NUMBER=$(jq -r '.number' <<<"$PR_JSON")
PR_URL=$(jq -r '.url' <<<"$PR_JSON")
OWNER=$(gh repo view --json owner -q '.owner.login')
REPO=$(gh repo view --json name -q '.name')
CURRENT_HEAD_SHA=$(git rev-parse HEAD)
CURRENT_HEAD_TS=$(git show -s --format=%cI HEAD 2>/dev/null || echo "")

to_epoch() {
  local ts="$1"
  if [[ -z "$ts" ]]; then echo ""; return; fi
  local epoch
  if epoch=$(date -u -d "$ts" +%s 2>/dev/null); then
    echo "$epoch"; return
  fi
  local stripped="${ts%.*}"
  local body="" off=""
  if [[ "$stripped" == *Z ]]; then
    body="${stripped%Z}"; off="+0000"
  elif [[ "$stripped" =~ ^(.*)([+-][0-9]{2}:[0-9]{2})$ ]]; then
    body="${BASH_REMATCH[1]}"
    off="${BASH_REMATCH[2]/:/}"
  else
    body="$stripped"; off="+0000"
  fi
  local utc_epoch
  utc_epoch=$(date -u -j -f "%Y-%m-%dT%H:%M:%S" "$body" +%s 2>/dev/null) || { echo ""; return; }
  local sign="${off:0:1}" hours="${off:1:2}" mins="${off:3:2}"
  local offset_secs=$(( (10#$hours * 3600) + (10#$mins * 60) ))
  if [[ "$sign" == "+" ]]; then
    echo $(( utc_epoch - offset_secs ))
  else
    echo $(( utc_epoch + offset_secs ))
  fi
}

CURRENT_HEAD_EPOCH=$(to_epoch "$CURRENT_HEAD_TS")
NOW_EPOCH=$(date -u +%s)
if [[ -n "$CURRENT_HEAD_EPOCH" ]]; then
  HEAD_AGE_MIN=$(( (NOW_EPOCH - CURRENT_HEAD_EPOCH) / 60 ))
else
  HEAD_AGE_MIN=0
fi

BOT_REGEX='bot$|\[bot\]|bugbot|greptile|coderabbit|codecov|snyk|sonar|graphite|dependabot'

if [[ "$MODE" == "summary" ]]; then
  # GraphQL variables ($owner, $repo, $number) are interpolated server-side, not by the shell.
  # shellcheck disable=SC2016
  QUERY='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes {
              createdAt
              author { login __typename }
            }
          }
        }
      }
      reviews(first: 100) {
        nodes {
          id
          createdAt
          commit { oid }
          author { login __typename }
        }
      }
    }
  }
}
'
else
  # GraphQL variables ($owner, $repo, $number) are interpolated server-side, not by the shell.
  # shellcheck disable=SC2016
  QUERY='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: 50) {
            nodes {
              id
              body
              createdAt
              author { login __typename }
            }
          }
        }
      }
      reviews(first: 100) {
        nodes {
          id
          state
          body
          createdAt
          commit { oid }
          author { login __typename }
        }
      }
    }
  }
}
'
fi

GQL=$(gh api graphql \
  -f query="$QUERY" \
  -f owner="$OWNER" -f repo="$REPO" -F number="$PR_NUMBER")

if [[ "$MODE" == "summary" ]]; then
  UNRESOLVED=$(jq --arg re "$BOT_REGEX" '
    .data.repository.pullRequest.reviewThreads.nodes
    | map(select(.isResolved == false))
    | map({
        id: .id,
        author: (.comments.nodes[0].author.login // "unknown"),
        isBot: (
          (.comments.nodes[0].author.__typename == "Bot")
          or ((.comments.nodes[0].author.login // "") | test($re; "i"))
        ),
        createdAt: (.comments.nodes[0].createdAt // "")
      })
  ' <<<"$GQL")

  BOT_REVIEWS=$(jq --arg re "$BOT_REGEX" '
    .data.repository.pullRequest.reviews.nodes
    | map(select(
        (.author.__typename == "Bot")
        or ((.author.login // "") | test($re; "i"))
      ))
    | map({
        id: .id,
        author: (.author.login // "unknown"),
        createdAt: .createdAt,
        reviewedCommitSha: (.commit.oid // "")
      })
  ' <<<"$GQL")

  ISSUE_COMMENTS=$(gh api --paginate "repos/$OWNER/$REPO/issues/$PR_NUMBER/comments" 2>/dev/null \
    | jq -s --arg re "$BOT_REGEX" 'add | [.[] | select(.user.type == "Bot" or ((.user.login // "") | test($re; "i"))) | {id: .id, author: .user.login, createdAt: .created_at}]' \
    2>/dev/null || echo '[]')
else
  UNRESOLVED=$(jq --arg re "$BOT_REGEX" '
    .data.repository.pullRequest.reviewThreads.nodes
    | map(select(.isResolved == false))
    | map({
        id: .id,
        path: .path,
        line: (.line // .originalLine),
        isOutdated: .isOutdated,
        author: (.comments.nodes[0].author.login // "unknown"),
        isBot: (
          (.comments.nodes[0].author.__typename == "Bot")
          or ((.comments.nodes[0].author.login // "") | test($re; "i"))
        ),
        body: (.comments.nodes[0].body // ""),
        commentCount: (.comments.nodes | length),
        createdAt: (.comments.nodes[0].createdAt // "")
      })
  ' <<<"$GQL")

  BOT_REVIEWS=$(jq --arg re "$BOT_REGEX" '
    .data.repository.pullRequest.reviews.nodes
    | map(select(
        (.author.__typename == "Bot")
        or ((.author.login // "") | test($re; "i"))
      ))
    | map({
        id: .id,
        author: (.author.login // "unknown"),
        state: .state,
        body: .body,
        createdAt: .createdAt,
        reviewedCommitSha: (.commit.oid // "")
      })
  ' <<<"$GQL")

  ISSUE_COMMENTS=$(gh api --paginate "repos/$OWNER/$REPO/issues/$PR_NUMBER/comments" 2>/dev/null \
    | jq -s --arg re "$BOT_REGEX" 'add | [.[] | select(.user.type == "Bot" or ((.user.login // "") | test($re; "i"))) | {id: .id, author: .user.login, body: .body, createdAt: .created_at}]' \
    2>/dev/null || echo '[]')
fi

# latest_thread_ts is computed over ALL review threads (resolved + unresolved)
# so it is monotonically non-decreasing as threads get resolved. Otherwise
# resolving a thread could drop the max timestamp backward and fool the
# settle loop into thinking state changed.
LATEST_THREAD_TS=$(jq -r '
  .data.repository.pullRequest.reviewThreads.nodes
  | map(.comments.nodes[0].createdAt // "")
  | map(select(. != ""))
  | max // ""
' <<<"$GQL")

FULL=$(jq -n \
  --arg number "$PR_NUMBER" \
  --arg url "$PR_URL" \
  --arg currentHeadSha "$CURRENT_HEAD_SHA" \
  --arg currentHeadTs "$CURRENT_HEAD_TS" \
  --argjson headAgeMin "$HEAD_AGE_MIN" \
  --argjson timeoutMin "$BUGBOT_TIMEOUT_MIN" \
  --arg latestThreadTs "$LATEST_THREAD_TS" \
  --argjson unresolved "$UNRESOLVED" \
  --argjson botReviews "$BOT_REVIEWS" \
  --argjson issueComments "$ISSUE_COMMENTS" '
  ($unresolved | map(select((.isBot == true) and ((.author // "") | test("cursor|bugbot"; "i")))) | length) as $bugbotUnresolved
  | (($botReviews | sort_by(.createdAt) | last | .reviewedCommitSha) // "") as $latestReviewSha
  | (($latestReviewSha == $currentHeadSha) and (($botReviews | length) > 0)) as $latestReviewMatchesHead
  | (
      if $bugbotUnresolved > 0 then "BLOCKING"
      elif $latestReviewMatchesHead then "CLEAN"
      elif $headAgeMin >= $timeoutMin then "CLEAN"
      else "PENDING"
      end
    ) as $bugbotState
  | {
    pr: {number: ($number | tonumber), url: $url},
    unresolved_threads: $unresolved,
    bot_reviews: $botReviews,
    bot_issue_comments: $issueComments,
    summary: {
      unresolved_count: ($unresolved | length),
      bugbot_unresolved_count: $bugbotUnresolved,
      bot_review_count: ($botReviews | length),
      bot_issue_comment_count: ($issueComments | length),
      latest_thread_ts: $latestThreadTs,
      latest_review_ts: ($botReviews | map(.createdAt) | max // ""),
      latest_issue_comment_ts: ($issueComments | map(.createdAt) | max // ""),
      latest_review_commit_sha: $latestReviewSha,
      current_head_sha: $currentHeadSha,
      current_head_ts: $currentHeadTs,
      head_age_min: $headAgeMin,
      bugbot_timeout_min: $timeoutMin,
      bugbot_state: $bugbotState,
      latest_review_matches_head: $latestReviewMatchesHead
    }
  }')

if [[ "$MODE" == "summary" ]]; then
  jq '{pr, summary}' <<<"$FULL"
else
  jq '.' <<<"$FULL"
fi
