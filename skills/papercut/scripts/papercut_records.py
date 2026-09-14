#!/usr/bin/env python3
from collections import Counter
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Tuple, Union
import uuid

NAMESPACE_PAPERCUTS = uuid.UUID("b18a2212-0545-42a8-a6d5-8664b3017cf7")

FIRST_LINE_RE = re.compile(r"^-\s+\*\*([^\*]+)\*\*\s+`([^`]+)`\s*$")
REPO_RE = re.compile(r"^ {2}-\s+repo:\s+`([^`]+)`\s+root:\s+`([^`]+)`\s*$")
WORKTREE_RE = re.compile(r"^ {2}-\s+worktree:\s+`([^`]+)`\s*$")
BRANCH_COMMIT_RE = re.compile(r"^ {2}-\s+branch:\s+`([^`]+)`\s+@\s+`([^`]+)`\s*$")
BRANCH_ONLY_RE = re.compile(r"^ {2}-\s+branch:\s+`([^`]+)`\s*$")
COMMIT_DETACHED_RE = re.compile(r"^ {2}-\s+commit:\s+`([^`]+)`\s+\(detached\)\s*$")
CWD_RE = re.compile(r"^ {2}-\s+cwd:\s+`([^`]+)`\s*$")
FILES_RE = re.compile(r"^ {2}-\s+files:\s+(.+)$")
NOTE_START_RE = re.compile(r"^ {2}-\s+note:\s*(.*)$")

KNOWN_PREAMBLE_PREFIXES = (
    "# Papercuts",
    "## Entries",
    "Small frictions agents hit",
)

def parse_markdown_entries(content: str, filename: str = "<input>") -> List[Dict[str, Any]]:
    # Newline-only splitting to avoid corrupting records
    lines = content.split("\n")
    if lines and lines[-1] == "":
        lines = lines[:-1]

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

        # When _in_note is active, indented continuation lines (4 spaces or tab) belong strictly to the note
        if current_entry.get("_in_note") and (line.startswith("    ") or line.startswith("\t")):
            continuation = line[4:] if line.startswith("    ") else line[1:]
            current_entry["message"] += "\n" + continuation
            continue

        # If we reach here, we are not in a note continuation
        current_entry["_in_note"] = False

        m_repo = REPO_RE.match(line)
        if m_repo:
            current_entry["repoName"] = m_repo.group(1)
            current_entry["repoRoot"] = m_repo.group(2)
            continue

        m_worktree = WORKTREE_RE.match(line)
        if m_worktree:
            current_entry["worktree"] = m_worktree.group(1)
            continue

        m_bc = BRANCH_COMMIT_RE.match(line)
        if m_bc:
            current_entry["branch"] = m_bc.group(1)
            current_entry["commit"] = m_bc.group(2)
            current_entry["detached"] = 0
            continue

        m_bo = BRANCH_ONLY_RE.match(line)
        if m_bo:
            current_entry["branch"] = m_bo.group(1)
            current_entry["detached"] = 0
            continue

        m_cd = COMMIT_DETACHED_RE.match(line)
        if m_cd:
            current_entry["commit"] = m_cd.group(1)
            current_entry["detached"] = 1
            continue

        m_cwd = CWD_RE.match(line)
        if m_cwd:
            current_entry["cwd"] = m_cwd.group(1)
            continue

        m_files = FILES_RE.match(line)
        if m_files:
            file_items = re.findall(r"`([^`]+)`", m_files.group(1))
            current_entry["files"] = file_items
            continue

        m_note = NOTE_START_RE.match(line)
        if m_note:
            current_entry["message"] = m_note.group(1)
            current_entry["_in_note"] = True
            continue

        if line.strip() == "":
            continue

        raise ValueError(f"Unrecognized line {line_num} in entry at {filename}: {line!r}")

    if current_entry:
        entries.append(current_entry)

    # Track occurrences for repeated identical entries to preserve multiplicity without ID collisions
    occurrence_counter = Counter()
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
            "files": e["files"],  # exact file order preserved
            "message": e["message"],
        }
        canonical_key = json.dumps(sig_dict, sort_keys=True, separators=(",", ":"))
        occ = occurrence_counter[canonical_key]
        occurrence_counter[canonical_key] += 1

        if occ > 0:
            sig_dict["_occurrence"] = occ
            sig_bytes = json.dumps(sig_dict, sort_keys=True, separators=(",", ":")).encode("utf-8")
        else:
            sig_bytes = canonical_key.encode("utf-8")

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
            "files": e["files"],  # exact file order preserved
            "message": e["message"],
        }
        records.append(record)

    return records

def load_jsonl_strict(path: Path) -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
    if not path.exists():
        return {}, []
    content_bytes = path.read_bytes()
    if not content_bytes:
        return {}, []
    if not content_bytes.endswith(b"\n"):
        raise ValueError(f"Malformed JSONL file {path}: does not end with newline (unterminated tail)")

    text = content_bytes.decode("utf-8")
    raw_lines = text.split("\n")
    if raw_lines[-1] != "":
        raise ValueError(f"Malformed JSONL file {path}: unterminated tail")
    lines = raw_lines[:-1]

    records_by_id = {}
    ordered_records = []
    for line_num, line in enumerate(lines, start=1):
        if not line.strip():
            raise ValueError(f"Malformed JSONL file {path}:{line_num}: empty or whitespace line")
        try:
            record = json.loads(line)
        except Exception as err:
            raise ValueError(f"Invalid JSON at {path}:{line_num}: {err}") from err
        if not isinstance(record, dict) or "id" not in record or not isinstance(record["id"], str) or not record["id"]:
            raise ValueError(f"Record at {path}:{line_num} missing valid string 'id'")
        rec_id = record["id"]
        if rec_id in records_by_id:
            existing = records_by_id[rec_id]
            if json.dumps(existing, sort_keys=True) != json.dumps(record, sort_keys=True):
                raise ValueError(f"Conflicting duplicate ID {rec_id} within {path}")
        else:
            records_by_id[rec_id] = record
            ordered_records.append(record)
    return records_by_id, ordered_records

def append_records_safely(path: Union[Path, str], records: List[Dict[str, Any]], mode: int = 0o600) -> None:
    if not records:
        return
    p = Path(path).expanduser().resolve()
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(str(p), os.O_APPEND | os.O_CREAT | os.O_WRONLY, mode)
    try:
        for r in records:
            encoded = (json.dumps(r, ensure_ascii=True, allow_nan=False) + "\n").encode("utf-8")
            n = os.write(fd, encoded)
            if n != len(encoded):
                raise OSError(f"Short write appending record to {p}: wrote {n} of {len(encoded)} bytes")
    finally:
        os.close(fd)

@contextmanager
def locked_log(path: Union[Path, str]):
    p = Path(path).expanduser().resolve()
    lock_path = p.with_suffix(p.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_fd = os.open(str(lock_path), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        yield lock_path
    finally:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
        finally:
            os.close(lock_fd)
