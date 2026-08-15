#!/usr/bin/env python3
"""Extract human/user messages from coding-agent session transcripts, across providers.

Emits one JSON object per user message to stdout (JSONL), followed by a `_meta` line:

    {"provider","file","session","ts","branch","cwd","text","truncated"}
    {"_meta":{"providers":{...},"files_scanned":N,"messages":M,"since":"...","parse_errors":N}}

The point is to surface *confusion signals* — the questions you asked, the corrections
you made, the things you needed clarified — cheaply, without loading whole transcripts.
So this only pulls the human side of each conversation, filters out harness-injected
text (system reminders, command wrappers, tool results, env context), and truncates
pasted blobs. The assistant's answers are deliberately not extracted: the model reading
this output reconstructs the correct understanding itself.

Providers scanned (whichever exist on this machine):
  - Claude Code  ~/.claude/projects/<encoded-cwd>/<session>.jsonl   (also covers Conductor)
  - Codex        ~/.codex/sessions/YYYY/MM/DD/*.jsonl  and  ~/.agents/sessions/...
  - Cursor       ~/.cursor/projects/<encoded-cwd>/agent-transcripts/<id>/<id>.jsonl

Hermes and other harnesses are not yet wired up. Add a scan_* function and register it
in PROVIDERS below when their transcript format is known.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HOME = Path.home()
MAX_TEXT = 2000  # truncate pasted logs/blobs; confusion lives in the phrasing, not the blob

# Prefixes that mark harness-injected or non-human text — never a real question the user typed.
NOISE_PREFIXES = (
    "<system-reminder>", "<system_instruction>", "<command-name>", "<command-message>",
    "<local-command-stdout>", "<local-command-stderr>", "<user-prompt-submit-hook>",
    "<environment_context>", "<user_instructions>", "<environment_details>",
    "Caveat:", "[Request interrupted", "[Request cancelled", "This session is being continued",
    "<bash-input>", "<bash-stdout>", "<bash-stderr>",
)


def parse_ts(s):
    if not s or not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def file_mtime(path):
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)


def is_noise(text):
    t = (text or "").lstrip()
    if not t.strip():
        return True
    return t.startswith(NOISE_PREFIXES)


def clip(text):
    text = text.strip()
    if len(text) > MAX_TEXT:
        return text[:MAX_TEXT], True
    return text, False


def blocks_to_text(content):
    """Claude Code / Cursor content -> human text, or None if this turn is a tool result."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for b in content:
            if not isinstance(b, dict):
                continue
            bt = b.get("type")
            if bt == "tool_result":
                return None  # a tool-result turn is not a human message
            if bt == "text" and isinstance(b.get("text"), str):
                parts.append(b["text"])
            elif bt == "input_text" and isinstance(b.get("text"), str):
                parts.append(b["text"])
        return "\n".join(parts) if parts else None
    return None


def iter_lines(path):
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            yield line


class Stats:
    def __init__(self):
        self.files = 0
        self.messages = 0
        self.parse_errors = 0
        self.by_provider = {}

    def bump(self, provider):
        self.by_provider[provider] = self.by_provider.get(provider, 0) + 1
        self.messages += 1


def scan_claude(since, cwd_contains, stats, emit):
    base = HOME / ".claude" / "projects"
    if not base.is_dir():
        return
    for path in base.glob("*/*.jsonl"):
        try:
            if file_mtime(path) < since:
                continue
        except OSError:
            continue
        stats.files += 1
        branch = cwd = None
        session = path.stem
        for line in iter_lines(path):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                stats.parse_errors += 1
                continue
            cwd = obj.get("cwd", cwd)
            branch = obj.get("gitBranch", branch)
            if obj.get("type") != "user" or obj.get("isMeta"):
                continue
            msg = obj.get("message", {})
            if not isinstance(msg, dict) or msg.get("role") != "user":
                continue
            text = blocks_to_text(msg.get("content"))
            if text is None or is_noise(text):
                continue
            ts = parse_ts(obj.get("timestamp"))
            if ts and ts < since:
                continue
            if cwd_contains and cwd_contains not in (cwd or ""):
                continue
            body, trunc = clip(text)
            emit({"provider": "claude-code", "file": str(path), "session": session,
                  "ts": obj.get("timestamp"), "branch": branch, "cwd": cwd,
                  "text": body, "truncated": trunc})
            stats.bump("claude-code")


def scan_codex(since, cwd_contains, stats, emit):
    for root in (HOME / ".codex" / "sessions", HOME / ".agents" / "sessions"):
        if not root.is_dir():
            continue
        for path in root.glob("*/*/*/*.jsonl"):
            try:
                if file_mtime(path) < since:
                    continue
            except OSError:
                continue
            stats.files += 1
            cwd = None
            session = path.stem
            for line in iter_lines(path):
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    stats.parse_errors += 1
                    continue
                payload = obj.get("payload", {})
                if not isinstance(payload, dict):
                    continue
                if obj.get("type") == "session_meta":
                    cwd = payload.get("cwd", cwd)
                    session = payload.get("id", session)
                    continue
                # Use event_msg/user_message as the canonical human turn (avoids the
                # duplicate response_item echo that Codex writes alongside it).
                if obj.get("type") == "event_msg" and payload.get("type") == "user_message":
                    text = payload.get("message")
                else:
                    continue
                if not isinstance(text, str) or is_noise(text):
                    continue
                ts = parse_ts(obj.get("timestamp"))
                if ts and ts < since:
                    continue
                if cwd_contains and cwd_contains not in (cwd or ""):
                    continue
                body, trunc = clip(text)
                emit({"provider": "codex", "file": str(path), "session": session,
                      "ts": obj.get("timestamp"), "branch": None, "cwd": cwd,
                      "text": body, "truncated": trunc})
                stats.bump("codex")


def _decode_cwd(dirname):
    # Cursor/Claude encode cwd by replacing "/" with "-". Lossy for paths containing "-",
    # but good enough to group by project. Report a leading slash for readability.
    return "/" + dirname.strip("-").replace("-", "/")


def scan_cursor(since, cwd_contains, stats, emit):
    base = HOME / ".cursor" / "projects"
    if not base.is_dir():
        return
    for path in base.glob("*/agent-transcripts/*/*.jsonl"):
        try:
            mt = file_mtime(path)
            if mt < since:
                continue
        except OSError:
            continue
        stats.files += 1
        # Cursor has no per-message timestamps; fall back to file mtime for the whole file.
        ts_iso = mt.isoformat()
        cwd = _decode_cwd(path.parts[len(base.parts)])
        if cwd_contains and cwd_contains not in cwd:
            continue
        session = path.stem
        for line in iter_lines(path):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                stats.parse_errors += 1
                continue
            if obj.get("role") != "user":
                continue
            msg = obj.get("message", {})
            content = msg.get("content") if isinstance(msg, dict) else obj.get("content")
            text = blocks_to_text(content)
            if text is None:
                continue
            text = text.replace("<user_query>", "").replace("</user_query>", "")
            if is_noise(text):
                continue
            body, trunc = clip(text)
            emit({"provider": "cursor", "file": str(path), "session": session,
                  "ts": ts_iso, "branch": None, "cwd": cwd,
                  "text": body, "truncated": trunc})
            stats.bump("cursor")


PROVIDERS = {
    "claude-code": scan_claude,
    "codex": scan_codex,
    "cursor": scan_cursor,
}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--days", type=int, help="Look back this many days (default 7).")
    g.add_argument("--since", type=str, help="ISO8601 lower bound, e.g. 2026-07-01T00:00:00Z.")
    ap.add_argument("--cwd-contains", type=str, default=None,
                    help="Only messages whose session cwd contains this substring (default: all projects).")
    ap.add_argument("--providers", type=str, default=None,
                    help="Comma-separated subset of: " + ",".join(PROVIDERS))
    args = ap.parse_args()

    if args.since:
        since = parse_ts(args.since)
        if since is None:
            ap.error(f"unparseable --since: {args.since!r}")
    else:
        days = args.days if args.days is not None else 7
        since = datetime.now(timezone.utc) - timedelta(days=days)
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)

    selected = PROVIDERS
    if args.providers:
        names = [n.strip() for n in args.providers.split(",") if n.strip()]
        unknown = [n for n in names if n not in PROVIDERS]
        if unknown:
            ap.error(f"unknown provider(s): {', '.join(unknown)}")
        selected = {n: PROVIDERS[n] for n in names}

    stats = Stats()
    out = sys.stdout

    def emit(rec):
        out.write(json.dumps(rec, ensure_ascii=False) + "\n")

    for scan in selected.values():
        try:
            scan(since, args.cwd_contains, stats, emit)
        except Exception as e:  # one provider failing must not sink the rest
            print(f"warning: {scan.__name__} failed: {e}", file=sys.stderr)

    emit({"_meta": {"providers": stats.by_provider, "files_scanned": stats.files,
                    "messages": stats.messages, "since": since.isoformat(),
                    "parse_errors": stats.parse_errors}})
    print(f"scanned {stats.files} files, {stats.messages} user messages "
          f"since {since.date()} — {stats.by_provider}", file=sys.stderr)


if __name__ == "__main__":
    main()
