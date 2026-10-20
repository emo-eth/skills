#!/usr/bin/env bash
set -u

usage() {
  echo "Usage: bash scripts/verify.sh {doctor|full|shell-stop} PACKAGE_ROOT [EVIDENCE_DIR]" >&2
  exit 2
}

[[ $# -ge 2 && $# -le 3 ]] || usage
mode=$1
package_root=$(cd "$2" 2>/dev/null && pwd) || { echo "Package root does not exist: $2" >&2; exit 2; }
if [[ -n ${BUN_BIN:-} ]]; then
  bun_bin=$BUN_BIN
elif [[ -x /opt/homebrew/bin/bun ]]; then
  bun_bin=/opt/homebrew/bin/bun
else
  bun_bin=bun
fi
if command -v "$bun_bin" >/dev/null 2>&1; then
  bun_bin=$(command -v "$bun_bin")
  export PATH="$(dirname "$bun_bin"):$PATH"
fi

if [[ "$mode" == doctor ]]; then
  ready=1
  for path in \
    "$package_root/package.json" \
    "$package_root/bin/tardigrade-pi-rpc-node.cjs" \
    "$package_root/dist/tardigrade-pi.js" \
    "$package_root/dist/tardigrade-pi-rpc.js" \
    "$package_root/tests/fixtures/rpc-client-workflow.ts" \
    "$package_root/tests/fixtures/rpc-client-shell-stop.ts"; do
    if [[ -f "$path" ]]; then echo "present: $path"; else echo "missing: $path"; ready=0; fi
  done
  if ! command -v "$bun_bin" >/dev/null 2>&1; then
    echo "missing: Bun command ($bun_bin)"; ready=0
  else
    bun_version=$("$bun_bin" --version)
    echo "bun: $bun_version ($bun_bin)"
    if [[ "$bun_version" != 1.4.2 ]]; then echo "unsupported: expected Bun 1.4.2"; ready=0; fi
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "missing: Node command"; ready=0
  else
    echo "node: $(node --version) ($(command -v node))"
  fi
  if [[ -f "$package_root/package.json" ]]; then
    node -e 'const p=require(process.argv[1]); console.log(`package: ${p.name}@${p.version}`); if(p.name!=="tardigrade-pi") process.exit(1)' "$package_root/package.json" || ready=0
  fi
  if git -C "$package_root" rev-parse --show-toplevel >/dev/null 2>&1; then
    echo "git_head: $(git -C "$package_root" rev-parse HEAD)"
    if [[ -z $(git -C "$package_root" status --porcelain) ]]; then echo "git_dirty: no"; else echo "git_dirty: yes"; git -C "$package_root" status --short; fi
  else
    echo "git: unavailable"
  fi
  if [[ -d "$package_root/src" && -d "$package_root/bin" ]]; then
    stale=
    for output in tardigrade-pi.js tardigrade-pi-rpc.js pi-provider-worker.js read-worker.js; do
      if [[ ! -f "$package_root/dist/$output" ]]; then echo "missing: dist/$output"; ready=0; continue; fi
      newer=$(find "$package_root/src" "$package_root/bin" -type f \( -name '*.ts' -o -name '*.tsx' \) -newer "$package_root/dist/$output" -print -quit)
      [[ -z "$newer" ]] || stale="$output <- $newer"
    done
    if [[ -n "$stale" ]]; then echo "stale by timestamps: $stale"; ready=0; else echo "build: output files exist and source timestamps do not indicate staleness"; fi
  fi
  if [[ $ready -eq 1 ]]; then echo "ready"; exit 0; fi
  echo "not ready"; exit 1
fi

case "$mode" in full) fixture="$package_root/tests/fixtures/rpc-client-workflow.ts"; mode_arg=full ;;
  shell-stop) fixture="$package_root/tests/fixtures/rpc-client-shell-stop.ts"; mode_arg= ;;
  *) usage ;;
esac
if ! command -v "$bun_bin" >/dev/null 2>&1; then echo "Bun command not found: $bun_bin" >&2; exit 127; fi
if [[ ! -f "$fixture" ]]; then echo "Fixture not found: $fixture" >&2; exit 2; fi

evidence_base=${3:-${XDG_STATE_HOME:-$HOME/.local/state}/tardigrade-pi-verification}
mkdir -p "$evidence_base" || exit 1
run_id=$(date -u +%Y%m%dT%H%M%SZ)-$$
evidence_dir="$evidence_base/$run_id"
mkdir "$evidence_dir" || exit 1
if [[ "$mode" != doctor ]]; then
  BUN_BIN="$bun_bin" bash "$0" doctor "$package_root" > "$evidence_dir/doctor.txt" 2>&1
  doctor_result=$?
  if [[ $doctor_result -ne 0 ]]; then
    echo "doctor exit_code: $doctor_result" >> "$evidence_dir/doctor.txt"
    echo "evidence: $evidence_dir"
    cat "$evidence_dir/doctor.txt"
    exit "$doctor_result"
  fi
fi
if [[ "$mode" == full ]]; then
  command=("$bun_bin" --no-env-file "$fixture" "$package_root" "$mode_arg")
else
  command=("$bun_bin" --no-env-file "$fixture" "$package_root" "$evidence_dir")
fi
{
  echo "mode: $mode"
  echo "package_root: $package_root"
  echo "package_revision: $(git -C "$package_root" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "package_dirty: $(git -C "$package_root" status --short 2>/dev/null | wc -l | tr -d ' ')"
  echo "bun_version: $("$bun_bin" --version)"
  echo "node_version: $(node --version)"
  echo "started_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'command:'; printf ' %q' "${command[@]}"; printf '\n'
} > "$evidence_dir/run.txt"
{
  find "$package_root/src" "$package_root/bin" -type f \( -name '*.ts' -o -name '*.tsx' \) -print
  for path in "$package_root/package.json" "$package_root/dist/tardigrade-pi.js" "$package_root/dist/tardigrade-pi-rpc.js" "$package_root/dist/pi-provider-worker.js" "$package_root/dist/read-worker.js"; do
    [[ ! -f "$path" ]] || echo "$path"
  done
} | sort -u > "$evidence_dir/product-files.txt"
while IFS= read -r path; do shasum -a 256 "$path"; done < "$evidence_dir/product-files.txt" > "$evidence_dir/product-sha256.txt"
fixture_env=(env -i "HOME=$HOME" "PATH=$PATH" "TMPDIR=$evidence_dir" "LANG=${LANG:-C}" "TZ=UTC" \
  PI_OFFLINE=1 TAU_OFFLINE=1 "TAU_CONFIG_DIR=$evidence_dir/config" "PI_CODING_AGENT_DIR=$evidence_dir/agent")
"${fixture_env[@]}" "${command[@]}" > "$evidence_dir/stdout.txt" 2> "$evidence_dir/stderr.txt"
result=$?
echo "exit_code: $result" >> "$evidence_dir/run.txt"
echo "finished_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence_dir/run.txt"
if [[ "$mode" == full ]]; then
  fixture_root=$(node -e 'const lines=require("node:fs").readFileSync(process.argv[1],"utf8").trim().split("\n"); try { process.stdout.write(JSON.parse(lines.at(-1)).root || ""); } catch {}' "$evidence_dir/stdout.txt")
  if [[ -z "$fixture_root" ]]; then fixture_root=$(find "$evidence_dir" -maxdepth 1 -type d -name 'pi-root-rpc-client-*' -print -quit); fi
  if [[ -n "$fixture_root" ]]; then
    echo "fixture_root: $fixture_root (retained under evidence)" >> "$evidence_dir/run.txt"
    for artifact in proof.json failure.json requests.json effects.jsonl; do
      [[ ! -f "$fixture_root/$artifact" ]] || cp "$fixture_root/$artifact" "$evidence_dir/$artifact"
    done
    [[ ! -f "$fixture_root/stdout.txt" ]] || cp "$fixture_root/stdout.txt" "$evidence_dir/fixture-stdout.txt"
    [[ ! -f "$fixture_root/stderr.txt" ]] || cp "$fixture_root/stderr.txt" "$evidence_dir/fixture-stderr.txt"
  else
    echo "fixture_root: unavailable; stdout and stderr are retained" >> "$evidence_dir/run.txt"
  fi
fi
echo "evidence: $evidence_dir"
cat "$evidence_dir/run.txt"
echo "--- stdout ---"
cat "$evidence_dir/stdout.txt"
echo "--- stderr ---" >&2
cat "$evidence_dir/stderr.txt" >&2
exit "$result"
