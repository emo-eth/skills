from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

from .watchdog import Advisor, Roster

REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["pass", "note"]},
        "severity": {"type": "string", "enum": ["nit", "concern", "blocker"]},
        "note": {"type": "string"},
    },
    "required": ["verdict"],
}

SEVERITY_RANK = {"nit": 0, "concern": 1, "blocker": 2}
SEVERITIES = ("nit", "concern", "blocker")
FOLLOWUP_MARK = "[advisor-profile]"

MAX_USER_MESSAGE_CHARS = 8_000
MAX_RESPONSE_CHARS = 12_000
MAX_HISTORY_MESSAGES = 10
MAX_HISTORY_MESSAGE_CHARS = 600
MAX_REVIEW_INPUT_CHARS = 40_000


@dataclass(frozen=True)
class AdvisorOutcome:
    advisor: str
    state: str
    severity: Optional[str] = None
    note: Optional[str] = None
    error: Optional[str] = None
    model: Optional[str] = None

    @property
    def normalized_note(self) -> str:
        return normalize_note(self.note) if self.note else ""


def normalize_note(text: str) -> str:
    return " ".join(str(text).split())


def followup_text(advisor_name: str, note_text: str) -> str:
    return f"{FOLLOWUP_MARK} {advisor_name}: {note_text}"


class Reviewer:
    def __init__(
        self,
        llm: Any,
        model_override_granted: bool = False,
        provider_override_granted: bool = False,
    ):
        self._llm = llm
        self._model_granted = model_override_granted
        self._provider_granted = provider_override_granted

    def review_turn(
        self,
        roster: Roster,
        selection: Sequence[str],
        user_message: str,
        assistant_response: str,
        conversation_history: Optional[Sequence[Dict[str, Any]]] = None,
    ) -> List[AdvisorOutcome]:
        outcomes: List[AdvisorOutcome] = []
        for name in selection:
            advisor = roster.advisors.get(name)
            if advisor is None:
                outcomes.append(AdvisorOutcome(advisor=name, state="error", error="advisor no longer configured"))
                continue
            outcomes.append(self._review_advisor(roster, advisor, user_message, assistant_response, conversation_history))
        return outcomes

    def _review_advisor(
        self,
        roster: Roster,
        advisor: Advisor,
        user_message: str,
        assistant_response: str,
        conversation_history: Optional[Sequence[Dict[str, Any]]],
    ) -> AdvisorOutcome:
        provider, model = split_model_selector(advisor.model)
        missing_capabilities = []
        if model and not self._model_granted:
            missing_capabilities.append("llm.model_override")
        if provider and not self._provider_granted:
            missing_capabilities.append("llm.provider_override")
        if missing_capabilities:
            return AdvisorOutcome(
                advisor=advisor.name,
                state="no_model",
                model=advisor.model,
                error=f"explicit model requires {', '.join(missing_capabilities)}",
            )
        if self._llm is None:
            return AdvisorOutcome(advisor=advisor.name, state="error", error="host LLM seam unavailable")
        kwargs: Dict[str, Any] = {
            "instructions": build_review_instruction(advisor, roster.instructions),
            "input": [{"type": "text", "text": build_transcript(user_message, assistant_response, conversation_history)}],
            "json_schema": REVIEW_SCHEMA,
            "schema_name": "advisor-profile.review",
            "purpose": "advisor-profile.review",
            "temperature": 0.2,
            "max_tokens": 512,
            "timeout": 90,
        }
        if model:
            kwargs["model"] = model
        if provider:
            kwargs["provider"] = provider
        try:
            result = self._llm.complete_structured(**kwargs)
        except Exception as exc:
            message = str(exc) or type(exc).__name__
            return AdvisorOutcome(advisor=advisor.name, state="error", model=advisor.model, error=message)
        parsed = getattr(result, "parsed", None)
        if parsed is None or not isinstance(parsed, dict):
            return AdvisorOutcome(
                advisor=advisor.name,
                state="error",
                model=advisor.model,
                error="review response was not parseable JSON",
            )
        verdict = parsed.get("verdict")
        if verdict == "pass":
            return AdvisorOutcome(advisor=advisor.name, state="pass", model=advisor.model)
        if verdict == "note":
            note_text = parsed.get("note") or ""
            if not note_text.strip():
                return AdvisorOutcome(advisor=advisor.name, state="pass", model=advisor.model)
            severity = parsed.get("severity") if parsed.get("severity") in SEVERITIES else "nit"
            return AdvisorOutcome(
                advisor=advisor.name,
                state="note",
                severity=severity,
                note=note_text.strip(),
                model=advisor.model,
            )
        return AdvisorOutcome(
            advisor=advisor.name,
            state="error",
            model=advisor.model,
            error=f"unexpected review verdict {verdict!r}",
        )


def split_model_selector(selector: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    if not selector:
        return None, None
    normalized = selector.strip()
    if not normalized:
        return None, None
    if "/" not in normalized:
        return None, normalized
    provider, model = normalized.split("/", 1)
    return provider or None, model or None


def build_review_instruction(advisor: Advisor, shared_instructions: str) -> str:
    parts = [
        f"You are the '{advisor.name}' advisor on Hermes, reviewing the main agent's just-completed turn.",
        shared_instructions,
        advisor.instructions,
        "Return JSON with verdict 'pass' when the turn satisfies your instructions, or 'note' with exactly one note.",
        "Severity 'nit' is optional polish; 'concern' and 'blocker' must name the specific code, behavior, or clause they refer to.",
        "Do not repeat feedback the turn already addressed.",
    ]
    return "\n\n".join(part for part in parts if part and part.strip())


def build_transcript(
    user_message: str,
    assistant_response: str,
    conversation_history: Optional[Sequence[Dict[str, Any]]] = None,
) -> str:
    lines = ["Main agent turn under review:"]
    user = _clip(user_message or "", MAX_USER_MESSAGE_CHARS)
    if user:
        lines.append(f"user: {user}")
    response = _clip(assistant_response or "", MAX_RESPONSE_CHARS)
    if response:
        lines.append(f"assistant: {response}")
    history = list(conversation_history or [])
    if history:
        lines.append("Recent conversation:")
        for entry in history[-MAX_HISTORY_MESSAGES:]:
            role = entry.get("role", "?") if isinstance(entry, dict) else "?"
            content = _content_text(entry.get("content") if isinstance(entry, dict) else entry)
            lines.append(f"{role}: {_clip(content, MAX_HISTORY_MESSAGE_CHARS)}")
    text = "\n".join(lines)
    if len(text) > MAX_REVIEW_INPUT_CHARS:
        text = text[:MAX_REVIEW_INPUT_CHARS] + "\n[transcript truncated]"
    return text


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                if isinstance(block.get("text"), str):
                    parts.append(block["text"])
                elif isinstance(block.get("content"), str):
                    parts.append(block["content"])
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(parts)
    return str(content)


def _clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n[truncated]"
