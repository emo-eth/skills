#!/usr/bin/env python3
"""Validate and normalize a context-reflector JSON result."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, NoReturn

DECISIONS = {"continue", "steer", "block"}
CONFIDENCES = {"high", "medium", "low"}
MAX_EVIDENCE = 5
MAX_PROMPT_CHARS = 1200
MAX_ITEM_CHARS = 600


def fail(message: str) -> "NoReturn":
    print(json.dumps({"valid": False, "error": message}, ensure_ascii=False))
    raise SystemExit(1)


def string_list(value: Any, field: str, *, required: bool = False) -> list[str]:
    if not isinstance(value, list):
        fail(f"{field} must be an array")
    if required and not value:
        fail(f"{field} must contain at least one item")
    if len(value) > MAX_EVIDENCE:
        fail(f"{field} must contain at most {MAX_EVIDENCE} items")
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            fail(f"{field}[{index}] must be a non-empty string")
        if len(item) > MAX_ITEM_CHARS:
            fail(f"{field}[{index}] is too long")
    return [item.strip() for item in value]


def load_input(path: str | None) -> Any:
    text = Path(path).read_text(encoding="utf-8") if path else sys.stdin.read()
    if not text.strip():
        fail("input is empty")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        fail(f"invalid JSON: {exc.msg} at line {exc.lineno} column {exc.colno}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", help="read the reflector result from a file instead of stdin")
    args = parser.parse_args()

    result = load_input(args.file)
    if not isinstance(result, dict):
        fail("result must be a JSON object")

    required = {"decision", "confidence", "steering_prompt", "evidence", "missing_context"}
    missing = sorted(required - result.keys())
    if missing:
        fail(f"missing required field(s): {', '.join(missing)}")

    decision = result["decision"]
    confidence = result["confidence"]
    extra = sorted(set(result) - required)
    if extra:
        fail(f"unexpected field(s): {', '.join(extra)}")
    if not isinstance(decision, str) or decision not in DECISIONS:
        fail(f"decision must be one of: {', '.join(sorted(DECISIONS))}")
    if not isinstance(confidence, str) or confidence not in CONFIDENCES:
        fail(f"confidence must be one of: {', '.join(sorted(CONFIDENCES))}")

    prompt = result["steering_prompt"]
    if prompt is not None and (not isinstance(prompt, str) or not prompt.strip()):
        fail("steering_prompt must be a non-empty string or null")
    if isinstance(prompt, str):
        prompt = prompt.strip()
        if len(prompt) > MAX_PROMPT_CHARS:
            fail(f"steering_prompt exceeds {MAX_PROMPT_CHARS} characters")
        if "\n\n" in prompt:
            fail("steering_prompt must be one compact paragraph")

    evidence = string_list(result["evidence"], "evidence", required=True)
    missing_context = string_list(result["missing_context"], "missing_context")

    if decision == "continue":
        if prompt is not None:
            fail("continue requires steering_prompt to be null")
        if missing_context:
            fail("continue requires missing_context to be empty")
    elif decision == "steer":
        if prompt is None:
            fail("steer requires a steering_prompt")
        if missing_context:
            fail("steer cannot also report missing_context; use block")
    else:  # block
        if prompt is not None:
            fail("block requires steering_prompt to be null")
        if not missing_context:
            fail("block requires at least one missing_context item")

    normalized = {
        "valid": True,
        "decision": decision,
        "confidence": confidence,
        "steering_prompt": prompt,
        "evidence": evidence,
        "missing_context": missing_context,
    }
    print(json.dumps(normalized, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
