from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

STATE_KEY = "advisor-profiles.v1"
MAX_SESSIONS = 64
MAX_STATUS_PER_SESSION = 20
MAX_SEEN_NOTES = 100
MAX_PENDING_FOLLOWUPS = 3


@dataclass
class SessionData:
    selection: List[str] = field(default_factory=list)
    selection_source: str = "default"
    seen_notes: List[str] = field(default_factory=list)
    pending_followups: List[str] = field(default_factory=list)
    status: List[Dict[str, Any]] = field(default_factory=list)
    initialized: bool = False
    touched: int = 0

    def add_status(self, entry: Dict[str, Any]) -> None:
        self.status.append(entry)

    def record_note(self, normalized: str) -> None:
        self.seen_notes.append(normalized)


class SessionStore:
    def __init__(self, state_facade: Any):
        self._state = state_facade

    def _load(self) -> Dict[str, Any]:
        raw = self._state.get(STATE_KEY, {})
        return raw if isinstance(raw, dict) else {}

    def set_pending(self, action: Dict[str, Any]) -> None:
        data = self._load()
        data["pending"] = action
        self._state.set(STATE_KEY, data)

    def take_pending(self) -> Optional[Dict[str, Any]]:
        data = self._load()
        pending = data.pop("pending", None)
        self._state.set(STATE_KEY, data)
        return pending if isinstance(pending, dict) else None

    def prune_selections(self, valid_names: List[str]) -> None:
        data = self._load()
        sessions = data.get("sessions")
        if not isinstance(sessions, dict):
            return
        valid = set(valid_names)
        changed = False
        for entry in sessions.values():
            if not isinstance(entry, dict):
                continue
            selection = entry.get("selection")
            if not isinstance(selection, list):
                continue
            kept = [str(name) for name in selection if str(name) in valid]
            if kept != selection:
                entry["selection"] = kept
                changed = True
        if changed:
            self._save(data)

    def mutate(self, session_id: str, defaults: List[str], fn: Callable[[SessionData], None]) -> SessionData:
        data = self._load()
        sessions = data.get("sessions")
        if not isinstance(sessions, dict):
            sessions = {}
        raw_entry = sessions.get(session_id)
        if raw_entry is None or not isinstance(raw_entry, dict) or not raw_entry.get("initialized"):
            session = self._fresh(defaults, data.get("pending"))
            data.pop("pending", None)
        else:
            session = self._from_dict(raw_entry)
        fn(session)
        session.initialized = True
        session.touched = int(time.time())
        sessions[session_id] = self._to_dict(session)
        data["sessions"] = _bound_sessions(sessions, session_id)
        self._save(data)
        return session

    def _fresh(self, defaults: List[str], pending: Any) -> SessionData:
        if isinstance(pending, dict) and isinstance(pending.get("selection"), list):
            return SessionData(
                selection=[str(name) for name in pending["selection"]],
                selection_source=str(pending.get("source") or "use"),
            )
        return SessionData(selection=list(defaults), selection_source="default")

    def _from_dict(self, raw: Dict[str, Any]) -> SessionData:
        selection = raw.get("selection")
        seen = raw.get("seen_notes")
        pending = raw.get("pending_followups")
        status = raw.get("status")
        return SessionData(
            selection=[str(name) for name in selection] if isinstance(selection, list) else [],
            selection_source=str(raw.get("selection_source") or "default"),
            seen_notes=[str(note) for note in seen] if isinstance(seen, list) else [],
            pending_followups=[str(message) for message in pending] if isinstance(pending, list) else [],
            status=[entry for entry in status if isinstance(entry, dict)] if isinstance(status, list) else [],
            initialized=bool(raw.get("initialized")),
            touched=int(raw.get("touched") or 0),
        )

    def _to_dict(self, session: SessionData) -> Dict[str, Any]:
        return {
            "selection": session.selection,
            "selection_source": session.selection_source,
            "seen_notes": session.seen_notes[-MAX_SEEN_NOTES:],
            "pending_followups": session.pending_followups[-MAX_PENDING_FOLLOWUPS:],
            "status": session.status[-MAX_STATUS_PER_SESSION:],
            "initialized": session.initialized,
            "touched": session.touched,
        }

    def _save(self, data: Dict[str, Any]) -> None:
        while True:
            try:
                self._state.set(STATE_KEY, data)
                return
            except Exception:
                sessions = data.get("sessions")
                if not isinstance(sessions, dict) or not sessions:
                    raise
                oldest = min(sessions, key=lambda sid: _touched(sessions[sid]))
                del sessions[oldest]


def _bound_sessions(sessions: Dict[str, Any], keep: str) -> Dict[str, Any]:
    if len(sessions) <= MAX_SESSIONS:
        return sessions
    others = sorted(
        (sid for sid in sessions if sid != keep),
        key=lambda sid: _touched(sessions[sid]),
        reverse=True,
    )
    bounded: Dict[str, Any] = {keep: sessions[keep]}
    for sid in others[: MAX_SESSIONS - 1]:
        bounded[sid] = sessions[sid]
    return bounded


def _touched(entry: Any) -> int:
    return int(entry.get("touched") or 0) if isinstance(entry, dict) else 0
