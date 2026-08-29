from __future__ import annotations

from typing import Any, Dict, Iterable, List

from .session import SessionData
from .watchdog import Roster

USAGE = (
    "Usage: /advisor-profile <command>\n"
    "  status            per-advisor review state and recent notes\n"
    "  list              configured advisors (WATCHDOG.yml roster)\n"
    "  use <name>        select one advisor for this session\n"
    "  use all / all     select every enabled advisor\n"
    "  off               disable advisor reviews for this session\n"
    "  reload            re-read WATCHDOG.yml files"
)


def render_usage() -> str:
    return USAGE


def render_status(
    roster: Roster,
    session: SessionData,
    model_override_granted: bool,
    provider_override_granted: bool,
) -> str:
    lines: List[str] = []
    selection = list(session.selection)
    if not selection:
        lines.append("Advisor review: off")
    elif session.selection_source == "default" and sorted(selection) == sorted(roster.enabled_advisors()):
        lines.append(f"Advisor review: all enabled ({len(selection)} advisors)")
    else:
        lines.append(f"Advisor review: {', '.join(_display(roster, slug) for slug in selection)}")
    granted = []
    if model_override_granted:
        granted.append("llm.model_override")
    if provider_override_granted:
        granted.append("llm.provider_override")
    if granted:
        lines.append(f"Explicit advisor routing capabilities: {', '.join(granted)} granted")
    else:
        lines.append("Explicit advisor routing blocked; explicit model requests show as no_model")
    tooled = [advisor.name for advisor in roster.advisors.values() if advisor.tools]
    if tooled:
        lines.append(f"Advisor tools ({', '.join(tooled)}): OMP-only, no tool loop on Hermes — unsupported")
    if not roster.advisors:
        lines.append("No advisors configured: add an 'advisors' list to WATCHDOG.yml (see /advisor-profile list).")
    for warning in roster.warnings:
        lines.append(f"Roster warning: {warning}")
    if session.status:
        lines.append("Recent reviews (newest first):")
        for entry in reversed(session.status):
            lines.append(_status_line(roster, entry))
    else:
        lines.append("No reviews yet this session.")
    return "\n".join(lines)


def _status_line(roster: Roster, entry: Dict[str, Any]) -> str:
    advisor = _display(roster, entry.get("advisor") or "-")
    state = entry.get("state") or "?"
    if state == "pass":
        return f"  {advisor}: pass"
    if state == "note":
        return f"  {advisor}: {entry.get('severity') or 'nit'} — {entry.get('note') or ''}"
    if state == "duplicate":
        return f"  {advisor}: duplicate note suppressed ({entry.get('severity') or 'nit'})"
    if state == "no_model":
        model = entry.get("model") or "?"
        return f"  {advisor}: no_model ({model}) — {entry.get('error') or 'explicit model not granted'}"
    if state == "error":
        return f"  {advisor}: error — {entry.get('error') or 'review failed'}"
    if state == "correction":
        return "  generated follow-up turn (not re-reviewed)"
    if state == "followup":
        delivered = entry.get("delivered")
        detail = "delivered" if delivered else "delivery failed"
        return f"  {advisor}: {entry.get('severity') or 'concern'} follow-up {detail}"
    return f"  {advisor}: {state}"


def render_list(roster: Roster) -> str:
    lines: List[str] = []
    if not roster.advisors:
        lines.append("No advisors configured.")
        lines.append("Create WATCHDOG.yml in HERMES_HOME, a project ancestor, or the project root:")
        lines.append("  advisors:")
        lines.append("    - name: vibe")
        lines.append("      instructions: ...")
        return "\n".join(lines)
    for advisor in sorted(roster.advisors.values(), key=lambda advisor: advisor.name):
        flags: List[str] = []
        flags.append("enabled" if advisor.enabled else "disabled")
        if advisor.model:
            flags.append(f"model {advisor.model}")
        if advisor.tools:
            flags.append(f"tools [{', '.join(advisor.tools)}] (OMP-only, unsupported on Hermes)")
        label = advisor.name
        if advisor.slug != advisor.name:
            label = f"{advisor.name} (slug {advisor.slug})"
        lines.append(f"{label}: {', '.join(flags)}")
    if roster.files:
        lines.append(f"Sources ({len(roster.files)}): {', '.join(roster.files)}")
    if roster.warnings:
        for warning in roster.warnings:
            lines.append(f"Roster warning: {warning}")
    lines.append("Selection is session-scoped: /advisor-profile use <name>|all|off")
    return "\n".join(lines)


def render_reload(roster: Roster, previous_files: Iterable[str]) -> str:
    lines: List[str] = []
    if not roster.advisors:
        lines.append("Reloaded: no advisors configured.")
    else:
        names = ", ".join(sorted(advisor.name for advisor in roster.advisors.values()))
        lines.append(f"Reloaded {len(roster.advisors)} advisor(s): {names}")
    added = [path for path in roster.files if path not in set(previous_files)]
    removed = [path for path in previous_files if path not in set(roster.files)]
    if added:
        lines.append(f"New sources: {', '.join(added)}")
    if removed:
        lines.append(f"Gone: {', '.join(removed)}")
    for warning in roster.warnings:
        lines.append(f"Roster warning: {warning}")
    return "\n".join(lines)


def _display(roster: Roster, slug: str) -> str:
    advisor = roster.advisors.get(slug)
    return advisor.name if advisor else slug
