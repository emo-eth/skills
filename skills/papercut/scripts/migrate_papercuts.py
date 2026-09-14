#!/usr/bin/env python3
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import sys
import uuid

NAMESPACE_PAPERCUTS = uuid.UUID("b18a2212-0545-42a8-a6d5-8664b3017cf7")

FIRST_LINE_RE = re.compile(r"^-\s+\*\*([^\*]+)\*\*\s+`([^`]+)`\s*$")
REPO_RE = re.compile(r"^\s*-\s+repo:\s+`([^`]+)`\s+root:\s+`([^`]+)`\s*$")
WORKTREE_RE = re.compile(r"^\s*-\s+worktree:\s+`([^`]+)`\s*$")
BRANCH_COMMIT_RE = re.compile(r"^\s*-\s+branch:\s+`([^`]+)`\s+@\s+`([^`]+)`\s*$")
BRANCH_ONLY_RE = re.compile(r"^\s*-\s+branch:\s+`([^`]+)`\s*$")
COMMIT_DETACHED_RE = re.compile(r"^\s*-\s+commit:\s+`([^`]+)`\s+\(detached\)\s*$")
CWD_RE = re.compile(r"^\s*-\s+cwd:\s+`([^`]+)`\s*$")
FILES_RE = re.compile(r"^\s*-\s+files:\s+(.+)$")
NOTE_START_RE = re.compile(r"^\s*-\s+note:\s*(.*)$")

KNOWN_PREAMBLE_PREFIXES = (
    "# Papercuts",
    "## Entries",
    "Small frictions agents hit",
)

def parse_markdown_entries(content: str, filename: str = "<input>"):
    lines = content.splitlines()
    entries = []
    current_entry = None
    idx = 0

    while idx < len(lines) and not lines[idx].startswith("- **"):
        stripped = lines[idx].strip()
        if stripped and not any(stripped.startswith(p) for p in KNOWN_PREAMBLE_PREFIXES):
            raise ValueError(f"Unrecognized preamble line in {filename}:{idx+1}: {stripped!r}")
        idx += 1

    for line_num, line in enumerate(lines[idx:], start=idx + 1):
        m_first = FIRST_LINE_RE.match(line)
        if m_first:
            if current_entry:
                entries.append(current_entry)
            current_entry = {
                "timestamp": m_first.group(1),
                "agent": m_first.group(2),
                "repoName": None,
                "repoRoot": None,
                "worktree": None,
                "branch": None,
                "commit": None,
                "detached": 0,
                "cwd": None,
                "files": [],
                "message": "",
                "_in_note": False,
                "_line": line_num,
            }
            continue

        if not current_entry:
            if line.strip():
                raise ValueError(f"Unexpected line {line_num} outside entry in {filename}: {line!r}")
            continue

        m_repo = REPO_RE.match(line)
        if m_repo:
            current_entry["repoName"] = m_repo.group(1)
            current_entry["repoRoot"] = m_repo.group(2)
            current_entry["_in_note"] = False
            continue

        m_worktree = WORKTREE_RE.match(line)
        if m_worktree:
            current_entry["worktree"] = m_worktree.group(1)
            current_entry["_in_note"] = False
            continue

        m_bc = BRANCH_COMMIT_RE.match(line)
        if m_bc:
            current_entry["branch"] = m_bc.group(1)
            current_entry["commit"] = m_bc.group(2)
            current_entry["detached"] = 0
            current_entry["_in_note"] = False
            continue

        m_bo = BRANCH_ONLY_RE.match(line)
        if m_bo:
            current_entry["branch"] = m_bo.group(1)
            current_entry["detached"] = 0
            current_entry["_in_note"] = False
            continue

        m_cd = COMMIT_DETACHED_RE.match(line)
        if m_cd:
            current_entry["commit"] = m_cd.group(1)
            current_entry["detached"] = 1
            current_entry["_in_note"] = False
            continue

        m_cwd = CWD_RE.match(line)
        if m_cwd:
            current_entry["cwd"] = m_cwd.group(1)
            current_entry["_in_note"] = False
            continue

        m_files = FILES_RE.match(line)
        if m_files:
            file_items = re.findall(r"`([^`]+)`", m_files.group(1))
            current_entry["files"] = file_items
            current_entry["_in_note"] = False
            continue

        m_note = NOTE_START_RE.match(line)
        if m_note:
            current_entry["message"] = m_note.group(1)
            current_entry["_in_note"] = True
            continue

        if current_entry.get("_in_note"):
            if line.startswith("    ") or line.startswith("\t"):
                continuation = line[4:] if line.startswith("    ") else line[1:]
                current_entry["message"] += "\n" + continuation
                continue

        if line.strip() == "":
            continue

        raise ValueError(f"Unrecognized line {line_num} in entry at {filename}: {line!r}")

    if current_entry:
        entries.append(current_entry)

    records = []
    for e in entries:
        sig_dict = {
            "timestamp": e["timestamp"],
            "agent": e["agent"],
            "repoName": e["repoName"],
            "repoRoot": e["repoRoot"],
            "worktree": e["worktree"],
            "branch": e["branch"],
            "commit": e["commit"],
            "detached": e["detached"],
            "cwd": e["cwd"],
            "files": sorted(e["files"]),
            "message": e["message"],
        }
        sig_bytes = json.dumps(sig_dict, sort_keys=True, separators=(",", ":")).encode("utf-8")
        entry_id = str(uuid.uuid5(NAMESPACE_PAPERCUTS, sig_bytes.decode("utf-8")))
        record = {
            "schema": "springfield.papercut.v3",
            "id": entry_id,
            "timestamp": e["timestamp"],
            "agent": e["agent"],
            "repoName": e["repoName"],
            "repoRoot": e["repoRoot"],
            "worktree": e["worktree"],
            "branch": e["branch"],
            "commit": e["commit"],
            "detached": e["detached"],
            "cwd": e["cwd"],
            "files": e["files"],
            "message": e["message"],
        }
        records.append(record)

    return records

def load_existing_jsonl(path: Path):
    if not path.exists():
        return {}, []
    records_by_id = {}
    ordered_ids = []
    content = path.read_text(encoding="utf-8")
    for line_num, line in enumerate(content.splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except Exception as err:
            raise ValueError(f"Invalid JSON at {path}:{line_num}: {err}") from err
        if not isinstance(record, dict) or "id" not in record or not isinstance(record["id"], str):
            raise ValueError(f"Record at {path}:{line_num} missing string 'id'")
        rec_id = record["id"]
        if rec_id in records_by_id:
            existing = records_by_id[rec_id]
            if json.dumps(existing, sort_keys=True) != json.dumps(record, sort_keys=True):
                raise ValueError(f"Conflicting duplicate ID {rec_id} within {path}")
        else:
            records_by_id[rec_id] = record
            ordered_ids.append(rec_id)
    return records_by_id, ordered_ids

def migrate_files(input_paths, output_path: Path, backup: bool = True, dry_run: bool = False):
    all_new_records = []
    seen_ids = set()

    for p in input_paths:
        p = Path(p).expanduser().resolve()
        if not p.exists():
            continue
        content = p.read_text(encoding="utf-8")
        file_records = parse_markdown_entries(content, filename=str(p))
        for r in file_records:
            rid = r["id"]
            if rid not in seen_ids:
                seen_ids.add(rid)
                all_new_records.append((p, r))
            else:
                for orig_p, existing in all_new_records:
                    if existing["id"] == rid:
                        if json.dumps(existing, sort_keys=True) != json.dumps(r, sort_keys=True):
                            raise ValueError(f"Conflicting records with ID {rid} between inputs {orig_p} and {p}")
                        break

    output_path = output_path.expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    lock_path = output_path.with_suffix(output_path.suffix + ".lock")
    with open(lock_path, "w", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            existing_by_id, _ = load_existing_jsonl(output_path)
            to_append = []
            for src_p, r in all_new_records:
                rid = r["id"]
                if rid in existing_by_id:
                    existing = existing_by_id[rid]
                    if json.dumps(existing, sort_keys=True) != json.dumps(r, sort_keys=True):
                        raise ValueError(
                            f"Conflicting record ID {rid}: payload in input {src_p} differs from existing record in {output_path}"
                        )
                else:
                    existing_by_id[rid] = r
                    to_append.append(r)

            if not dry_run and to_append:
                needs_newline = False
                if output_path.exists() and output_path.stat().st_size > 0:
                    with open(output_path, "rb") as f:
                        f.seek(-1, os.SEEK_END)
                        last_byte = f.read(1)
                        if last_byte != b"\n":
                            needs_newline = True

                with open(output_path, "a", encoding="utf-8") as f:
                    if needs_newline:
                        f.write("\n")
                    for r in to_append:
                        f.write(json.dumps(r, ensure_ascii=False) + "\n")

            if not dry_run and backup:
                for p in input_paths:
                    p = Path(p).expanduser().resolve()
                    if p.exists() and p != output_path:
                        bak = p.with_suffix(p.suffix + ".bak")
                        if not bak.exists():
                            shutil.copy2(p, bak)

            return len(all_new_records), len(to_append)
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            try:
                lock_path.unlink(missing_ok=True)
            except Exception:
                pass

def main():
    parser = argparse.ArgumentParser(description="Losslessly migrate PAPERCUTS.md entries to PAPERCUTS.jsonl")
    parser.add_argument("inputs", nargs="*", default=[], help="Input Markdown files (default: ~/PAPERCUTS.md)")
    parser.add_argument("--output", default=None, help="Output JSONL file (default: ~/PAPERCUTS.jsonl)")
    parser.add_argument("--no-backup", action="store_true", help="Do not create .bak backup of input files")
    parser.add_argument("--dry-run", action="store_true", help="Parse and check without writing files")
    args = parser.parse_args()

    inputs = args.inputs
    if not inputs:
        default_in = Path.home() / "PAPERCUTS.md"
        inputs = [str(default_in)]

    output = Path(args.output) if args.output else Path.home() / "PAPERCUTS.jsonl"

    try:
        total_parsed, appended = migrate_files(inputs, output, backup=not args.no_backup, dry_run=args.dry_run)
        mode = "dry-run: " if args.dry_run else ""
        print(f"{mode}Migrated {appended} new records from {len(inputs)} file(s) into {output} (total parsed: {total_parsed})")
    except Exception as err:
        print(f"Error during migration: {err}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
