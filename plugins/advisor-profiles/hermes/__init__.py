from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from . import render, review, session, watchdog
from .review import AdvisorOutcome, Reviewer
from .session import SessionData, SessionStore

COMMAND_DESCRIPTION = "Advisor profiles: status|list|use <name>|all|off|reload"
COMMAND_ARGS_HINT = "status|list|use <name>|all|off|reload"
MAX_ACTIVE_SESSIONS = 32


class AdvisorProfilesPlugin:
    def __init__(self, ctx: Any):
        self._ctx = ctx
        self._home = watchdog.hermes_home()
        self._roster = watchdog.load_roster(self._home, watchdog.cwd())
        self._model_override_granted = self._probe_capability(ctx, "llm.model_override")
        self._provider_override_granted = self._probe_capability(ctx, "llm.provider_override")
        self._llm = getattr(ctx, "llm", None)
        self._store = SessionStore(ctx.state)
        self._reviewer = Reviewer(
            self._llm,
            self._model_override_granted,
            self._provider_override_granted,
        )
        self._active: Dict[str, int] = {}
        self._clock = 0

    def register(self) -> None:
        self._ctx.register_hook("post_llm_call", self._on_post_llm_call)
        self._ctx.register_hook("on_session_start", self._on_session_start)
        self._ctx.register_command(
            "advisor-profile",
            self._handle_command,
            description=COMMAND_DESCRIPTION,
            args_hint=COMMAND_ARGS_HINT,
        )

    def _probe_capability(self, ctx: Any, capability: str) -> bool:
        probe = getattr(ctx, "has_capability", None)
        if not callable(probe):
            return False
        try:
            return bool(probe(capability))
        except Exception:
            return False

    def _on_session_start(self, session_id: Optional[str] = None, **kwargs: Any) -> None:
        try:
            if not session_id:
                return
            self._note_active(session_id)
            self._ensure_session(session_id)
        except Exception:
            return

    def _on_post_llm_call(
        self,
        session_id: Optional[str] = None,
        user_message: Optional[str] = None,
        assistant_response: Optional[str] = None,
        conversation_history: Optional[List[Dict[str, Any]]] = None,
        **kwargs: Any,
    ) -> None:
        try:
            if not session_id:
                return
            self._note_active(session_id)
            data = self._ensure_session(session_id)
            user_msg = user_message or ""
            if self._is_correction_turn(user_msg, data):
                self._record_correction(session_id, user_msg)
                return
            if not data.selection or not self._roster.advisors:
                return
            outcomes = self._reviewer.review_turn(
                self._roster,
                data.selection,
                user_msg,
                assistant_response or "",
                conversation_history,
            )
            self._apply_outcomes(session_id, data, outcomes)
        except Exception as exc:
            self._record_hook_failure(session_id, exc)

    def _is_correction_turn(self, user_msg: str, data: SessionData) -> bool:
        return user_msg in data.pending_followups or user_msg.startswith(review.FOLLOWUP_MARK)

    def _record_correction(self, session_id: str, user_msg: str) -> None:
        def apply(data: SessionData) -> None:
            data.pending_followups = [message for message in data.pending_followups if message != user_msg]
            data.add_status({"advisor": "", "state": "correction", "ts": self._tick()})

        self._apply(session_id, apply)

    def _apply_outcomes(self, session_id: str, snapshot: SessionData, outcomes: List[AdvisorOutcome]) -> None:
        candidates = self._injection_candidates(outcomes, snapshot)
        injected = False

        def apply(data: SessionData) -> None:
            nonlocal injected
            for outcome in outcomes:
                data.add_status(self._outcome_entry(outcome))
            for outcome in candidates:
                normalized = outcome.normalized_note
                if normalized in data.seen_notes:
                    data.add_status(
                        {
                            "advisor": outcome.advisor,
                            "state": "duplicate",
                            "severity": outcome.severity,
                            "ts": self._tick(),
                        }
                    )
                    continue
                if injected:
                    continue
                message = review.followup_text(outcome.advisor, outcome.note or "")
                delivered = self._deliver_followup(message)
                if delivered:
                    data.pending_followups.append(message)
                    data.record_note(normalized)
                data.add_status(
                    {
                        "advisor": outcome.advisor,
                        "state": "followup",
                        "severity": outcome.severity,
                        "delivered": delivered,
                        "ts": self._tick(),
                    }
                )
                injected = True

        self._apply(session_id, apply)

    def _injection_candidates(self, outcomes: List[AdvisorOutcome], snapshot: SessionData) -> List[AdvisorOutcome]:
        candidates = [
            outcome
            for outcome in outcomes
            if outcome.state == "note"
            and outcome.severity in ("concern", "blocker")
            and outcome.normalized_note
            and outcome.normalized_note not in snapshot.seen_notes
        ]

        def rank(outcome: AdvisorOutcome) -> tuple:
            return (-review.SEVERITY_RANK[outcome.severity], self._selection_index(snapshot, outcome.advisor))

        candidates.sort(key=rank)
        return candidates

    def _selection_index(self, snapshot: SessionData, name: str) -> int:
        try:
            return snapshot.selection.index(name)
        except ValueError:
            return len(snapshot.selection)

    def _outcome_entry(self, outcome: AdvisorOutcome) -> Dict[str, Any]:
        entry: Dict[str, Any] = {"advisor": outcome.advisor, "state": outcome.state, "ts": self._tick()}
        if outcome.severity:
            entry["severity"] = outcome.severity
        if outcome.note:
            entry["note"] = outcome.note
        if outcome.error:
            entry["error"] = outcome.error
        if outcome.model:
            entry["model"] = outcome.model
        return entry

    def _deliver_followup(self, message: str) -> bool:
        try:
            return bool(self._ctx.inject_message(message, role="user"))
        except Exception:
            return False

    def _record_hook_failure(self, session_id: Optional[str], exc: Exception) -> None:
        if not session_id:
            return

        def apply(data: SessionData) -> None:
            data.add_status({"advisor": "", "state": "error", "error": f"review hook failed: {exc}", "ts": self._tick()})

        try:
            self._apply(session_id, apply)
        except Exception:
            return

    def _handle_command(self, raw_args: str) -> str:
        try:
            return self._dispatch(raw_args or "")
        except Exception as exc:
            return f"advisor-profile error: {exc}"

    def _dispatch(self, raw_args: str) -> str:
        args = raw_args.strip()
        if not args or args == "help":
            return render.render_usage()
        if args == "status":
            session_id = self._resolve_session_id()
            if session_id is None:
                return "No active session yet; run a turn first, then /advisor-profile status."
            data = self._ensure_session(session_id)
            return render.render_status(
                self._roster,
                data,
                self._model_override_granted,
                self._provider_override_granted,
            )
        if args == "list":
            return render.render_list(self._roster)
        if args == "all":
            return self._use("all")
        if args == "off":
            return self._set_selection([], "off")
        if args == "reload":
            previous = set(self._roster.files)
            self._roster = watchdog.load_roster(self._home, watchdog.cwd())
            self._store.prune_selections(list(self._roster.advisors))
            return render.render_reload(self._roster, previous)
        if args.startswith("use "):
            name = args[4:].strip()
            if not name:
                return render.render_usage()
            return self._use(name)
        return render.render_usage()

    def _use(self, name: str) -> str:
        if name == "all":
            names = self._roster.enabled_advisors()
            if not names:
                return "No enabled advisors configured."
            return self._set_selection(names, "use")
        slug = watchdog.slugify(name)
        if slug not in self._roster.advisors:
            known = ", ".join(sorted(advisor.name for advisor in self._roster.advisors.values())) or "(none)"
            return f"Unknown advisor '{name}'. Known advisors: {known}"
        return self._set_selection([slug], "use")

    def _set_selection(self, names: List[str], source: str) -> str:
        session_id = self._resolve_session_id()
        if session_id is None:
            self._store.set_pending({"selection": names, "source": source})
            return "No active session yet; selection will apply when the next session activates."

        def apply(s: SessionData) -> None:
            s.selection = list(names)
            s.selection_source = source

        self._apply(session_id, apply)
        if not names:
            return "Advisor review is off for this session."
        return f"Advisor review: {', '.join(names)}"

    def _resolve_session_id(self) -> Optional[str]:
        if not self._active:
            return None
        return max(self._active, key=self._active.get)

    def _note_active(self, session_id: str) -> None:
        self._clock += 1
        self._active[session_id] = self._clock
        if len(self._active) > MAX_ACTIVE_SESSIONS:
            oldest = min(self._active, key=self._active.get)
            del self._active[oldest]

    def _ensure_session(self, session_id: str) -> SessionData:
        return self._apply(session_id, lambda s: None)

    def _apply(self, session_id: str, fn: Callable[[SessionData], None]) -> SessionData:
        return self._store.mutate(session_id, self._roster.enabled_advisors(), fn)

    def _tick(self) -> int:
        self._clock += 1
        return self._clock


def register(ctx: Any) -> None:
    AdvisorProfilesPlugin(ctx).register()
