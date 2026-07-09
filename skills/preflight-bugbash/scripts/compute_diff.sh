#!/bin/bash
# Compute full diff vs origin/dev (or fallback), including uncommitted work.
# Output: .context/preflight/changed_files.txt (one path per line)
#         .context/preflight/diff_summary.txt (stat + hunks)
#         .context/preflight/base_sha.txt (the base commit we diffed against)
set -euo pipefail

# macOS git + mktemp default to /var/folders/... for scratch. The Claude Bash
# sandbox blocks writes there, so `mktemp` fails with EPERM. Force TMPDIR to a
# sandbox-writable location even if the parent already set it.
# Outside the sandbox, /tmp/claude is equally valid — git still works with it.
export TMPDIR="/tmp/claude"
mkdir -p "$TMPDIR"

OUT_DIR="${PREFLIGHT_RUN_DIR:-.context/preflight}"
# Nuke any prior run's scratch — stale findings mislead the aggregator.
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Resolve base
BASE=""
for candidate in origin/dev origin/main dev main; do
  if git rev-parse --verify --quiet "$candidate" >/dev/null 2>&1; then
    BASE=$(git merge-base "$candidate" HEAD 2>/dev/null || true)
    if [ -n "$BASE" ]; then
      echo "Using base: $candidate ($BASE)" >&2
      break
    fi
  fi
done

if [ -z "$BASE" ]; then
  echo "ERROR: no base branch found (tried origin/dev, origin/main, dev, main)" >&2
  exit 1
fi

echo "$BASE" > "$OUT_DIR/base_sha.txt"

# Committed changes vs base — exclude deletions (subagents read files; deleted paths don't exist)
git diff --name-only --diff-filter=d "$BASE"...HEAD > "$OUT_DIR/_committed.txt"

# Uncommitted (staged + unstaged) vs HEAD — exclude deletions for same reason
git diff --name-only --diff-filter=d HEAD > "$OUT_DIR/_uncommitted.txt"
git diff --name-only --diff-filter=d --cached HEAD > "$OUT_DIR/_staged.txt"

# Union, sorted. Deletions already stripped above via --diff-filter=d.
cat "$OUT_DIR/_committed.txt" "$OUT_DIR/_uncommitted.txt" "$OUT_DIR/_staged.txt" \
  | sort -u > "$OUT_DIR/changed_files.txt"

rm -f "$OUT_DIR/_committed.txt" "$OUT_DIR/_uncommitted.txt" "$OUT_DIR/_staged.txt"

# Summary: diffstat + hunk headers
{
  echo "=== vs base ($BASE) ==="
  git diff --stat "$BASE"...HEAD
  echo
  echo "=== uncommitted ==="
  git diff --stat HEAD
  echo
  echo "=== hunk headers ==="
  git diff "$BASE"...HEAD | grep -E '^(diff --git|@@)' || true
  echo
  git diff HEAD | grep -E '^(diff --git|@@)' || true
} > "$OUT_DIR/diff_summary.txt"

N=$(wc -l < "$OUT_DIR/changed_files.txt" | tr -d ' ')
echo "Wrote $OUT_DIR/changed_files.txt ($N files), $OUT_DIR/diff_summary.txt" >&2

# Clear any stale skip/narrow flags from previous runs
rm -f "$OUT_DIR/skip_reason.txt" "$OUT_DIR/narrow_mode.txt"

# --- Comment-code divergence sweep -------------------------------------------
# Pre-compute every "intent comment" (filter/skip/ignore/validate/...) in the
# diff so subagents can't silently skip `reviewer_discipline.md` rule #1.
# Format: <path>:<line>:<comment-line>\n    -> <path>:<line+1..5>:<following code>
SWEEP="$OUT_DIR/comment_sweep.txt"
: > "$SWEEP"
PATTERN='filter|skip|ignore|exclude|validate|ensure|sanitize|dedupe|normalize|safe because'
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -f "$f" ] || continue
  case "$f" in
    *.sh|*.bash|*.zsh|*.py|*.rb|*.ts|*.tsx|*.js|*.jsx|*.go|*.tf|*.mjs|*.cjs|*.yml|*.yaml|Makefile|*.mk) ;;
    *) continue ;;
  esac
  # Grep comment lines (#, //) matching the pattern; emit the match plus next 5 lines of code.
  # NOTE: BSD awk (macOS default) has no IGNORECASE; match tolower($0) against a lowercase pattern.
  awk -v file="$f" -v pat="$PATTERN" '
    {
      low=tolower($0)
      if ($0 ~ /^[[:space:]]*(#|\/\/)/ && low ~ pat) {
        print file ":" NR ":COMMENT: " $0
        hit=NR
      }
      if (hit && NR > hit && NR <= hit+5) {
        print file ":" NR ":CODE:    " $0
      }
    }
  ' "$f" >> "$SWEEP" || true
done < "$OUT_DIR/changed_files.txt"
SWEEP_HITS=$(grep -c ":COMMENT:" "$SWEEP" 2>/dev/null || echo 0)
echo "Comment-sweep: $SWEEP_HITS intent comments found in diff (see $SWEEP)" >&2

# --- Skip detection -----------------------------------------------------------

# Revert PR: HEAD commit subject starts with "Revert " OR branch name starts revert/
HEAD_SUBJECT=$(git log -1 --pretty=%s 2>/dev/null || echo "")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "$HEAD_SUBJECT" == Revert\ \"* ]] || [[ "$BRANCH" == revert/* ]]; then
  echo "revert PR (subject=\"$HEAD_SUBJECT\", branch=$BRANCH)" > "$OUT_DIR/skip_reason.txt"
  echo "SKIP: $(cat "$OUT_DIR/skip_reason.txt")" >&2
  exit 0
fi

# Dep-only bump: every changed file is a lockfile / manifest
if [ "$N" -gt 0 ]; then
  NON_DEP=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
      package.json|package-lock.json|go.mod|go.sum|bun.lock|bun.lockb|pnpm-lock.yaml|yarn.lock|*/package.json|*/package-lock.json|*/go.mod|*/go.sum|*/bun.lock|*/bun.lockb|*/pnpm-lock.yaml|*/yarn.lock)
        ;;
      *) NON_DEP=1; break ;;
    esac
  done < "$OUT_DIR/changed_files.txt"
  if [ "$NON_DEP" -eq 0 ]; then
    echo "dep-only bump (all files are lockfiles/manifests)" > "$OUT_DIR/skip_reason.txt"
    echo "SKIP: $(cat "$OUT_DIR/skip_reason.txt")" >&2
    exit 0
  fi
fi

# Narrow mode: no code files in diff (only config/docs/infra)
# Code = .go / .ts / .tsx / .js / .jsx / .mjs / .cjs / .py / .rb / .svelte / .vue
# (keep this list in sync with references/lens_solo-reviewer.md)
HAS_CODE=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.go|*.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.py|*.rb|*.svelte|*.vue) HAS_CODE=1; break ;;
  esac
done < "$OUT_DIR/changed_files.txt"

if [ "$HAS_CODE" -eq 0 ] && [ "$N" -gt 0 ]; then
  echo "true" > "$OUT_DIR/narrow_mode.txt"
  echo "NARROW MODE: no code files in diff — dispatch exactly one lens_solo-reviewer subagent (no domains, no other lenses); see SKILL.md" >&2
fi
