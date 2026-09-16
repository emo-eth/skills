#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SEARCH_BUDGET_MS = 2000
CASS_SEARCH_TIMEOUT_S = 1.8
DEFAULT_RECALL_LIMIT = 3
MAX_LAG_SECONDS = 300
TOKEN_RE = re.compile(r"[a-z0-9]+", re.I)
DECISION_RE = re.compile(r"\bdecided\b", re.I)
CONFLICT_TOPIC_RE = re.compile(r"\b(postgresql|sqlite|hybrid|lexical)\b", re.I)
MCP_TOOLS = [
    "session_recall",
    "session_inspect",
    "session_expand",
    "session_resume",
    "session_query",
    "session_status",
    "session_manage",
]


@dataclass
class Moment:
    moment_id: str
    session_id: str
    harness: str
    source: str
    path: str
    line: int
    role: str
    content: str
    timestamp: str
    title: str = ""


@dataclass
class SessionDoc:
    session_id: str
    harness: str
    source: str
    path: str
    title: str
    last_active: str
    moments: list[Moment] = field(default_factory=list)


class SessionHistoryError(Exception):
    def __init__(self, code: str, message: str, source: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.source = source


def cass_bin() -> str:
    return os.environ.get("SESSION_HISTORY_CASS") or os.environ.get("CASS_BIN") or "cass"


def session_history_home() -> Path:
    raw = os.environ.get("SESSION_HISTORY_HOME", str(Path.home() / ".config" / "session-history"))
    return Path(raw).expanduser()


def exclusions_path() -> Path:
    return session_history_home() / "exclusions.json"


def checkpoints_path() -> Path:
    return session_history_home() / "checkpoints.json"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def empty_exclusions() -> dict[str, list[str]]:
    return {"sessions": [], "sources": [], "purged_sessions": [], "purged_sources": []}


def load_exclusions() -> dict[str, list[str]]:
    path = exclusions_path()
    if not path.exists():
        return empty_exclusions()
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return empty_exclusions()
    base = empty_exclusions()
    if not isinstance(value, dict):
        return base
    for key in base:
        raw = value.get(key, [])
        if isinstance(raw, list):
            base[key] = [str(item) for item in raw]
    return base


def save_exclusions(store: dict[str, list[str]]) -> None:
    path = exclusions_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(store, indent=2, ensure_ascii=False) + "\n")


def load_checkpoints() -> dict[str, int]:
    path = checkpoints_path()
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    if not isinstance(value, dict):
        return {}
    return {str(key): int(val) for key, val in value.items() if isinstance(val, int)}


def save_checkpoints(store: dict[str, int]) -> None:
    path = checkpoints_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(store, indent=2) + "\n")


def fixtures_dir() -> Path | None:
    raw = os.environ.get("SESSION_HISTORY_FIXTURES_DIR", "").strip()
    if not raw:
        return None
    return Path(raw).expanduser()


def cass_available() -> bool:
    path = cass_bin()
    if Path(path).is_file():
        return os.access(path, os.X_OK)
    return shutil.which(path) is not None


def prefer_builtin() -> bool:
    return fixtures_dir() is not None


def auth_token() -> str | None:
    token = os.environ.get("SESSION_HISTORY_AUTH_TOKEN", "").strip()
    return token or None


def mcp_authenticated(params: dict[str, Any]) -> bool:
    required = auth_token()
    if not required:
        return True
    meta = params.get("_meta") if isinstance(params.get("_meta"), dict) else {}
    supplied = str(meta.get("authToken") or params.get("authToken") or "").strip()
    return supplied == required


def normalize_harness(agent: str) -> str:
    value = (agent or "").strip().lower()
    if value in {"pi"}:
        return "pi"
    if value in {"omp", "oh-my-pi"}:
        return "omp"
    if value in {"codex"}:
        return "codex"
    if value in {"claude", "claude-code"}:
        return "claude"
    return value or "unknown"


def tool_error(code: str, message: str) -> dict[str, Any]:
    return {"error": code, "message": message}


def is_session_blocked(session_id: str, store: dict[str, list[str]]) -> bool:
    return session_id in store["sessions"] or session_id in store["purged_sessions"]


def is_source_blocked(source_id: str, store: dict[str, list[str]]) -> bool:
    return source_id in store["sources"] or source_id in store["purged_sources"]


def should_filter_hit(hit: dict[str, Any], store: dict[str, list[str]]) -> bool:
    session_id = str(hit.get("session_id") or hit.get("sessionId") or "")
    source_id = str(hit.get("source_id") or hit.get("sourceId") or "")
    if session_id and is_session_blocked(session_id, store):
        return True
    if source_id and is_source_blocked(source_id, store):
        return True
    return False


def tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(text.lower())


def extract_text_content(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                for key in ("text", "content", "input_text", "output_text"):
                    if key in item and isinstance(item[key], str):
                        parts.append(item[key])
        return "\n".join(parts)
    if isinstance(value, dict):
        for key in ("text", "content"):
            if key in value:
                return extract_text_content(value[key])
    return ""


def parse_jsonl_messages(path: Path, harness: str, source: str, start_line: int = 1) -> SessionDoc:
    session_id = path.stem
    title = path.stem
    last_active = ""
    moments: list[Moment] = []
    line_no = 0
    with path.open("r", encoding="utf-8") as handle:
        for raw in handle:
            line_no += 1
            if line_no < start_line:
                continue
            raw = raw.strip()
            if not raw:
                continue
            try:
                row = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(row, dict):
                continue
            row_type = str(row.get("type") or "")
            if row_type == "session":
                session_id = str(row.get("id") or session_id)
                title = str(row.get("title") or title)
                last_active = str(row.get("timestamp") or last_active)
                continue
            if row_type == "session_meta":
                session_id = str(row.get("session_id") or session_id)
                last_active = str(row.get("timestamp") or last_active)
                continue
            role = str(row.get("role") or "")
            content = row.get("content")
            timestamp = str(row.get("timestamp") or "")
            message = row.get("message") if isinstance(row.get("message"), dict) else None
            if message:
                role = str(message.get("role") or role or "unknown")
                content = message.get("content", content)
            text = extract_text_content(content)
            if not text:
                continue
            moment_id = str(row.get("id") or f"m{line_no}")
            moments.append(
                Moment(
                    moment_id=moment_id,
                    session_id=session_id,
                    harness=harness,
                    source=source,
                    path=str(path),
                    line=line_no,
                    role=role or "unknown",
                    content=text,
                    timestamp=timestamp,
                    title=title,
                )
            )
            if timestamp:
                last_active = timestamp
    return SessionDoc(session_id, harness, source, str(path), title, last_active, moments)


def parse_claude_json(path: Path, source: str) -> SessionDoc:
    payload = json.loads(path.read_text(encoding="utf-8"))
    session_id = str(payload.get("session_id") or path.stem)
    title = str(payload.get("title") or path.stem)
    last_active = ""
    moments: list[Moment] = []
    messages = payload.get("messages") if isinstance(payload.get("messages"), list) else []
    for index, row in enumerate(messages, start=1):
        if not isinstance(row, dict):
            continue
        message = row.get("message") if isinstance(row.get("message"), dict) else row
        role = str(message.get("role") or row.get("type") or "unknown")
        text = extract_text_content(message.get("content"))
        if not text:
            continue
        timestamp = str(row.get("timestamp") or "")
        moment_id = str(row.get("uuid") or row.get("id") or f"m{index}")
        moments.append(
            Moment(
                moment_id=moment_id,
                session_id=session_id,
                harness="claude",
                source=source,
                path=str(path),
                line=index,
                role=role,
                content=text,
                timestamp=timestamp,
                title=title,
            )
        )
        if timestamp:
            last_active = timestamp
    return SessionDoc(session_id, harness="claude", source=source, path=str(path), title=title, last_active=last_active, moments=moments)


def discover_fixture_sessions() -> list[SessionDoc]:
    root = fixtures_dir()
    if root is None:
        return []
    checkpoints = load_checkpoints()
    sessions: list[SessionDoc] = []
    mapping = {
        "pi": ("pi", "fixtures-pi"),
        "omp": ("omp", "fixtures-omp"),
        "codex": ("codex", "fixtures-codex"),
        "claude": ("claude", "fixtures-claude"),
    }
    for folder, (harness, source) in mapping.items():
        base = root / folder
        if not base.is_dir():
            continue
        for path in sorted(base.iterdir()):
            if path.suffix == ".jsonl":
                start = checkpoints.get(str(path), 1)
                doc = parse_jsonl_messages(path, harness, source, start_line=start)
                sessions.append(doc)
                checkpoints[str(path)] = sum(1 for _ in path.open("r", encoding="utf-8"))
            elif path.suffix == ".json":
                doc = parse_claude_json(path, source)
                sessions.append(doc)
                checkpoints[str(path)] = path.stat().st_size
    save_checkpoints(checkpoints)
    return sessions


def discover_standard_sessions() -> list[SessionDoc]:
    if fixtures_dir() is not None:
        return discover_fixture_sessions()
    return []


def is_blocked_moment(moment: Moment, store: dict[str, list[str]]) -> bool:
    return is_session_blocked(moment.session_id, store) or is_source_blocked(moment.source, store)


def collect_moments(store: dict[str, list[str]]) -> list[Moment]:
    moments: list[Moment] = []
    for doc in discover_standard_sessions():
        for moment in doc.moments:
            if not is_blocked_moment(moment, store):
                moments.append(moment)
    return moments


def bm25_score(query_terms: list[str], doc_terms: list[str], avg_len: float, doc_count: int, df: dict[str, int]) -> float:
    if not query_terms or not doc_terms:
        return 0.0
    k1 = 1.2
    b = 0.75
    doc_len = len(doc_terms)
    tf: dict[str, int] = {}
    for term in doc_terms:
        tf[term] = tf.get(term, 0) + 1
    score = 0.0
    for term in query_terms:
        if term not in tf:
            continue
        freq = tf[term]
        idf = math.log(1 + (doc_count - df.get(term, 0) + 0.5) / (df.get(term, 0) + 0.5))
        denom = freq + k1 * (1 - b + b * doc_len / max(avg_len, 1.0))
        score += idf * (freq * (k1 + 1)) / max(denom, 1e-9)
    return score


def search_moments(query: str, moments: list[Moment], limit: int, lexical_only: bool = False) -> list[Moment]:
    query_terms = tokenize(query)
    if not query_terms:
        return []
    docs = [tokenize(moment.content) for moment in moments]
    doc_count = max(len(docs), 1)
    avg_len = sum(len(doc) for doc in docs) / doc_count
    df: dict[str, int] = {}
    for doc in docs:
        for term in set(doc):
            df[term] = df.get(term, 0) + 1
    scored: list[tuple[float, Moment]] = []
    for moment, doc_terms in zip(moments, docs):
        score = bm25_score(query_terms, doc_terms, avg_len, doc_count, df)
        if not lexical_only:
            score += len(set(query_terms) & set(doc_terms)) * 0.25
        if score > 0:
            scored.append((score, moment))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [moment for _, moment in scored[:limit]]


def assignment_citation(moment: Moment) -> dict[str, Any]:
    return {
        "source": moment.source,
        "harness": moment.harness,
        "session_id": moment.session_id,
        "moment_id": moment.moment_id,
        "timestamp": moment.timestamp,
        "snippet": moment.content[:240],
        "role": moment.role,
    }


def citation_from_cass_hit(hit: dict[str, Any]) -> dict[str, Any]:
    line = int(hit.get("line") or 0)
    return {
        "source": str(hit.get("source_id") or hit.get("sourceId") or ""),
        "harness": normalize_harness(str(hit.get("agent") or hit.get("harness") or "")),
        "session_id": str(hit.get("session_id") or hit.get("sessionId") or ""),
        "moment_id": str(hit.get("moment_id") or hit.get("momentId") or f"m{line}"),
        "timestamp": str(hit.get("timestamp") or ""),
        "snippet": str(hit.get("excerpt") or hit.get("snippet") or ""),
        "role": str(hit.get("role") or "unknown"),
    }


def detect_conflicts(moments: Iterable[Moment]) -> list[dict[str, Any]]:
    decisions: list[tuple[str, str, Moment]] = []
    for moment in moments:
        if not DECISION_RE.search(moment.content):
            continue
        topic_match = CONFLICT_TOPIC_RE.search(moment.content)
        topic = topic_match.group(1).lower() if topic_match else "decision"
        decisions.append((topic, moment.content, moment))
    conflicts: list[dict[str, Any]] = []
    by_topic: dict[str, list[tuple[str, Moment]]] = {}
    for topic, text, moment in decisions:
        by_topic.setdefault(topic, []).append((text, moment))
    for topic, items in by_topic.items():
        if len(items) < 2:
            continue
        positions = [{"decision": text, "citation": assignment_citation(moment)} for text, moment in items[:3]]
        if len({pos["decision"] for pos in positions}) < 2:
            continue
        conflicts.append({"topic": topic, "positions": positions})
    return conflicts


def synthesize_answer(query: str, hits: list[Moment]) -> str:
    if not hits:
        return f"No matching session history found for '{query}'."
    return " ".join(hit.content for hit in hits[:3])[:500]


def run_cass(args: list[str], timeout: float | None = None) -> dict[str, Any]:
    command = [cass_bin(), *args]
    try:
        completed = subprocess.run(command, check=False, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise SessionHistoryError("unavailable", "CASS command timed out", cass_bin()) from exc
    except OSError as exc:
        raise SessionHistoryError("unavailable", f"Failed to run CASS: {exc}", cass_bin()) from exc
    stdout = (completed.stdout or "").strip()
    if not stdout:
        raise SessionHistoryError("unavailable", completed.stderr.strip() or "CASS returned no output", cass_bin())
    try:
        payload = json.loads(stdout)
    except ValueError as exc:
        raise SessionHistoryError("unavailable", "CASS returned invalid JSON", cass_bin()) from exc
    if isinstance(payload, dict) and payload.get("error"):
        raise SessionHistoryError("unavailable", str(payload.get("error")), cass_bin())
    if not isinstance(payload, dict):
        raise SessionHistoryError("unavailable", "CASS returned unexpected payload", cass_bin())
    return payload


def cass_session_map() -> dict[str, dict[str, Any]]:
    payload = run_cass(["sessions", "--json"], timeout=10)
    sessions = payload.get("sessions")
    mapping: dict[str, dict[str, Any]] = {}
    if not isinstance(sessions, list):
        return mapping
    for entry in sessions:
        if not isinstance(entry, dict):
            continue
        session_id = str(entry.get("id") or "")
        if session_id:
            mapping[session_id] = entry
        path = str(entry.get("path") or "")
        if path:
            mapping[path] = entry
    return mapping


def resolve_session_path(session_id: str) -> str:
    entry = cass_session_map().get(session_id)
    if entry:
        return str(entry.get("path") or session_id)
    doc = find_session_doc(session_id)
    if doc:
        return doc.path
    return session_id


def cass_mode_degraded(payload: dict[str, Any], lexical_only: bool) -> tuple[bool, list[str]]:
    warnings: list[str] = []
    mode = str(payload.get("mode") or "hybrid").lower()
    fallback = bool(payload.get("fallback"))
    degraded = lexical_only or mode == "lexical" or fallback
    if degraded:
        warnings.append("Semantic retrieval unavailable; lexical search only.")
    return degraded, warnings


def builtin_status_payload(store: dict[str, list[str]]) -> dict[str, Any]:
    sessions = discover_standard_sessions()
    sources: dict[str, dict[str, Any]] = {}
    for doc in sessions:
        entry = sources.setdefault(
            doc.source,
            {"name": doc.source, "harness": doc.harness, "sessions_count": 0, "last_sync": doc.last_active or utc_now()},
        )
        entry["sessions_count"] += 1
        if doc.last_active and doc.last_active > str(entry["last_sync"]):
            entry["last_sync"] = doc.last_active
    hybrid_ready = not prefer_builtin() and cass_available()
    warnings: list[str] = []
    if not hybrid_ready:
        warnings.append("Semantic retrieval unavailable; lexical search only.")
    return {
        "healthy": bool(sessions),
        "cass_available": cass_available(),
        "hybrid_ready": hybrid_ready,
        "sources": list(sources.values()),
        "warnings": warnings,
        "exclusions": {"sessions": store["sessions"], "sources": store["sources"]},
        "purged": {"sessions": store["purged_sessions"], "sources": store["purged_sources"]},
    }


def cass_status_payload(store: dict[str, list[str]]) -> dict[str, Any]:
    health = run_cass(["health", "--json"], timeout=10)
    sources_payload = run_cass(["sources", "list", "--json"], timeout=10)
    sources_raw = sources_payload.get("sources") if isinstance(sources_payload.get("sources"), list) else []
    sources: list[dict[str, Any]] = []
    warnings: list[str] = []
    for source in sources_raw:
        if not isinstance(source, dict):
            continue
        status = str(source.get("status") or "unknown")
        name = str(source.get("id") or "")
        sources.append({
            "name": name,
            "harness": normalize_harness(str(source.get("agent") or source.get("harness") or "pi")),
            "sessions_count": int(source.get("sessions_count") or source.get("sessionsCount") or 0),
            "last_sync": str(source.get("last_sync") or source.get("lastSync") or ""),
        })
        if status.lower() in {"offline", "stale", "error"}:
            warnings.append(f"Source {name} is {status}")
    hybrid_ready = bool(health.get("hybrid_ready") if "hybrid_ready" in health else health.get("hybridReady"))
    return {
        "healthy": bool(health.get("ready")),
        "cass_available": True,
        "hybrid_ready": hybrid_ready,
        "sources": sources,
        "warnings": warnings,
        "exclusions": {"sessions": store["sessions"], "sources": store["sources"]},
        "purged": {"sessions": store["purged_sessions"], "sources": store["purged_sources"]},
    }


def find_session_doc(session_id: str) -> SessionDoc | None:
    for doc in discover_standard_sessions():
        if doc.session_id == session_id or doc.path == session_id:
            return doc
    return None


def find_moment(session_id: str, moment_id: str) -> Moment | None:
    doc = find_session_doc(session_id)
    if doc is None:
        return None
    for moment in doc.moments:
        if moment.moment_id == moment_id:
            return moment
        if moment_id.isdigit() and moment.line == int(moment_id):
            return moment
        if moment_id.startswith("m") and moment_id[1:].isdigit() and moment.line == int(moment_id[1:]):
            return moment
    return None


def resolve_moment_for_cass(session_id: str, moment_id: str) -> tuple[str, int]:
    path = resolve_session_path(session_id)
    if moment_id.isdigit():
        return path, int(moment_id)
    if moment_id.startswith("m") and moment_id[1:].isdigit():
        return path, int(moment_id[1:])
    entry = cass_session_map().get(session_id) or {}
    path = str(entry.get("path") or path)
    return path, 1


def cmd_recall(args: argparse.Namespace) -> dict[str, Any]:
    start = time.monotonic()
    store = load_exclusions()
    limit = args.limit if args.limit is not None else DEFAULT_RECALL_LIMIT
    lexical_only = bool(args.lexical_only)

    if prefer_builtin():
        hits = search_moments(args.query, collect_moments(store), limit, lexical_only=lexical_only)
        status = builtin_status_payload(store)
        degraded = lexical_only or not status["hybrid_ready"]
        warnings = list(status["warnings"]) if degraded else []
        return {
            "answer": synthesize_answer(args.query, hits),
            "citations": [assignment_citation(moment) for moment in hits],
            "degraded": degraded,
            "warnings": warnings,
            "conflicts": detect_conflicts(hits),
            "elapsed_ms": int((time.monotonic() - start) * 1000),
        }

    cass_args = ["search", args.query, "--robot", "--limit", str(limit), "--timeout", str(int(CASS_SEARCH_TIMEOUT_S * 1000))]
    try:
        payload = run_cass(cass_args, timeout=SEARCH_BUDGET_MS / 1000)
    except SessionHistoryError as exc:
        raise SessionHistoryError(exc.code, exc.message, exc.source) from exc
    degraded, warnings = cass_mode_degraded(payload, lexical_only)
    hits = payload.get("hits") if isinstance(payload.get("hits"), list) else []
    citations = [citation_from_cass_hit(hit) for hit in hits if isinstance(hit, dict) and not should_filter_hit(hit, store)]
    moments = [
        Moment(
            moment_id=c["moment_id"],
            session_id=c["session_id"],
            harness=c["harness"],
            source=c["source"],
            path=str(hit.get("path") or ""),
            line=int(hit.get("line") or 0),
            role=c["role"],
            content=c["snippet"],
            timestamp=c["timestamp"],
        )
        for hit, c in zip(hits, citations)
        if isinstance(hit, dict)
    ][:limit]
    return {
        "answer": synthesize_answer(args.query, moments) if moments else f"No matching session history found for '{args.query}'.",
        "citations": citations[:limit],
        "degraded": degraded,
        "warnings": warnings,
        "conflicts": detect_conflicts(moments),
        "elapsed_ms": int((time.monotonic() - start) * 1000),
    }


def cmd_inspect(args: argparse.Namespace) -> dict[str, Any]:
    store = load_exclusions()
    if is_session_blocked(args.session, store):
        raise SessionHistoryError("denied", "Session is excluded or purged", args.session)
    moment = find_moment(args.session, args.moment)
    if moment is not None:
        return {
            "session_id": moment.session_id,
            "harness": moment.harness,
            "source": moment.source,
            "moment": {
                "moment_id": moment.moment_id,
                "timestamp": moment.timestamp,
                "role": moment.role,
                "content": moment.content,
            },
        }
    path, line = resolve_moment_for_cass(args.session, args.moment)
    if is_session_blocked(args.session, store):
        raise SessionHistoryError("denied", "Session is excluded or purged", args.session)
    payload = run_cass(["view", path, "-n", str(line), "--json"], timeout=10)
    entry = cass_session_map().get(args.session) or {}
    return {
        "session_id": args.session,
        "harness": normalize_harness(str(entry.get("agent") or "")),
        "source": str(entry.get("source_id") or entry.get("sourceId") or ""),
        "moment": {
            "moment_id": args.moment,
            "timestamp": str(payload.get("timestamp") or ""),
            "role": str(payload.get("role") or "assistant"),
            "content": str(payload.get("text") or ""),
        },
    }


def cmd_expand(args: argparse.Namespace) -> dict[str, Any]:
    store = load_exclusions()
    if is_session_blocked(args.session, store):
        raise SessionHistoryError("denied", "Session is excluded or purged", args.session)
    before = args.before if args.before is not None else 3
    after = args.after if args.after is not None else 3
    doc = find_session_doc(args.session)
    if doc is not None:
        anchor = find_moment(args.session, args.moment)
        if anchor is None:
            raise SessionHistoryError("not_found", "Moment not found", args.moment)
        index = next((idx for idx, moment in enumerate(doc.moments) if moment.moment_id == anchor.moment_id), None)
        if index is None:
            raise SessionHistoryError("not_found", "Moment not found", args.moment)
        start = max(0, index - before)
        end = min(len(doc.moments), index + after + 1)
        selected = doc.moments[start:end]
        return {
            "session_id": doc.session_id,
            "moments": [
                {
                    "moment_id": moment.moment_id,
                    "role": moment.role,
                    "content": moment.content,
                    "timestamp": moment.timestamp,
                }
                for moment in selected
            ],
        }
    path, line = resolve_moment_for_cass(args.session, args.moment)
    context = max(before, after)
    payload = run_cass(["expand", path, "-n", str(line), "-C", str(context), "--json"], timeout=10)
    rows = payload.get("context") if isinstance(payload.get("context"), list) else []
    return {
        "session_id": args.session,
        "moments": [
            {
                "moment_id": f"m{row.get('line')}" if isinstance(row, dict) else "m0",
                "role": str(row.get("role") or "unknown"),
                "content": str(row.get("text") or ""),
                "timestamp": "",
            }
            for row in rows
            if isinstance(row, dict)
        ],
    }


def cmd_resume(args: argparse.Namespace) -> dict[str, Any]:
    store = load_exclusions()
    if is_session_blocked(args.session, store):
        raise SessionHistoryError("denied", "Session is excluded or purged", args.session)
    doc = find_session_doc(args.session)
    if doc is not None:
        decisions = [moment.content for moment in doc.moments if DECISION_RE.search(moment.content)]
        unfinished = [moment.content for moment in doc.moments if moment.content.lower().startswith("todo:")]
        excerpts = [moment.content for moment in doc.moments[:3]]
        return {
            "session_id": doc.session_id,
            "title": doc.title,
            "harness": doc.harness,
            "source": doc.source,
            "last_active": doc.last_active,
            "decisions": decisions[:5],
            "unfinished_work": unfinished or [],
            "excerpts": excerpts,
        }
    payload = run_cass(["pack", args.session, "--robot"], timeout=10)
    session_raw = payload.get("session") if isinstance(payload.get("session"), dict) else {}
    session_id = str(session_raw.get("id") or args.session)
    if is_session_blocked(session_id, store):
        raise SessionHistoryError("denied", "Session is excluded or purged", session_id)
    evidence = payload.get("evidence") if isinstance(payload.get("evidence"), list) else []
    excerpts: list[str] = []
    decisions: list[str] = []
    for item in evidence:
        if not isinstance(item, dict) or should_filter_hit(item, store):
            continue
        text = str(item.get("excerpt") or "")
        kind = str(item.get("kind") or "excerpt")
        if kind == "decision":
            decisions.append(text)
        elif len(excerpts) < 3:
            excerpts.append(text)
    unfinished_raw = payload.get("unfinished")
    unfinished: list[str] = []
    if isinstance(unfinished_raw, list):
        for item in unfinished_raw:
            if isinstance(item, dict) and not should_filter_hit(item, store):
                unfinished.append(str(item.get("excerpt") or ""))
    return {
        "session_id": session_id,
        "title": str(session_raw.get("title") or session_id),
        "harness": normalize_harness(str(session_raw.get("agent") or "")),
        "source": str(session_raw.get("source_id") or session_raw.get("sourceId") or ""),
        "last_active": str(session_raw.get("last_active") or session_raw.get("timestamp") or ""),
        "decisions": decisions,
        "unfinished_work": unfinished,
        "excerpts": excerpts,
    }


def cmd_query_session(args: argparse.Namespace) -> dict[str, Any]:
    store = load_exclusions()
    if is_session_blocked(args.session, store):
        raise SessionHistoryError("denied", "Session is excluded or purged", args.session)
    doc = find_session_doc(args.session)
    if doc is not None:
        hits = search_moments(args.query, [m for m in doc.moments if not is_blocked_moment(m, store)], 5)
        return {
            "session_id": doc.session_id,
            "answer": synthesize_answer(args.query, hits),
            "moments": [
                {
                    "moment_id": moment.moment_id,
                    "role": moment.role,
                    "content": moment.content,
                    "timestamp": moment.timestamp,
                }
                for moment in hits
            ],
        }
    session_path = resolve_session_path(args.session)
    payload = run_cass(
        ["search", args.query, "--robot", "--sessions-from", session_path, "--limit", "5"],
        timeout=SEARCH_BUDGET_MS / 1000,
    )
    hits = payload.get("hits") if isinstance(payload.get("hits"), list) else []
    moments = []
    for hit in hits:
        if not isinstance(hit, dict) or should_filter_hit(hit, store):
            continue
        citation = citation_from_cass_hit(hit)
        moments.append({
            "moment_id": citation["moment_id"],
            "role": citation["role"],
            "content": citation["snippet"],
            "timestamp": citation["timestamp"],
        })
    answer_moments = []
    for hit in hits:
        if not isinstance(hit, dict) or should_filter_hit(hit, store):
            continue
        citation = citation_from_cass_hit(hit)
        answer_moments.append(
            Moment(
                citation["moment_id"],
                citation["session_id"],
                citation["harness"],
                citation["source"],
                str(hit.get("path") or ""),
                int(hit.get("line") or 0),
                citation["role"],
                citation["snippet"],
                citation["timestamp"],
            )
        )
    return {
        "session_id": args.session,
        "answer": synthesize_answer(args.query, answer_moments),
        "moments": moments,
    }


def cmd_status(_args: argparse.Namespace) -> dict[str, Any]:
    store = load_exclusions()
    if prefer_builtin():
        return builtin_status_payload(store)
    if not cass_available():
        return {
            "healthy": False,
            "cass_available": False,
            "hybrid_ready": False,
            "sources": [],
            "warnings": ["CASS is not available on this host."],
            "exclusions": {"sessions": store["sessions"], "sources": store["sources"]},
            "purged": {"sessions": store["purged_sessions"], "sources": store["purged_sources"]},
        }
    return cass_status_payload(store)


def cmd_manage(args: argparse.Namespace) -> dict[str, Any]:
    store = load_exclusions()
    action = args.action
    if action == "exclude":
        target = required_text(args.session, "session")
        if target not in store["sessions"]:
            store["sessions"].append(target)
            save_exclusions(store)
        if cass_available() and not prefer_builtin():
            run_cass(["forget", target], timeout=10)
        return {"action": "exclude", "ok": True, "session": target}
    if action == "reinclude":
        target = required_text(args.session, "session")
        for key in ("sessions", "purged_sessions", "sources", "purged_sources"):
            if target in store[key]:
                store[key].remove(target)
        save_exclusions(store)
        return {"action": "reinclude", "ok": True, "session": target}
    if action == "disconnect":
        target = required_text(args.source, "source")
        if cass_available() and not prefer_builtin():
            run_cass(["sources", "remove", target, "--json"], timeout=10)
        return {"action": "disconnect", "ok": True, "source": target}
    if action == "purge":
        if args.session:
            target = args.session
            if target not in store["purged_sessions"]:
                store["purged_sessions"].append(target)
            if target in store["sessions"]:
                store["sessions"].remove(target)
            save_exclusions(store)
            if cass_available() and not prefer_builtin():
                run_cass(["forget", target], timeout=10)
            return {"action": "purge", "ok": True, "session": target}
        if args.source:
            target = args.source
            if target not in store["purged_sources"]:
                store["purged_sources"].append(target)
            if target in store["sources"]:
                store["sources"].remove(target)
            save_exclusions(store)
            if cass_available() and not prefer_builtin():
                run_cass(["sources", "remove", target, "--purge", "-y", "--json"], timeout=10)
            return {"action": "purge", "ok": True, "source": target}
        raise SessionHistoryError("invalid_request", "purge requires --session or --source")
    raise SessionHistoryError("invalid_request", f"Unknown manage action: {action}")


def required_text(value: str | None, name: str) -> str:
    if not value or not str(value).strip():
        raise SessionHistoryError("invalid_request", f"{name} must be a non-empty string")
    return str(value).strip()


def mcp_tool_result(payload: dict[str, Any], is_error: bool = False) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}], "isError": is_error}


def dispatch_mcp_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    try:
        if name == "session_recall":
            ns = argparse.Namespace(query=arguments.get("query", ""), limit=arguments.get("limit", DEFAULT_RECALL_LIMIT), lexical_only=arguments.get("mode") == "lexical-only")
            return mcp_tool_result(cmd_recall(ns))
        if name == "session_inspect":
            return mcp_tool_result(cmd_inspect(argparse.Namespace(session=arguments.get("session", ""), moment=arguments.get("moment", ""))))
        if name == "session_expand":
            return mcp_tool_result(cmd_expand(argparse.Namespace(session=arguments.get("session", ""), moment=arguments.get("moment", ""), before=arguments.get("before", 3), after=arguments.get("after", 3))))
        if name == "session_resume":
            return mcp_tool_result(cmd_resume(argparse.Namespace(session=arguments.get("session", ""))))
        if name == "session_query":
            return mcp_tool_result(cmd_query_session(argparse.Namespace(session=arguments.get("session", ""), query=arguments.get("query", ""))))
        if name == "session_status":
            return mcp_tool_result(cmd_status(argparse.Namespace()))
        if name == "session_manage":
            return mcp_tool_result(cmd_manage(argparse.Namespace(action=arguments.get("action", ""), session=arguments.get("session"), source=arguments.get("source"))))
        raise SessionHistoryError("invalid_request", f"Unknown tool: {name}")
    except SessionHistoryError as exc:
        return mcp_tool_result(tool_error(exc.code, exc.message), is_error=True)


def handle_mcp_request(request: dict[str, Any]) -> dict[str, Any] | None:
    method = request.get("method")
    request_id = request.get("id")
    if method == "notifications/initialized":
        return None
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "session-history", "version": "0.1.0"}}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": [
            {"name": "session_recall", "description": "Search session history", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "integer"}, "mode": {"type": "string"}}, "required": ["query"]}},
            {"name": "session_inspect", "description": "Inspect a session moment", "inputSchema": {"type": "object", "properties": {"session": {"type": "string"}, "moment": {"type": "string"}}, "required": ["session", "moment"]}},
            {"name": "session_expand", "description": "Expand session context", "inputSchema": {"type": "object", "properties": {"session": {"type": "string"}, "moment": {"type": "string"}, "before": {"type": "integer"}, "after": {"type": "integer"}}, "required": ["session", "moment"]}},
            {"name": "session_resume", "description": "Resume a prior session", "inputSchema": {"type": "object", "properties": {"session": {"type": "string"}}, "required": ["session"]}},
            {"name": "session_query", "description": "Query within one session", "inputSchema": {"type": "object", "properties": {"session": {"type": "string"}, "query": {"type": "string"}}, "required": ["session", "query"]}},
            {"name": "session_status", "description": "Report session history status", "inputSchema": {"type": "object", "properties": {}}},
            {"name": "session_manage", "description": "Manage session history lifecycle", "inputSchema": {"type": "object", "properties": {"action": {"type": "string"}, "session": {"type": "string"}, "source": {"type": "string"}}, "required": ["action"]}},
        ]}}
    if method == "tools/call":
        params = request.get("params") if isinstance(request.get("params"), dict) else {}
        if not mcp_authenticated(params):
            return {"jsonrpc": "2.0", "id": request_id, "result": mcp_tool_result(tool_error("denied", "MCP authentication required"), is_error=True)}
        name = str(params.get("name") or "")
        arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
        return {"jsonrpc": "2.0", "id": request_id, "result": dispatch_mcp_tool(name, arguments)}
    if request_id is None:
        return None
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}


def cmd_mcp(_args: argparse.Namespace) -> None:
    for line in sys.stdin:
        raw = line.strip()
        if not raw:
            continue
        request = json.loads(raw)
        response = handle_mcp_request(request)
        if response is not None:
            print(json.dumps(response, ensure_ascii=False), flush=True)


def cmd_search_alias(args: argparse.Namespace) -> dict[str, Any]:
    recall_args = argparse.Namespace(
        query=args.query,
        limit=args.limit if args.limit is not None else DEFAULT_RECALL_LIMIT,
        lexical_only=False,
        hybrid=True,
        json=args.json,
    )
    return cmd_recall(recall_args)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="session-history")
    subparsers = parser.add_subparsers(dest="command", required=True)

    search = subparsers.add_parser("search", help="Deprecated alias for recall")
    search.add_argument("query")
    search.add_argument("--limit", type=int, default=None)
    search.add_argument("--agent", action="store_true")
    search.add_argument("--json", action="store_true")
    search.set_defaults(func=cmd_search_alias)

    recall = subparsers.add_parser("recall")
    recall.add_argument("--query", required=True)
    recall.add_argument("--limit", type=int, default=DEFAULT_RECALL_LIMIT)
    recall.add_argument("--json", action="store_true")
    mode = recall.add_mutually_exclusive_group()
    mode.add_argument("--hybrid", action="store_true", help="Use hybrid retrieval when available")
    mode.add_argument("--lexical-only", action="store_true", help="Force lexical retrieval")
    recall.set_defaults(func=cmd_recall, hybrid=True, lexical_only=False)

    inspect = subparsers.add_parser("inspect")
    inspect.add_argument("--session", required=True)
    inspect.add_argument("--moment", required=True)
    inspect.add_argument("--json", action="store_true")
    inspect.set_defaults(func=cmd_inspect)

    expand = subparsers.add_parser("expand")
    expand.add_argument("--session", required=True)
    expand.add_argument("--moment", required=True)
    expand.add_argument("--before", type=int, default=None)
    expand.add_argument("--after", type=int, default=None)
    expand.add_argument("--json", action="store_true")
    expand.set_defaults(func=cmd_expand)

    resume = subparsers.add_parser("resume")
    resume.add_argument("--session", required=True)
    resume.add_argument("--json", action="store_true")
    resume.set_defaults(func=cmd_resume)

    query_session = subparsers.add_parser("query-session")
    query_session.add_argument("--session", required=True)
    query_session.add_argument("--query", required=True)
    query_session.add_argument("--json", action="store_true")
    query_session.set_defaults(func=cmd_query_session)

    status = subparsers.add_parser("status")
    status.add_argument("--json", action="store_true")
    status.set_defaults(func=cmd_status)

    manage = subparsers.add_parser("manage")
    manage.add_argument("--action", required=True)
    manage.add_argument("--session", default=None)
    manage.add_argument("--source", default=None)
    manage.add_argument("--json", action="store_true")
    manage.set_defaults(func=cmd_manage)

    mcp = subparsers.add_parser("mcp")
    mcp.set_defaults(func=cmd_mcp)
    return parser


def emit(payload: dict[str, Any], args: argparse.Namespace) -> None:
    if getattr(args, "json", False):
        print(json.dumps(payload, ensure_ascii=False, indent=2))


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "mcp":
        args.func(args)
        return 0
    try:
        if args.command == "recall":
            args.lexical_only = bool(getattr(args, "lexical_only", False))
        payload = args.func(args)
    except SessionHistoryError as exc:
        payload = tool_error(exc.code, exc.message)
        emit(payload, args)
        return 0 if getattr(args, "json", False) else 1
    emit(payload, args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
