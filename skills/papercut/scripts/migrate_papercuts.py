#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path
import shutil
import sys

script_dir = Path(__file__).resolve().parent
if str(script_dir) not in sys.path:
    sys.path.insert(0, str(script_dir))

from papercut_records import (
    NAMESPACE_PAPERCUTS,
    append_records_safely,
    load_jsonl_strict,
    locked_log,
    parse_markdown_entries,
)

def migrate_files(input_paths, output_path: Path, backup: bool = True, dry_run: bool = False):
    output_path = output_path.expanduser().resolve()

    with locked_log(output_path):
        # STAGE 1: Parse and validate all inputs completely in memory
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

        # STAGE 2: Load and validate output file strictly before modifying anything
        existing_by_id, _ = load_jsonl_strict(output_path)

        # STAGE 3: Check for conflicts
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

        # STAGE 4: Write only after all validation succeeds
        if not dry_run and to_append:
            append_records_safely(output_path, to_append, mode=0o600)

        if not dry_run and backup:
            for p in input_paths:
                p = Path(p).expanduser().resolve()
                if p.exists() and p != output_path:
                    bak = p.with_suffix(p.suffix + ".bak")
                    if not bak.exists():
                        shutil.copy2(p, bak)

        return len(all_new_records), len(to_append)

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
