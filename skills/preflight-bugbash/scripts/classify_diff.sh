#!/bin/bash
# Classify changed files into domain buckets.
# Input: .context/preflight/changed_files.txt (from compute_diff.sh)
# Output: .context/preflight/domain_<tag>.txt (one file per domain) and
#         .context/preflight/domains_active.txt (list of active domain tags)
set -euo pipefail

# macOS git + mktemp default to /var/folders/... for scratch. The Claude Bash
# sandbox blocks writes there, so `mktemp` fails with EPERM. Force TMPDIR to a
# sandbox-writable location even if the parent already set it.
# Outside the sandbox, /tmp/claude is equally valid — git still works with it.
export TMPDIR="/tmp/claude"
mkdir -p "$TMPDIR"

OUT_DIR="${PREFLIGHT_RUN_DIR:-.context/preflight}"
IN="${1:-$OUT_DIR/changed_files.txt}"
mkdir -p "$OUT_DIR"

if [ ! -f "$IN" ]; then
  echo "ERROR: $IN not found. Run compute_diff.sh first." >&2
  exit 1
fi

# Clean prior
rm -f "$OUT_DIR"/domain_*.txt "$OUT_DIR/domains_active.txt"

: > "$OUT_DIR/domain_go.txt"
: > "$OUT_DIR/domain_typescript-next.txt"
: > "$OUT_DIR/domain_terraform.txt"
: > "$OUT_DIR/domain_database.txt"
: > "$OUT_DIR/domain_permissions-secrets.txt"
: > "$OUT_DIR/domain_money-currency.txt"
: > "$OUT_DIR/domain_feature-flags-geo.txt"
: > "$OUT_DIR/domain_analytics-observability.txt"
: > "$OUT_DIR/domain_idempotency-webhooks.txt"
: > "$OUT_DIR/domain_test-fixture-drift.txt"

BASE=$(cat "$OUT_DIR/base_sha.txt" 2>/dev/null || echo "origin/dev")

# Extension-based buckets
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.go) echo "$f" >> "$OUT_DIR/domain_go.txt" ;;
  esac
  case "$f" in
    *.ts|*.tsx|*.jsx|*.svelte) echo "$f" >> "$OUT_DIR/domain_typescript-next.txt" ;;
  esac
  case "$f" in
    *.tf|*.tfvars) echo "$f" >> "$OUT_DIR/domain_terraform.txt" ;;
  esac
  case "$f" in
    packages/deploy/*|*/terraform/*) echo "$f" >> "$OUT_DIR/domain_terraform.txt" ;;
  esac

  # Path-based Next.js + server boundaries
  case "$f" in
    packages/usdh/*|packages/usdh-account/*|packages/dashboard/*|packages/nativemarkets.com/*)
      echo "$f" >> "$OUT_DIR/domain_typescript-next.txt" ;;
  esac

  # DB paths — matches packages/db, query code, SQL, and migrations.
  # Do NOT add generic *_test.go here: it matches every Go test in the repo
  # and dispatches the DB subagent for unrelated diffs. DB tests under
  # packages/db/** are already covered by the packages/db/* glob above;
  # test files elsewhere belong to test-fixture-drift, not database.
  case "$f" in
    packages/db/*|*/queries/*.go|*.sql|*/migrations/*)
      echo "$f" >> "$OUT_DIR/domain_database.txt" ;;
  esac

  # Permissions/secrets: routes, middleware, deploy, env
  case "$f" in
    packages/api/internal/api/routes/*|*middleware*|*/auth/*|.env*|packages/deploy/*)
      echo "$f" >> "$OUT_DIR/domain_permissions-secrets.txt" ;;
  esac

  # Idempotency / webhooks: path-based
  case "$f" in
    *webhook*|*Webhook*)
      echo "$f" >> "$OUT_DIR/domain_idempotency-webhooks.txt" ;;
  esac

  # Test / fixture drift: path-based
  case "$f" in
    *_test.go|*.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|e2e/fixtures/*|*/__mocks__/*|.github/workflows/*|.pre-commit-scripts/*|scripts/ci-*)
      echo "$f" >> "$OUT_DIR/domain_test-fixture-drift.txt" ;;
  esac
done < "$IN"

# Content-based signals: grep the actual diff hunks for patterns.
# We look at the diff against BASE for added lines (^+, not metadata).
# BSD mktemp on macOS ignores $TMPDIR under the Claude Bash sandbox; pass an
# explicit template under /tmp/claude so mkstemp() targets a writable path.
DIFF_ALL=$(mktemp "$TMPDIR/classify-diff.XXXXXX")
git diff "$BASE"...HEAD > "$DIFF_ALL" 2>/dev/null || true
git diff HEAD >> "$DIFF_ALL" 2>/dev/null || true

if [ -s "$DIFF_ALL" ]; then
  # Money / currency
  if grep -qE '^\+.*(AmountToCents|CurrencyUSD|szDecimals|floatToWire|toFixed|ParseFloat|[Dd]ecimals|\?\? 0|\|\| 0|cents)' "$DIFF_ALL"; then
    # Which files? Extract the current diff --git target for each hunk that matched.
    awk '
      /^diff --git / { f=$4; sub("^b/","",f) }
      /^\+[^+]/ {
        if ($0 ~ /AmountToCents|CurrencyUSD|szDecimals|floatToWire|toFixed|ParseFloat|[Dd]ecimals|\?\? 0|\|\| 0|cents/) print f
      }
    ' "$DIFF_ALL" | sort -u >> "$OUT_DIR/domain_money-currency.txt"
  fi

  # Feature flags / geo
  awk '
    /^diff --git / { f=$4; sub("^b/","",f) }
    /^\+[^+]/ {
      if ($0 ~ /featureFlag|isFeatureEnabled|geo|eligibility|isEligible|allowedCountries|blockedCountries|GrowthBook|posthog.*feature/) print f
    }
  ' "$DIFF_ALL" | sort -u >> "$OUT_DIR/domain_feature-flags-geo.txt"

  # Analytics / observability
  awk '
    /^diff --git / { f=$4; sub("^b/","",f) }
    /^\+[^+]/ {
      if ($0 ~ /posthog\.capture|PostHog|Sentry|captureException|log\.(debug|info|warn|error)|super.*propert|registerSuper|setPersonProperties/) print f
    }
  ' "$DIFF_ALL" | sort -u >> "$OUT_DIR/domain_analytics-observability.txt"

  # Permissions/secrets content-based (literal secret/token/etc)
  awk '
    /^diff --git / { f=$4; sub("^b/","",f) }
    /^\+[^+]/ {
      if ($0 ~ /secret|SECRET|token|TOKEN|credential|organization_id|OR .*=|webhook|signature|HMAC|sha256|NEXT_PUBLIC_/) print f
    }
  ' "$DIFF_ALL" | sort -u >> "$OUT_DIR/domain_permissions-secrets.txt"

  # Permissions/secrets: new surfaces (exported identifiers, env reads, route files)
  # Cast a wide net; subagent applies judgment.
  awk '
    /^diff --git / { f=$4; sub("^b/","",f) }
    /^\+[^+]/ {
      # New exported Go identifier at package level
      if ($0 ~ /^\+(func|var|const|type) [A-Z]/) { print f; next }
      # New exported TS/JS identifier
      if ($0 ~ /^\+export (const|function|class|let|var|async function|default) /) { print f; next }
      # New env var read (Go or TS)
      if ($0 ~ /process\.env\.[A-Z_]+|os\.Getenv\(|os\.LookupEnv\(/) { print f; next }
    }
  ' "$DIFF_ALL" | sort -u >> "$OUT_DIR/domain_permissions-secrets.txt"

  # New route files by path (Next.js app router + Go handler dirs)
  while IFS= read -r f; do
    case "$f" in
      */app/api/*/route.ts|*/app/api/*/route.tsx|packages/api/internal/api/routes/*/handler.go|packages/api/internal/api/routes/*/*.go)
        echo "$f" >> "$OUT_DIR/domain_permissions-secrets.txt" ;;
    esac
  done < "$IN"

  # Database content-based (GORM etc.)
  awk '
    /^diff --git / { f=$4; sub("^b/","",f) }
    /^\+[^+]/ {
      if ($0 ~ /WithTx|Unscoped|GORM|\.Where\(|COALESCE|ON CONFLICT|Preload\(/) print f
    }
  ' "$DIFF_ALL" | sort -u >> "$OUT_DIR/domain_database.txt"

  # Idempotency / webhooks content-based
  awk '
    /^diff --git / { f=$4; sub("^b/","",f) }
    /^\+[^+]/ {
      if ($0 ~ /webhook|Webhook|WithTx|Transaction\(|HMAC|X-Signature|signature|idempoten|retryable|BeginTx/) print f
    }
  ' "$DIFF_ALL" | sort -u >> "$OUT_DIR/domain_idempotency-webhooks.txt"
fi

rm -f "$DIFF_ALL"

# Dedupe each bucket
for d in "$OUT_DIR"/domain_*.txt; do
  sort -u "$d" -o "$d"
done

# Emit active domains (non-empty buckets)
: > "$OUT_DIR/domains_active.txt"
for d in "$OUT_DIR"/domain_*.txt; do
  tag=$(basename "$d" .txt | sed 's/^domain_//')
  if [ -s "$d" ]; then
    echo "$tag" >> "$OUT_DIR/domains_active.txt"
  fi
done

# Report
echo "Active domains:" >&2
sed 's/^/  - /' "$OUT_DIR/domains_active.txt" >&2
