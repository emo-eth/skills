#!/usr/bin/env bash
set -euo pipefail

papercut_usage() {
  cat <<'EOF'
Usage: papercut -m <agent-or-model> [options] "what happened"

Append a small friction note to PAPERCUTS.md at the nearest Git repo root.

Options:
  -m, --agent <name>   Agent/model name to record
      --model <name>   Alias for --agent
      --repo <path>    Repository root override
      --file <path>    Related file; repeatable
      --json           Print machine-readable receipt
      --dry-run        Build the receipt without writing PAPERCUTS.md
  -h, --help           Show this help

Message can also be piped on stdin.
EOF
}

papercut_error() {
  printf '%s\n' "$1" >&2
  papercut_usage >&2
  exit 2
}

papercut_agent=""
papercut_repo_override=""
papercut_files=()
papercut_message_parts=()
papercut_json=0
papercut_dry_run=0

while (($# > 0)); do
  case "$1" in
    -h|--help)
      papercut_usage
      exit 0
      ;;
    -m|--agent|--model)
      (($# >= 2)) || papercut_error "$1 requires a value"
      [[ "$2" != -* ]] || papercut_error "$1 requires a value"
      papercut_agent="$2"
      shift 2
      ;;
    --repo)
      (($# >= 2)) || papercut_error "--repo requires a value"
      [[ "$2" != -* ]] || papercut_error "--repo requires a value"
      papercut_repo_override="$2"
      shift 2
      ;;
    --file)
      (($# >= 2)) || papercut_error "--file requires a value"
      [[ "$2" != -* ]] || papercut_error "--file requires a value"
      papercut_files+=("$2")
      shift 2
      ;;
    --json)
      papercut_json=1
      shift
      ;;
    --dry-run)
      papercut_dry_run=1
      shift
      ;;
    --)
      shift
      while (($# > 0)); do
        papercut_message_parts+=("$1")
        shift
      done
      ;;
    -*)
      papercut_error "unknown flag: $1"
      ;;
    *)
      papercut_message_parts+=("$1")
      shift
      ;;
  esac
done

papercut_cwd="$(pwd -P)"
papercut_agent="${papercut_agent:-${PAPERCUT_AGENT:-unknown-agent}}"

papercut_message=""
if ((${#papercut_message_parts[@]} > 0)); then
  for papercut_part in "${papercut_message_parts[@]}"; do
    if [[ -n "$papercut_message" ]]; then
      papercut_message+=' '
    fi
    papercut_message+="$papercut_part"
  done
fi

if [[ ! -t 0 ]]; then
  papercut_stdin_first_line=""
  if IFS= read -r -t 1 papercut_stdin_first_line || [[ -n "$papercut_stdin_first_line" ]]; then
    papercut_stdin_message="$papercut_stdin_first_line"
    papercut_stdin_rest="$(cat)"
    [[ -n "$papercut_stdin_rest" ]] && papercut_stdin_message+=$'\n'"$papercut_stdin_rest"
    if [[ -n "$papercut_stdin_message" ]]; then
      [[ -n "$papercut_message" ]] && papercut_message+=$'\n'
      papercut_message+="$papercut_stdin_message"
    fi
  fi
fi

shopt -s extglob
papercut_message="${papercut_message//$'\r\n'/$'\n'}"
papercut_message="${papercut_message##+([[:space:]])}"
papercut_message="${papercut_message%%+([[:space:]])}"
[[ -n "$papercut_message" ]] || papercut_error "papercut message cannot be empty"

papercut_find_repo_root() {
  git -C "$1" rev-parse --show-toplevel 2>/dev/null || printf '%s\n' "$1"
}

papercut_absolute_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$papercut_cwd" "$1" ;;
  esac
}

if [[ -n "$papercut_repo_override" ]]; then
  papercut_repo_root="$(papercut_absolute_path "$papercut_repo_override")"
else
  papercut_repo_root="$(papercut_find_repo_root "$papercut_cwd")"
fi

if [[ -d "$papercut_repo_root" ]]; then
  papercut_repo_root="$(cd "$papercut_repo_root" && pwd -P)"
fi

papercut_relative_or_absolute() {
  local papercut_value="$1"
  local papercut_absolute

  if [[ "$papercut_value" == /* ]]; then
    papercut_absolute="$papercut_value"
  else
    papercut_absolute="$papercut_repo_root/$papercut_value"
  fi

  if [[ "$papercut_absolute" == "$papercut_repo_root" ]]; then
    printf '.\n'
  elif [[ "$papercut_absolute" == "$papercut_repo_root"/* ]]; then
    printf '%s\n' "${papercut_absolute#"$papercut_repo_root"/}"
  else
    printf '%s\n' "$papercut_absolute"
  fi
}

papercut_cwd_display="$(papercut_relative_or_absolute "$papercut_cwd")"
papercut_file_display=()
if ((${#papercut_files[@]} > 0)); then
  for papercut_file in "${papercut_files[@]}"; do
    papercut_file_display+=("$(papercut_relative_or_absolute "$papercut_file")")
  done
fi

papercut_timestamp="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
papercut_path="$papercut_repo_root/PAPERCUTS.md"
papercut_heading=$'# Papercuts\n\nSmall frictions agents hit while working in this repository. These are not full bug reports; they are sandpaper notes for later cleanup.\n\n## Entries\n\n'

papercut_format_code() {
  local papercut_code_value="$1"
  papercut_code_value="${papercut_code_value//\`/\\\`}"
  printf '`%s`' "$papercut_code_value"
}

papercut_append_entry() {
  {
    printf -- '- **%s** %s\n' "$papercut_timestamp" "$(papercut_format_code "$papercut_agent")"
    printf '  - cwd: %s\n' "$(papercut_format_code "$papercut_cwd_display")"

    if ((${#papercut_file_display[@]} > 0)); then
      printf '  - files: '
      for papercut_file_index in "${!papercut_file_display[@]}"; do
        ((papercut_file_index > 0)) && printf ', '
        papercut_format_code "${papercut_file_display[$papercut_file_index]}"
      done
      printf '\n'
    fi

    if [[ "$papercut_message" == *$'\n'* ]]; then
      papercut_message_line_number=0
      while IFS= read -r papercut_line || [[ -n "$papercut_line" ]]; do
        if ((papercut_message_line_number == 0)); then
          printf '  - note: %s\n' "$papercut_line"
        else
          printf '    %s\n' "$papercut_line"
        fi
        papercut_message_line_number=$((papercut_message_line_number + 1))
      done <<< "$papercut_message"
    else
      printf '  - note: %s\n' "$papercut_message"
    fi
  } >> "$papercut_path"
}

if ((papercut_dry_run == 0)); then
  mkdir -p "$papercut_repo_root"

  if [[ ! -e "$papercut_path" ]]; then
    printf '%s' "$papercut_heading" > "$papercut_path"
  else
    papercut_existing="$(<"$papercut_path")"
    if [[ -z "$papercut_existing" ]]; then
      printf '%s' "$papercut_heading" > "$papercut_path"
    elif ! grep -Fq '## Entries' "$papercut_path"; then
      printf '\n\n## Entries\n\n' >> "$papercut_path"
    else
      papercut_last_byte="$(tail -c 1 "$papercut_path" | od -An -t x1 | tr -d ' \n')"
      [[ "$papercut_last_byte" == "0a" ]] || printf '\n' >> "$papercut_path"
    fi
  fi

  papercut_append_entry
fi

papercut_json_escape() {
  local papercut_json_value="$1"
  papercut_json_value="${papercut_json_value//\\/\\\\}"
  papercut_json_value="${papercut_json_value//\"/\\\"}"
  papercut_json_value="${papercut_json_value//$'\n'/\\n}"
  papercut_json_value="${papercut_json_value//$'\r'/\\r}"
  papercut_json_value="${papercut_json_value//$'\t'/\\t}"
  printf '%s' "$papercut_json_value"
}

if ((papercut_json == 1)); then
  printf '{\n'
  printf '  "schema": "springfield.papercut.v1",\n'
  printf '  "repoRoot": "%s",\n' "$(papercut_json_escape "$papercut_repo_root")"
  printf '  "papercutsPath": "%s",\n' "$(papercut_json_escape "$papercut_path")"
  printf '  "timestamp": "%s",\n' "$papercut_timestamp"
  printf '  "agent": "%s",\n' "$(papercut_json_escape "$papercut_agent")"
  printf '  "cwd": "%s",\n' "$(papercut_json_escape "$papercut_cwd_display")"
  printf '  "files": ['
  if ((${#papercut_file_display[@]} > 0)); then
    for papercut_file_index in "${!papercut_file_display[@]}"; do
      ((papercut_file_index > 0)) && printf ', '
      printf '"%s"' "$(papercut_json_escape "${papercut_file_display[$papercut_file_index]}")"
    done
  fi
  printf '],\n'
  printf '  "message": "%s",\n' "$(papercut_json_escape "$papercut_message")"
  if ((papercut_dry_run == 1)); then
    printf '  "written": false\n'
  else
    printf '  "written": true\n'
  fi
  printf '}\n'
else
  if ((papercut_dry_run == 1)); then
    printf 'dry-run: %s\n' "$papercut_path"
  else
    printf 'logged: %s\n' "$papercut_path"
  fi
fi
