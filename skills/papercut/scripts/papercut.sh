#!/usr/bin/env bash
set -euo pipefail

papercut_usage() {
  cat <<'EOF'
Usage: papercut -m <agent-or-model> [options] "what happened"

Append a small friction note to a user-global PAPERCUTS.md file.

The default output file is $PAPERCUTS_PATH, or ~/PAPERCUTS.md when
unset. The repository is never written to; --path only changes this
global output location.

Options:
  -m, --agent <name>   Agent/model name to record
      --model <name>   Alias for --agent
      --path <file>    Output file (overrides $PAPERCUTS_PATH / default)
      --repo <path>    Repository root override (metadata only, not output)
      --file <path>    Related file; repeatable
      --json           Print machine-readable receipt
      --dry-run        Build the receipt without writing anything
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
papercut_output_path=""
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
    --path)
      (($# >= 2)) || papercut_error "--path requires a value"
      [[ "$2" != -* ]] || papercut_error "--path requires a value"
      papercut_output_path="$2"
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

papercut_expand_tilde() {
  local papercut_value="$1"
  case "$papercut_value" in
    '~'|'~/'*) printf '%s/%s\n' "$HOME" "${papercut_value#\~/}" ;;
    *) printf '%s\n' "$papercut_value" ;;
  esac
}

papercut_absolute_path() {
  local papercut_value="$1"
  case "$papercut_value" in
    /*) printf '%s\n' "$papercut_value" ;;
    *) printf '%s/%s\n' "$papercut_cwd" "$papercut_value" ;;
  esac
}

# Resolve the global output file. --path wins, then $PAPERCUTS_PATH,
# then ~/PAPERCUTS.md. This is never inside the repository.
if [[ -n "$papercut_output_path" ]]; then
  papercut_output_path="$(papercut_expand_tilde "$papercut_output_path")"
  papercut_output_path="$(papercut_absolute_path "$papercut_output_path")"
else
  papercut_output_path="${PAPERCUTS_PATH:-$HOME/PAPERCUTS.md}"
  papercut_output_path="$(papercut_expand_tilde "$papercut_output_path")"
fi

# Physical worktree: the git top-level we are actually in, if any.
papercut_git_top=""
if git -C "$papercut_cwd" rev-parse --show-toplevel >/dev/null 2>&1; then
  papercut_git_top="$(git -C "$papercut_cwd" rev-parse --show-toplevel)"
  papercut_git_top="$(cd "$papercut_git_top" && pwd -P)"
fi

# Metadata repository root: --repo override, else the detected worktree,
# else the current directory. This only affects metadata, never output.
if [[ -n "$papercut_repo_override" ]]; then
  papercut_repo_root="$(papercut_expand_tilde "$papercut_repo_override")"
  papercut_repo_root="$(papercut_absolute_path "$papercut_repo_root")"
elif [[ -n "$papercut_git_top" ]]; then
  papercut_repo_root="$papercut_git_top"
else
  papercut_repo_root="$papercut_cwd"
fi

if [[ -d "$papercut_repo_root" ]]; then
  papercut_repo_root="$(cd "$papercut_repo_root" && pwd -P)"
fi
papercut_repo_name="$(basename "$papercut_repo_root")"

# Branch or detached commit, collected from the physical worktree when git.
papercut_branch=""
papercut_commit=""
papercut_detached=0
if [[ -n "$papercut_git_top" ]]; then
  papercut_branch="$(git -C "$papercut_cwd" symbolic-ref --short -q HEAD 2>/dev/null || true)"
  papercut_commit="$(git -C "$papercut_cwd" rev-parse --short HEAD 2>/dev/null || true)"
  if [[ -z "$papercut_branch" && -n "$papercut_commit" ]]; then
    papercut_detached=1
  fi
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
papercut_heading=$'# Papercuts\n\nSmall frictions agents hit while working. These are not full bug reports; they are sandpaper notes for later cleanup. Each entry records the repository identity, worktree, branch (or detached commit), cwd, agent, related files, and note.\n\n## Entries\n\n'

papercut_format_code() {
  local papercut_code_value="$1"
  papercut_code_value="${papercut_code_value//\`/\\\`}"
  printf '`%s`' "$papercut_code_value"
}

papercut_append_entry() {
  {
    printf -- '- **%s** %s\n' "$papercut_timestamp" "$(papercut_format_code "$papercut_agent")"
    printf '  - repo: %s root: %s\n' \
      "$(papercut_format_code "$papercut_repo_name")" \
      "$(papercut_format_code "$papercut_repo_root")"
    if [[ -n "$papercut_git_top" ]]; then
      printf '  - worktree: %s\n' "$(papercut_format_code "$papercut_git_top")"
      if ((papercut_detached == 1)); then
        printf '  - commit: %s (detached)\n' "$(papercut_format_code "$papercut_commit")"
      elif [[ -n "$papercut_branch" ]]; then
        printf '  - branch: %s' "$(papercut_format_code "$papercut_branch")"
        if [[ -n "$papercut_commit" ]]; then
          printf ' @ %s' "$(papercut_format_code "$papercut_commit")"
        fi
        printf '\n'
      fi
    fi
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
  } >> "$papercut_output_path"
}

if ((papercut_dry_run == 0)); then
  mkdir -p "$(dirname "$papercut_output_path")"

  if [[ ! -e "$papercut_output_path" ]]; then
    printf '%s' "$papercut_heading" > "$papercut_output_path"
  else
    papercut_existing="$(<"$papercut_output_path")"
    if [[ -z "$papercut_existing" ]]; then
      printf '%s' "$papercut_heading" > "$papercut_output_path"
    elif ! grep -Fq '## Entries' "$papercut_output_path"; then
      printf '\n\n## Entries\n\n' >> "$papercut_output_path"
    else
      papercut_last_byte="$(tail -c 1 "$papercut_output_path" | od -An -t x1 | tr -d ' \n')"
      [[ "$papercut_last_byte" == "0a" ]] || printf '\n' >> "$papercut_output_path"
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

# JSON null-or-string helper: emit the value if non-empty, else null.
papercut_json_nullable() {
  if [[ -n "$1" ]]; then
    printf '"%s"' "$(papercut_json_escape "$1")"
  else
    printf 'null'
  fi
}

if ((papercut_json == 1)); then
  printf '{\n'
  printf '  "schema": "springfield.papercut.v2",\n'
  printf '  "timestamp": "%s",\n' "$papercut_timestamp"
  printf '  "agent": "%s",\n' "$(papercut_json_escape "$papercut_agent")"
  printf '  "repoRoot": "%s",\n' "$(papercut_json_escape "$papercut_repo_root")"
  printf '  "repoName": "%s",\n' "$(papercut_json_escape "$papercut_repo_name")"
  if [[ -n "$papercut_git_top" ]]; then
    printf '  "worktree": "%s",\n' "$(papercut_json_escape "$papercut_git_top")"
  else
    printf '  "worktree": null,\n'
  fi
  printf '  "branch": %s,\n' "$(papercut_json_nullable "$papercut_branch")"
  printf '  "commit": %s,\n' "$(papercut_json_nullable "$papercut_commit")"
  printf '  "detached": %s,\n' "$((papercut_detached))"
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
  printf '  "papercutsPath": "%s",\n' "$(papercut_json_escape "$papercut_output_path")"
  if ((papercut_dry_run == 1)); then
    printf '  "written": false\n'
  else
    printf '  "written": true\n'
  fi
  printf '}\n'
else
  if ((papercut_dry_run == 1)); then
    printf 'dry-run: %s\n' "$papercut_output_path"
  else
    printf 'logged: %s\n' "$papercut_output_path"
  fi
fi