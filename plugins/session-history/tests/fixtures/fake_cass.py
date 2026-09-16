#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import time

HITS = [
    {"source_id": "local-pi", "agent": "pi", "session_id": "sess-pi-001", "path": "/fixtures/pi/session-001.jsonl", "line": 12, "timestamp": "2026-09-10T14:00:00Z", "excerpt": "We decided to use hybrid retrieval for session history.", "score": 0.95},
    {"source_id": "local-omp", "agent": "oh-my-pi", "session_id": "sess-omp-002", "path": "/fixtures/omp/session-002.jsonl", "line": 44, "timestamp": "2026-09-11T09:30:00Z", "excerpt": "OMP plugin should wrap cass --robot without launching the TUI.", "score": 0.88},
    {"source_id": "remote-codex", "agent": "codex", "session_id": "sess-codex-003", "path": "/fixtures/codex/session-003.jsonl", "line": 7, "timestamp": "2026-09-12T16:15:00Z", "excerpt": "Codex sessions need harness normalization in citations.", "score": 0.82},
    {"source_id": "remote-claude", "agent": "claude-code", "session_id": "sess-claude-004", "path": "/fixtures/claude/session-004.jsonl", "line": 21, "timestamp": "2026-09-13T11:45:00Z", "excerpt": "Claude Code history must map to harness claude in results.", "score": 0.79},
    {"source_id": "local-pi", "agent": "pi", "session_id": "sess-excluded", "path": "/fixtures/pi/excluded.jsonl", "line": 3, "timestamp": "2026-09-14T08:00:00Z", "excerpt": "This session is excluded from all retrieval paths.", "score": 0.99},
    {"source_id": "local-purged", "agent": "pi", "session_id": "sess-purged", "path": "/fixtures/pi/purged.jsonl", "line": 5, "timestamp": "2026-09-14T09:00:00Z", "excerpt": "Purged session content must never reappear.", "score": 0.97},
]

SOURCES = [
    {"id": "local-pi", "kind": "local", "status": "online", "last_sync": "2026-09-15T10:00:00Z"},
    {"id": "local-omp", "kind": "local", "status": "online", "last_sync": "2026-09-15T09:55:00Z"},
    {"id": "remote-codex", "kind": "remote", "status": "online", "last_sync": "2026-09-15T08:30:00Z"},
    {"id": "remote-claude", "kind": "remote", "status": "offline", "last_sync": "2026-09-14T22:00:00Z"},
    {"id": "local-purged", "kind": "local", "status": "online", "last_sync": "2026-09-15T07:00:00Z"},
]

PACK_EVIDENCE = [
    {"source_id": "local-pi", "agent": "pi", "session_id": "sess-pi-001", "path": "/fixtures/pi/session-001.jsonl", "line": 12, "timestamp": "2026-09-10T14:00:00Z", "excerpt": "We decided to use hybrid retrieval for session history.", "kind": "excerpt"},
    {"source_id": "local-pi", "agent": "pi", "session_id": "sess-pi-001", "path": "/fixtures/pi/session-001.jsonl", "line": 18, "timestamp": "2026-09-10T14:05:00Z", "excerpt": "Two-second search budget is a hard client-visible boundary.", "kind": "excerpt"},
    {"source_id": "local-pi", "agent": "pi", "session_id": "sess-pi-001", "path": "/fixtures/pi/session-001.jsonl", "line": 25, "timestamp": "2026-09-10T14:10:00Z", "excerpt": "Use CASS pack evidence for resume packets, never invent unfinished work.", "kind": "decision"},
]

PACK_SESSION = {"id": "sess-pi-001", "agent": "pi", "source_id": "local-pi", "path": "/fixtures/pi/session-001.jsonl", "title": "Session history design"}
PACK_SESSION_NO_UNFINISHED = {"id": "sess-omp-002", "agent": "oh-my-pi", "source_id": "local-omp", "path": "/fixtures/omp/session-002.jsonl", "title": "OMP wrapper work"}


def _sleep_if_requested() -> None:
    raw = os.environ.get("FAKE_CASS_SLEEP", "").strip()
    if not raw:
        return
    try:
        time.sleep(float(raw))
    except ValueError:
        pass


def _error_response(message: str) -> None:
    print(json.dumps({"error": message, "ready": False}))
    sys.exit(1)


def _mode_payload() -> dict:
    if os.environ.get("FAKE_CASS_FALLBACK", "").strip() in {"1", "true", "yes"}:
        return {"mode": "lexical", "fallback": True}
    if os.environ.get("FAKE_CASS_MODE", "").strip().lower() == "lexical":
        return {"mode": "lexical", "fallback": True}
    return {"mode": "hybrid", "fallback": False}


def _filter_hits(query: str, sessions_from: str | None, limit: int | None) -> list[dict]:
    needle = query.lower()
    hits = [hit for hit in HITS if needle in hit["excerpt"].lower() or needle in hit["session_id"].lower()]
    if not hits and needle not in {"nohit", "nomatch", "__no_match__"}:
        hits = HITS[:]
    if sessions_from:
        hits = [hit for hit in hits if hit["path"] == sessions_from or hit["session_id"] == sessions_from]
    if limit is not None:
        hits = hits[:limit]
    return hits


def cmd_search(argv: list[str]) -> None:
    query = ""
    sessions_from = None
    limit = None
    idx = 2
    while idx < len(argv):
        token = argv[idx]
        if token in {"--robot", "--json"}:
            idx += 1
            continue
        if token == "--sessions-from" and idx + 1 < len(argv):
            sessions_from = argv[idx + 1]
            idx += 2
            continue
        if token == "--limit" and idx + 1 < len(argv):
            limit = int(argv[idx + 1])
            idx += 2
            continue
        if token.startswith("--timeout"):
            idx += 2 if "=" not in token and idx + 1 < len(argv) else 1
            continue
        if not token.startswith("-") and not query:
            query = token
        idx += 1
    if not query and len(argv) > 2:
        query = argv[2]
    payload = {"hits": _filter_hits(query, sessions_from, limit), "ready": True, "empty": False, **_mode_payload()}
    if query.lower() in {"nohit", "nomatch", "__no_match__"}:
        payload["hits"] = []
        payload["empty"] = True
    print(json.dumps(payload))


def cmd_pack(argv: list[str]) -> None:
    query = ""
    idx = 2
    while idx < len(argv):
        token = argv[idx]
        if token in {"--robot", "--json"}:
            idx += 1
            continue
        if not token.startswith("-") and not query:
            query = token
        idx += 1
    key = query.lower()
    if key in {"no-unfinished", "omp", "sess-omp-002"}:
        session = PACK_SESSION_NO_UNFINISHED
        evidence = [
            {"source_id": "local-omp", "agent": "oh-my-pi", "session_id": "sess-omp-002", "path": "/fixtures/omp/session-002.jsonl", "line": 44, "timestamp": "2026-09-11T09:30:00Z", "excerpt": "OMP plugin should wrap cass --robot without launching the TUI.", "kind": "excerpt"},
            {"source_id": "local-omp", "agent": "oh-my-pi", "session_id": "sess-omp-002", "path": "/fixtures/omp/session-002.jsonl", "line": 50, "timestamp": "2026-09-11T09:40:00Z", "excerpt": "Lifecycle disconnect retains indexed history.", "kind": "decision"},
        ]
        unfinished = None
    else:
        session = PACK_SESSION
        evidence = PACK_EVIDENCE
        unfinished = [{"source_id": "local-pi", "agent": "pi", "session_id": "sess-pi-001", "path": "/fixtures/pi/session-001.jsonl", "line": 30, "timestamp": "2026-09-10T14:20:00Z", "excerpt": "Finish MCP stdio server and exclusion store filtering.", "kind": "unfinished"}]
    print(json.dumps({"session": session, "evidence": evidence, "unfinished": unfinished, "ready": True, **_mode_payload()}))



def cmd_view(argv: list[str]) -> None:
    path = ""
    line = 1
    idx = 2
    while idx < len(argv):
        token = argv[idx]
        if token == "-n" and idx + 1 < len(argv):
            line = int(argv[idx + 1])
            idx += 2
            continue
        if token == "--json":
            idx += 1
            continue
        if not token.startswith("-") and not path:
            path = token
        idx += 1
    print(json.dumps({"role": "assistant", "text": f"Exact moment at {path}:{line}"}))


def cmd_expand(argv: list[str]) -> None:
    path = ""
    line = 1
    context = 3
    idx = 2
    while idx < len(argv):
        token = argv[idx]
        if token == "-n" and idx + 1 < len(argv):
            line = int(argv[idx + 1])
            idx += 2
            continue
        if token == "-C" and idx + 1 < len(argv):
            context = int(argv[idx + 1])
            idx += 2
            continue
        if token == "--json":
            idx += 1
            continue
        if not token.startswith("-") and not path:
            path = token
        idx += 1
    rows = []
    for offset in range(-context, context + 1):
        current = line + offset
        if current < 1:
            continue
        role = "user" if current % 2 else "assistant"
        rows.append({"line": current, "role": role, "text": f"{path}:{current} context"})
    print(json.dumps({"context": rows}))


def cmd_health(_argv: list[str]) -> None:
    print(json.dumps({"ready": True, "hybrid_ready": os.environ.get("FAKE_CASS_FALLBACK", "") not in {"1", "true", "yes"}}))


def cmd_sources(argv: list[str]) -> None:
    if len(argv) > 3 and argv[2] == "list":
        print(json.dumps({"sources": SOURCES}))
        return
    if len(argv) > 3 and argv[2] == "remove":
        source = argv[3]
        purge = "--purge" in argv
        print(json.dumps({"removed": source, "purged": purge, "retained": not purge}))
        return
    _error_response("unknown sources command")


def cmd_forget(argv: list[str]) -> None:
    session = argv[2] if len(argv) > 2 else ""
    print(json.dumps({"forgotten": session, "ok": True}))


def cmd_sessions(_argv: list[str]) -> None:
    sessions = []
    seen: set[str] = set()
    for hit in HITS:
        if hit["session_id"] in seen:
            continue
        seen.add(hit["session_id"])
        sessions.append({"id": hit["session_id"], "path": hit["path"], "agent": hit["agent"], "source_id": hit["source_id"]})
    print(json.dumps({"sessions": sessions}))


def main() -> int:
    if os.environ.get("FAKE_CASS_ERROR", "").strip():
        _error_response(os.environ["FAKE_CASS_ERROR"].strip())
    _sleep_if_requested()
    argv = sys.argv
    if len(argv) < 2:
        _error_response("missing command")
    handlers = {
        "search": cmd_search,
        "pack": cmd_pack,
        "view": cmd_view,
        "expand": cmd_expand,
        "health": cmd_health,
        "sources": cmd_sources,
        "forget": cmd_forget,
        "sessions": cmd_sessions,
    }
    handler = handlers.get(argv[1])
    if handler is None:
        _error_response(f"unknown command: {argv[1]}")
    handler(argv)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
