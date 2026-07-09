#!/bin/bash
# Pull recent BugBot findings from native-markets/code and surface new patterns
# not yet covered in references/domain_*.md.
#
# Usage: scripts/refresh_patterns.sh [days]
#   days: lookback window, default 30
#
# Output: prints a human-actionable report to stdout.
# Side effect: updates .last_refresh if the run succeeds.
#
# This is a curation helper — it does NOT auto-edit domain files.
# Human decides which patterns to promote into the pattern library.
set -euo pipefail

DAYS="${1:-30}"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$SKILL_DIR/.refresh-cache"
mkdir -p "$OUT_DIR"

REPO="native-markets/code"
SINCE=$(date -u -v-"${DAYS}"d '+%Y-%m-%dT00:00:00Z' 2>/dev/null \
  || date -u -d "${DAYS} days ago" '+%Y-%m-%dT00:00:00Z')

echo "Refreshing bugbot patterns from $REPO (last $DAYS days, since $SINCE)" >&2

# Fetch PRs with bugbot comments. BugBot posts as a bot user; its review
# comments carry a distinctive body prefix. Pull merged PRs in the window.
gh api --paginate \
  "repos/$REPO/pulls?state=closed&sort=updated&direction=desc&per_page=100" \
  --jq ".[] | select(.merged_at != null and .merged_at >= \"$SINCE\") | {number, title, merged_at}" \
  > "$OUT_DIR/prs.jsonl" 2>/dev/null || {
    echo "ERROR: gh api failed — check auth (gh auth status) and repo access" >&2
    exit 1
  }

PR_COUNT=$(wc -l < "$OUT_DIR/prs.jsonl" | tr -d ' ')
echo "Found $PR_COUNT merged PRs in window" >&2

# For each PR, pull review comments where author is a bot and body looks like
# bugbot. Cursor BugBot comments typically include "BugBot" or "bugbot" string.
: > "$OUT_DIR/comments.jsonl"
while IFS= read -r line; do
  NUM=$(echo "$line" | jq -r '.number')
  gh api --paginate "repos/$REPO/pulls/$NUM/comments" --jq '
    .[] | select(
      (.user.type == "Bot") or
      (.body | test("BugBot|bugbot|Cursor"; "i"))
    ) | {pr: '"$NUM"', path: .path, line: .line, body: .body}
  ' >> "$OUT_DIR/comments.jsonl" 2>/dev/null || true
done < "$OUT_DIR/prs.jsonl"

COMMENT_COUNT=$(wc -l < "$OUT_DIR/comments.jsonl" | tr -d ' ')
echo "Collected $COMMENT_COUNT bugbot comments" >&2

# Successful fetch (even zero comments) counts as a refresh — update stamp before
# any early-exit so SKILL.md's >60-day staleness warning clears.
date -u '+%Y-%m-%d' > "$SKILL_DIR/.last_refresh"

if [ "$COMMENT_COUNT" -eq 0 ]; then
  echo "No bugbot comments found — pattern library unchanged (stamp updated)" >&2
  exit 0
fi

# Dump comments for human/LLM review. The skill agent reads this file and
# classifies new patterns against existing domain_*.md categories — anything
# that doesn't match an existing Check: bullet is a candidate new pattern.
cat <<EOF
=== BugBot pattern refresh ===
Window: last $DAYS days (since $SINCE)
PRs examined: $PR_COUNT
BugBot comments collected: $COMMENT_COUNT

Raw comments saved to: $OUT_DIR/comments.jsonl

Next step (for the skill agent or human):
  1. Read $OUT_DIR/comments.jsonl (one JSON comment per line).
  2. For each comment, decide which domain it belongs to by file path and body.
  3. Compare the body's root cause against existing Check: bullets in
     references/domain_<domain>.md — if the pattern appears 3+ times and is
     NOT covered, propose a new Check: bullet.
  4. Update the domain file and bump .last_refresh.

Heuristic cluster counts (rough — by path prefix):
EOF

jq -r '.path' "$OUT_DIR/comments.jsonl" \
  | awk -F/ '{print $1"/"$2}' \
  | sort | uniq -c | sort -rn | head -15

echo "" >&2
echo "Updated $SKILL_DIR/.last_refresh" >&2
