from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import yaml

WATCHDOG_FILENAME = "WATCHDOG.yml"
MAX_IMPORT_CHARS = 40_000
MAX_IMPORTS_PER_FILE = 8
MAX_INSTRUCTIONS_CHARS = 60_000
_IMPORT_TOKEN = re.compile(r"@([^\s@]+)")
_TRAILING_PUNCT = ".,;:!?)]}\"'"
_SLUG_CLEAN = re.compile(r"[^a-z0-9]+")


def slugify(name: str) -> str:
    slug = _SLUG_CLEAN.sub("-", str(name).lower()).strip("-")
    return slug or "advisor"


@dataclass(frozen=True)
class Advisor:
    name: str
    slug: str = field(init=False)
    instructions: str = ""
    model: Optional[str] = None
    tools: Tuple[str, ...] = ()
    enabled: bool = True

    def __post_init__(self) -> None:
        object.__setattr__(self, "slug", slugify(self.name))


@dataclass(frozen=True)
class Roster:
    advisors: Dict[str, Advisor] = field(default_factory=dict)
    instructions: str = ""
    files: Tuple[str, ...] = ()
    warnings: Tuple[str, ...] = ()

    def enabled_advisors(self) -> List[str]:
        return [slug for slug, advisor in self.advisors.items() if advisor.enabled]


def hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


def cwd() -> Path:
    return Path.cwd()


def load_roster(home_dir: Path, work_dir: Path, read_text: Optional[Callable[[Path], str]] = None) -> Roster:
    reader = read_text or _default_read
    advisors: Dict[str, Advisor] = {}
    shared_parts: List[str] = []
    warnings: List[str] = []
    files: List[str] = []
    for path in discover_config_files(home_dir, work_dir):
        file_advisors, shared, file_warnings = parse_watchdog(path, reader)
        advisors.update(file_advisors)
        if shared.strip():
            shared_parts.append(shared.strip())
        warnings.extend(file_warnings)
        files.append(str(path))
    return Roster(
        advisors=advisors,
        instructions="\n\n".join(shared_parts),
        files=tuple(files),
        warnings=tuple(warnings),
    )


def discover_config_files(home_dir: Path, work_dir: Path) -> List[Path]:
    candidate_dirs = [Path(home_dir)]
    candidate_dirs.extend(reversed(list(_ancestors(Path(work_dir)))))
    seen: set[str] = set()
    found: List[Path] = []
    for directory in candidate_dirs:
        candidate = directory / WATCHDOG_FILENAME
        resolved = str(candidate.resolve())
        if resolved in seen:
            continue
        seen.add(resolved)
        if candidate.is_file():
            found.append(candidate)
    return found


def _ancestors(start: Path) -> List[Path]:
    chain: List[Path] = []
    current = start
    while True:
        chain.append(current)
        if current.parent == current:
            return chain
        current = current.parent


def parse_watchdog(path: Path, read_text: Callable[[Path], str]) -> Tuple[Dict[str, Advisor], str, List[str]]:
    try:
        raw = yaml.safe_load(read_text(path))
    except Exception as exc:
        return {}, "", [f"{path.name}: invalid YAML: {exc}"]
    if raw is None:
        return {}, "", []
    if not isinstance(raw, dict):
        return {}, "", [f"{path.name}: top level must be a mapping"]
    warnings: List[str] = []
    base_dir = path.resolve().parent
    shared = _expand_imports(_as_text(raw.get("instructions", "")), base_dir, read_text, warnings, path)
    advisors: Dict[str, Advisor] = {}
    raw_advisors = raw.get("advisors")
    if raw_advisors is None:
        return advisors, shared, warnings
    if not isinstance(raw_advisors, list):
        warnings.append(f"{path.name}: 'advisors' must be a list")
        return advisors, shared, warnings
    for entry in raw_advisors:
        if not isinstance(entry, dict):
            warnings.append(f"{path.name}: advisor entry must be a mapping")
            continue
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            warnings.append(f"{path.name}: advisor entry is missing a 'name'")
            continue
        name = name.strip()
        model = entry.get("model")
        if model is not None and not isinstance(model, str):
            warnings.append(f"{path.name}: advisor '{name}' model must be a string")
            model = None
        tools: Tuple[str, ...] = ()
        raw_tools = entry.get("tools")
        if raw_tools is not None:
            if isinstance(raw_tools, list):
                tools = tuple(str(tool) for tool in raw_tools if isinstance(tool, str))
                if len(tools) != len(raw_tools):
                    warnings.append(f"{path.name}: advisor '{name}' tools must be strings")
            else:
                warnings.append(f"{path.name}: advisor '{name}' tools must be a list")
        instructions = _expand_imports(_as_text(entry.get("instructions", "")), base_dir, read_text, warnings, path)
        enabled = entry.get("enabled", True)
        if not isinstance(enabled, bool):
            enabled = True
        advisor = Advisor(name=name, model=model, tools=tools, instructions=instructions, enabled=enabled)
        advisors[advisor.slug] = advisor
    return advisors, shared, warnings


def _as_text(value: object) -> str:
    return value if isinstance(value, str) else str(value)


def _default_read(path: Path) -> str:
    return Path(path).read_text(encoding="utf-8", errors="replace")


def _expand_imports(text: str, base_dir: Path, read_text: Callable[[Path], str], warnings: List[str], source: Path) -> str:
    if not text or "@" not in text:
        return text
    result: List[str] = []
    last = 0
    count = 0
    for match in _IMPORT_TOKEN.finditer(text):
        result.append(text[last:match.start()])
        last = match.end()
        token = match.group(1)
        count += 1
        if count > MAX_IMPORTS_PER_FILE:
            warnings.append(f"{source.name}: import limit of {MAX_IMPORTS_PER_FILE} exceeded; remaining tokens left literal")
            result.append(match.group(0))
            continue
        target = _resolve_import(token, base_dir)
        if target is None:
            warnings.append(f"{source.name}: cannot resolve import {token!r}")
            result.append(match.group(0))
            continue
        try:
            content = read_text(target)
        except Exception as exc:
            warnings.append(f"{source.name}: cannot read import {token!r}: {exc}")
            result.append(match.group(0))
            continue
        if len(content) > MAX_IMPORT_CHARS:
            content = content[:MAX_IMPORT_CHARS] + "\n[truncated]"
        result.append(content)
    result.append(text[last:])
    joined = "".join(result)
    if len(joined) > MAX_INSTRUCTIONS_CHARS:
        joined = joined[:MAX_INSTRUCTIONS_CHARS] + "\n[instructions truncated]"
    return joined


def _resolve_import(token: str, base_dir: Path) -> Optional[Path]:
    candidates = [token]
    stripped = token.rstrip(_TRAILING_PUNCT)
    if stripped != token:
        candidates.append(stripped)
    for candidate in candidates:
        target = base_dir / candidate
        if target.is_file():
            return target
    return None
