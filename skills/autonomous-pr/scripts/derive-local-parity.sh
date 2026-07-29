#!/usr/bin/env bash
# Infer the nearest local parity command(s) for a failing PR check.
#
# Example:
#   derive-local-parity.sh "preview-nm-usdh-account"

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <check-name>" >&2
  exit 1
fi

CHECK_NAME="$*"
REPO_ROOT=$(git rev-parse --show-toplevel)

normalize() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/ /g; s/^ +//; s/ +$//; s/ +/ /g'
}

contains_target() {
  local haystack="$1"
  local needle="$2"
  [[ -n "$needle" && "$haystack" == *"$needle"* ]]
}

infer_kind() {
  local normalized_check="$1"
  if contains_target "$normalized_check" "lint"; then
    echo "lint"
  elif contains_target "$normalized_check" "typecheck" || contains_target "$normalized_check" "type check" || contains_target "$normalized_check" "tsc"; then
    echo "typecheck"
  elif contains_target "$normalized_check" "generate" || contains_target "$normalized_check" "codegen"; then
    echo "generate"
  elif contains_target "$normalized_check" "test" || contains_target "$normalized_check" "jest" || contains_target "$normalized_check" "playwright"; then
    echo "test"
  elif contains_target "$normalized_check" "preview" || contains_target "$normalized_check" "build" || contains_target "$normalized_check" "deploy" || contains_target "$normalized_check" "docker" || contains_target "$normalized_check" "image"; then
    echo "build"
  else
    echo "unknown"
  fi
}

CHECK_NORMALIZED=$(normalize "$CHECK_NAME")
KIND=$(infer_kind "$CHECK_NORMALIZED")

BEST_PACKAGE=""
BEST_PACKAGE_REL=""
BEST_SCORE=0
BEST_REASON=""
BEST_IMG_NAME=""

while IFS= read -r pkg_dir; do
  [[ -d "$pkg_dir" ]] || continue

  pkg_rel=${pkg_dir#"$REPO_ROOT"/}
  pkg_name=$(basename "$pkg_dir")
  pkg_normalized=$(normalize "$pkg_name")
  pkg_rel_normalized=$(normalize "${pkg_rel#packages/}")
  score=0
  reason=""
  img_name=""

  score_match() {
    local base="$1"
    local alias="$2"
    echo $((base + ${#alias}))
  }

  if [[ -f "$pkg_dir/Makefile" ]]; then
    img_name=$(sed -nE 's/^IMG_NAME[[:space:]]*\?=[[:space:]]*(.+)$/\1/p' "$pkg_dir/Makefile" | head -n1 | tr -d '[:space:]')
  fi
  img_normalized=$(normalize "$img_name")
  img_short_normalized=$(normalize "${img_name#nm-}")

  if contains_target "$CHECK_NORMALIZED" "$pkg_normalized"; then
    score=$((score + $(score_match 100 "$pkg_normalized")))
    reason="matched package directory name"
  fi

  if contains_target "$CHECK_NORMALIZED" "$pkg_rel_normalized"; then
    score=$((score + $(score_match 130 "$pkg_rel_normalized")))
    reason="matched nested package path"
  fi

  if [[ -n "$img_normalized" ]] && contains_target "$CHECK_NORMALIZED" "$img_normalized"; then
    score=$((score + $(score_match 120 "$img_normalized")))
    reason="matched Makefile IMG_NAME"
  fi

  if [[ -n "$img_short_normalized" ]] && contains_target "$CHECK_NORMALIZED" "$img_short_normalized"; then
    score=$((score + $(score_match 110 "$img_short_normalized")))
    reason="matched IMG_NAME without nm- prefix"
  fi

  if [[ -f "$pkg_dir/cloudbuild.pr.yaml" ]] && contains_target "$CHECK_NORMALIZED" "preview"; then
    score=$((score + 5))
  fi

  if (( score > BEST_SCORE )); then
    BEST_SCORE=$score
    BEST_PACKAGE="$pkg_name"
    BEST_PACKAGE_REL="$pkg_rel"
    BEST_REASON="$reason"
    BEST_IMG_NAME="$img_name"
  fi
done < <(find "$REPO_ROOT/packages" -type f \( -name package.json -o -name Makefile -o -name cloudbuild.pr.yaml \) -print \
  | while IFS= read -r config_file; do dirname "$config_file"; done | sort -u)

if [[ -z "$BEST_PACKAGE" ]]; then
  jq -n \
    --arg check_name "$CHECK_NAME" \
    --arg kind "$KIND" \
    '{
      check_name: $check_name,
      inferred_kind: $kind,
      inferred_package: null,
      reasoning: [
        "Could not confidently map the check name to a package under packages/.",
        "Treat repo-wide preflight as baseline only and inspect the package config, CI config, or provider details directly."
      ],
      baseline_commands: ["make preflight"],
      targeted_commands: [],
      primary_command: null
    }'
  exit 0
fi

PKG_DIR="$REPO_ROOT/$BEST_PACKAGE_REL"
HAS_PACKAGE_JSON=false
HAS_MAKEFILE=false
HAS_CLOUDBUILD=false
PACKAGE_MANAGER="npm"

[[ -f "$PKG_DIR/package.json" ]] && HAS_PACKAGE_JSON=true
[[ -f "$PKG_DIR/Makefile" ]] && HAS_MAKEFILE=true
[[ -f "$PKG_DIR/cloudbuild.pr.yaml" ]] && HAS_CLOUDBUILD=true

if [[ -f "$REPO_ROOT/bun.lock" || -f "$PKG_DIR/bun.lock" ]]; then
  PACKAGE_MANAGER="bun"
elif [[ -f "$PKG_DIR/pnpm-lock.yaml" || -f "$REPO_ROOT/pnpm-lock.yaml" ]]; then
  PACKAGE_MANAGER="pnpm"
elif [[ -f "$PKG_DIR/yarn.lock" || -f "$REPO_ROOT/yarn.lock" ]]; then
  PACKAGE_MANAGER="yarn"
fi

pkg_json='{}'
if [[ "$HAS_PACKAGE_JSON" == true ]]; then
  pkg_json=$(cat "$PKG_DIR/package.json")
fi

run_script_command() {
  local script="$1"
  case "$PACKAGE_MANAGER" in
    bun) echo "cd $BEST_PACKAGE_REL && bun run $script" ;;
    pnpm) echo "cd $BEST_PACKAGE_REL && pnpm run $script" ;;
    yarn) echo "cd $BEST_PACKAGE_REL && yarn $script" ;;
    *) echo "cd $BEST_PACKAGE_REL && npm run $script" ;;
  esac
}

append_targeted_command() {
  local command="$1"
  local reason="$2"
  TARGETED_COMMANDS+=("$command")
  TARGETED_REASONS+=("$reason")
}

declare -a TARGETED_COMMANDS=()
declare -a TARGETED_REASONS=()
declare -a REASONING=()
declare -a BASELINE_COMMANDS=("make preflight")

REASONING+=("Use gh pr checks as the source of truth for blocking status before declaring CI green.")
REASONING+=("Repo-wide preflight is a baseline gate only; targeted package parity is required for failing scoped checks.")
REASONING+=("Mapped check to $BEST_PACKAGE_REL because it $BEST_REASON.")

script_exists() {
  local script="$1"
  [[ "$HAS_PACKAGE_JSON" == true ]] && jq -e --arg script "$script" '.scripts[$script] != null' <<<"$pkg_json" >/dev/null 2>&1
}

make_target_exists() {
  local target="$1"
  [[ "$HAS_MAKEFILE" == true ]] && grep -Eq "^${target}:" "$PKG_DIR/Makefile"
}

if [[ "$KIND" == "build" ]]; then
  if script_exists "build"; then
    append_targeted_command "$(run_script_command build)" "package.json exposes a production build script"
  fi
  if make_target_exists "build"; then
    append_targeted_command "make -C $BEST_PACKAGE_REL build" "Makefile exposes a build target"
  fi
  if [[ "$HAS_CLOUDBUILD" == true && -f "$PKG_DIR/Dockerfile" ]]; then
    append_targeted_command "cd $BEST_PACKAGE_REL && docker build --file ./Dockerfile ." "cloudbuild.pr.yaml runs a Docker image build for preview checks"
  fi
elif [[ "$KIND" == "lint" ]]; then
  if script_exists "lint"; then
    append_targeted_command "$(run_script_command lint)" "package.json exposes a lint script"
  fi
  if make_target_exists "lint"; then
    append_targeted_command "make -C $BEST_PACKAGE_REL lint" "Makefile exposes a lint target"
  fi
elif [[ "$KIND" == "typecheck" ]]; then
  if script_exists "typecheck"; then
    append_targeted_command "$(run_script_command typecheck)" "package.json exposes a typecheck script"
  fi
  if script_exists "check"; then
    append_targeted_command "$(run_script_command check)" "package.json exposes a check script often used for type validation"
  fi
  if make_target_exists "check"; then
    append_targeted_command "make -C $BEST_PACKAGE_REL check" "Makefile exposes a check target"
  fi
elif [[ "$KIND" == "test" ]]; then
  if contains_target "$CHECK_NORMALIZED" "playwright" && script_exists "test:e2e"; then
    append_targeted_command "$(run_script_command test:e2e)" "check name points at Playwright end-to-end tests"
  fi
  if script_exists "test"; then
    append_targeted_command "$(run_script_command test)" "package.json exposes a test script"
  fi
  if make_target_exists "test"; then
    append_targeted_command "make -C $BEST_PACKAGE_REL test" "Makefile exposes a test target"
  fi
elif [[ "$KIND" == "generate" ]]; then
  if script_exists "generate-types"; then
    append_targeted_command "$(run_script_command generate-types)" "package.json exposes a generate-types script"
  fi
  if script_exists "db:generate"; then
    append_targeted_command "$(run_script_command db:generate)" "package.json exposes a code generation script"
  fi
  if make_target_exists "gen-openapi"; then
    append_targeted_command "make -C $BEST_PACKAGE_REL gen-openapi" "Makefile exposes generation for OpenAPI output"
  fi
fi

if [[ ${#TARGETED_COMMANDS[@]} -eq 0 ]]; then
  if make_target_exists "build"; then
    append_targeted_command "make -C $BEST_PACKAGE_REL build" "fallback to package-local build target"
  elif script_exists "build"; then
    append_targeted_command "$(run_script_command build)" "fallback to package-local build script"
  elif make_target_exists "test"; then
    append_targeted_command "make -C $BEST_PACKAGE_REL test" "fallback to package-local test target"
  elif script_exists "test"; then
    append_targeted_command "$(run_script_command test)" "fallback to package-local test script"
  fi
fi

PRIMARY_COMMAND=""
if [[ ${#TARGETED_COMMANDS[@]} -gt 0 ]]; then
  PRIMARY_COMMAND="${TARGETED_COMMANDS[0]}"
fi

TARGETED_COMMANDS_JSON=$(printf '%s\n' "${TARGETED_COMMANDS[@]:-}" | jq -R . | jq -s 'map(select(length > 0))')
TARGETED_REASONS_JSON=$(printf '%s\n' "${TARGETED_REASONS[@]:-}" | jq -R . | jq -s 'map(select(length > 0))')
REASONING_JSON=$(printf '%s\n' "${REASONING[@]}" | jq -R . | jq -s '.')
BASELINE_JSON=$(printf '%s\n' "${BASELINE_COMMANDS[@]}" | jq -R . | jq -s '.')

jq -n \
  --arg check_name "$CHECK_NAME" \
  --arg kind "$KIND" \
  --arg package "$BEST_PACKAGE" \
  --arg package_dir "$BEST_PACKAGE_REL" \
  --arg img_name "$BEST_IMG_NAME" \
  --arg primary "$PRIMARY_COMMAND" \
  --argjson reasoning "$REASONING_JSON" \
  --argjson baseline "$BASELINE_JSON" \
  --argjson commands "$TARGETED_COMMANDS_JSON" \
  --argjson reasons "$TARGETED_REASONS_JSON" '
  {
    check_name: $check_name,
    inferred_kind: $kind,
    inferred_package: {
      name: $package,
      dir: $package_dir,
      image_name: (if ($img_name | length) > 0 then $img_name else null end)
    },
    reasoning: $reasoning,
    baseline_commands: $baseline,
    targeted_commands: [
      range(0; $commands | length) as $i
      | {
          command: $commands[$i],
          reason: ($reasons[$i] // "nearest package-local parity command")
        }
    ],
    primary_command: (if ($primary | length) > 0 then $primary else null end),
    notes: [
      "Run the targeted command even if make preflight fails first for an unrelated environment issue.",
      "If the targeted command passes but the PR check still fails, inspect the package cloudbuild file, Dockerfile, and provider logs for environment-specific differences."
    ]
  }'
