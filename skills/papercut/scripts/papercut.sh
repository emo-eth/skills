#!/usr/bin/env bash
set -euo pipefail

papercut_usage() {
  cat <<'EOF'
Usage: papercut -m <agent-or-model> [options] "what happened"

Append a small friction note to a user-global PAPERCUTS.jsonl file.

The default output file is $PAPERCUTS_PATH, or ~/PAPERCUTS.jsonl when
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
  papercut_output_path="${PAPERCUTS_PATH:-$HOME/PAPERCUTS.jsonl}"
  papercut_output_path="$(papercut_expand_tilde "$papercut_output_path")"
fi

if [[ "$papercut_output_path" == *.md ]]; then
  papercut_error "output path ends in .md: $papercut_output_path; Papercuts now uses JSONL. Run migration to convert to .jsonl or specify a .jsonl path."
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

papercut_id=""
if command -v uuidgen >/dev/null 2>&1; then
  papercut_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
fi

export PAPERCUT_RECORD_ID="$papercut_id"
export PAPERCUT_TIMESTAMP="$papercut_timestamp"
export PAPERCUT_AGENT="$papercut_agent"
export PAPERCUT_REPO_NAME="$papercut_repo_name"
export PAPERCUT_REPO_ROOT="$papercut_repo_root"
export PAPERCUT_WORKTREE="$papercut_git_top"
export PAPERCUT_BRANCH="$papercut_branch"
export PAPERCUT_COMMIT="$papercut_commit"
export PAPERCUT_DETACHED="$papercut_detached"
export PAPERCUT_CWD="$papercut_cwd_display"
export PAPERCUT_MESSAGE="$papercut_message"
export PAPERCUT_OUTPUT_PATH="$papercut_output_path"
export PAPERCUT_DRY_RUN="$papercut_dry_run"
export PAPERCUT_JSON="$papercut_json"

python3 - "${papercut_file_display[@]+"${papercut_file_display[@]}"}" << 'PYEOF'
import json
import os
import sys
from pathlib import Path
import uuid

agent = os.environ.get("PAPERCUT_AGENT", "unknown-agent")
repo_root = os.environ.get("PAPERCUT_REPO_ROOT") or None
repo_name = os.environ.get("PAPERCUT_REPO_NAME") or None
worktree = os.environ.get("PAPERCUT_WORKTREE") or None
branch = os.environ.get("PAPERCUT_BRANCH") or None
commit = os.environ.get("PAPERCUT_COMMIT") or None
detached = int(os.environ.get("PAPERCUT_DETACHED", "0"))
cwd = os.environ.get("PAPERCUT_CWD", ".")
message = os.environ.get("PAPERCUT_MESSAGE", "")
output_path_str = os.environ.get("PAPERCUT_OUTPUT_PATH", "")
dry_run = os.environ.get("PAPERCUT_DRY_RUN", "0") == "1"
json_receipt = os.environ.get("PAPERCUT_JSON", "0") == "1"
timestamp = os.environ.get("PAPERCUT_TIMESTAMP", "")
record_id = os.environ.get("PAPERCUT_RECORD_ID", "")
if not record_id:
    record_id = str(uuid.uuid4())

files = sys.argv[1:]

record = {
    "schema": "springfield.papercut.v3",
    "id": record_id,
    "timestamp": timestamp,
    "agent": agent,
    "repoName": repo_name,
    "repoRoot": repo_root,
    "worktree": worktree,
    "branch": branch,
    "commit": commit,
    "detached": detached,
    "cwd": cwd,
    "files": files,
    "message": message,
}

if not dry_run:
    p = Path(output_path_str)
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    record_bytes = (json.dumps(record, ensure_ascii=False) + "\n").encode("utf-8")
    fd = os.open(str(p), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        written = 0
        while written < len(record_bytes):
            n = os.write(fd, record_bytes[written:])
            if n == 0:
                raise OSError("write() returned 0 bytes")
            written += n
    finally:
        os.close(fd)

if json_receipt:
    receipt = {
        "schema": "springfield.papercut.v3",
        "id": record_id,
        "timestamp": timestamp,
        "agent": agent,
        "repoRoot": repo_root,
        "repoName": repo_name,
        "worktree": worktree,
        "branch": branch,
        "commit": commit,
        "detached": detached,
        "cwd": cwd,
        "files": files,
        "message": message,
        "papercutsPath": output_path_str,
        "written": not dry_run,
    }
    sys.stdout.write(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n")
else:
    status = "dry-run" if dry_run else "logged"
    sys.stdout.write(f"{status}: {output_path_str}\n")
PYEOF