from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
from typing import Any, Callable, Dict, List, Optional, Sequence, Set, Tuple


@dataclass(frozen=True)
class AdvisorWhen:
    files: Optional[Tuple[str, ...]] = None
    paths: Optional[Tuple[str, ...]] = None
    message_matches: Optional[str] = None


ALLOWED_WHEN_KEYS = {"files", "paths", "message_matches"}


def parse_advisor_when(raw: Any) -> Tuple[Optional[AdvisorWhen], Optional[str]]:
    if raw is None:
        return None, None
    if not isinstance(raw, dict):
        return None, "when must be a mapping"

    for key in raw.keys():
        if key not in ALLOWED_WHEN_KEYS:
            return None, f'unknown key in when: "{key}"'

    files: Optional[Tuple[str, ...]] = None
    if "files" in raw:
        val = raw["files"]
        if isinstance(val, str):
            files = (val.strip(),)
        elif isinstance(val, list):
            if not all(isinstance(item, str) for item in val):
                return None, "when.files must be strings"
            files = tuple(item.strip() for item in val if item.strip())
        else:
            return None, "when.files must be a string or list of strings"

    paths: Optional[Tuple[str, ...]] = None
    if "paths" in raw:
        val = raw["paths"]
        if isinstance(val, str):
            paths = (val.strip(),)
        elif isinstance(val, list):
            if not all(isinstance(item, str) for item in val):
                return None, "when.paths must be strings"
            paths = tuple(item.strip() for item in val if item.strip())
        else:
            return None, "when.paths must be a string or list of strings"

    message_matches: Optional[str] = None
    if "message_matches" in raw:
        val = raw["message_matches"]
        if not isinstance(val, str):
            return None, "when.message_matches must be a string"
        message_matches = val

    return AdvisorWhen(files=files, paths=paths, message_matches=message_matches), None


def normalize_posix_path(raw: str) -> str:
    p = raw.replace("\\", "/").strip()
    if p.startswith("./"):
        p = p[2:]
    p = re.sub(r"/+", "/", p)
    if len(p) > 1 and p.endswith("/"):
        p = p[:-1]
    return p


def glob_to_regex(pattern: str) -> re.Pattern:
    normalized = pattern.replace("\\", "/")
    regex = "^"
    i = 0
    while i < len(normalized):
        if normalized.startswith("**/", i):
            regex += r"(?:.+/)?"
            i += 3
        elif normalized.startswith("/**", i) and i + 3 == len(normalized):
            regex += r"(?:/.*)?"
            i += 3
        elif normalized.startswith("**", i):
            regex += r".*"
            i += 2
        elif normalized[i] == "*":
            regex += r"[^/]*"
            i += 1
        elif normalized[i] == "?":
            regex += r"[^/]"
            i += 1
        elif normalized[i] in "./+^$()[]{}|\\":
            regex += "\\" + normalized[i]
            i += 1
        else:
            regex += normalized[i]
            i += 1
    regex += "$"
    return re.compile(regex)


_PATH_CANDIDATE_RE = re.compile(r"[A-Za-z0-9_.~/\\-]+")
_EXTENSION_RE = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]*[A-Za-z][A-Za-z0-9_.-]*$")
_DOTFILE_RE = re.compile(r"^\.[A-Za-z0-9_-]+$")
_NUMBERS_RE = re.compile(r"^[0-9]+(\.[0-9]+)*$")


def extract_path_tokens(text: str) -> List[str]:
    if not text:
        return []
    tokens: Set[str] = set()
    for match in _PATH_CANDIDATE_RE.finditer(text):
        raw = match.group(0).replace("\\", "/")
        raw = raw.strip("\"'(`<\r\n\t ").rstrip(".,:;!?'\")>`\r\n\t ")
        candidate = normalize_posix_path(raw)
        if not candidate or candidate in (".", "..", "/"):
            continue
        if candidate.startswith("http://") or candidate.startswith("https://"):
            continue
        if _NUMBERS_RE.match(candidate):
            continue
        has_slash = "/" in candidate
        has_extension = bool(_EXTENSION_RE.match(candidate))
        is_dotfile = bool(_DOTFILE_RE.match(candidate))
        if has_slash or has_extension or is_dotfile:
            tokens.add(candidate)
    return sorted(tokens)


def get_ancestor_dirs(start_dir: Path) -> List[Path]:
    ancestors: List[Path] = []
    current = Path(start_dir).resolve()
    home = Path.home().resolve()
    while True:
        ancestors.append(current)
        has_git = (current / ".git").exists()
        if has_git or current == home:
            break
        if current.parent == current:
            break
        current = current.parent
    return ancestors


def match_advisor_when(
    when: Optional[AdvisorWhen],
    cwd: Path,
    last_user_message: Optional[str] = None,
    current_turn_paths: Optional[Sequence[str]] = None,
    current_turn_text: Optional[str] = None,
    loaded_watchdog_dirs: Optional[Sequence[Path]] = None,
    file_exists: Optional[Callable[[Path], bool]] = None,
) -> Tuple[bool, Optional[str]]:
    if when is None:
        return True, None
    has_files = when.files is not None
    has_paths = when.paths is not None
    has_message = when.message_matches is not None
    if not has_files and not has_paths and not has_message:
        return True, None

    exists = file_exists or (lambda p: Path(p).exists())

    if has_files:
        files = when.files or ()
        if not files:
            return False, "when.files: no files configured"
        candidate_dirs: List[Path] = [Path(cwd).resolve()]
        candidate_dirs.extend(get_ancestor_dirs(Path(cwd)))
        if loaded_watchdog_dirs:
            candidate_dirs.extend(Path(d).resolve() for d in loaded_watchdog_dirs)

        matched = False
        for f in files:
            file_path = Path(f)
            if file_path.is_absolute():
                if exists(file_path):
                    matched = True
                    break
            else:
                for d in candidate_dirs:
                    if exists(d / file_path):
                        matched = True
                        break
                if matched:
                    break
        if not matched:
            return False, f"when.files: none of [{', '.join(files)}] exist"

    if has_paths:
        paths = when.paths or ()
        if not paths:
            return False, "when.paths: no paths configured"
        turn_paths: Set[str] = set()
        if current_turn_paths:
            for p in current_turn_paths:
                turn_paths.add(normalize_posix_path(p))
        if current_turn_text:
            for p in extract_path_tokens(current_turn_text):
                turn_paths.add(normalize_posix_path(p))

        matched = False
        for pattern in paths:
            regex = glob_to_regex(pattern)
            if any(regex.match(tp) for tp in turn_paths):
                matched = True
                break
        if not matched:
            return False, f"when.paths: no paths matched [{', '.join(paths)}]"

    if has_message:
        try:
            regex = re.compile(when.message_matches or "")
        except Exception as exc:
            return False, f"when.message_matches: invalid regex ({exc})"
        msg = last_user_message or ""
        if not regex.search(msg):
            return False, f"when.message_matches: user message did not match /{when.message_matches}/"

    return True, None


def format_when(when: Optional[AdvisorWhen]) -> str:
    if not when:
        return "always"
    parts: List[str] = []
    if when.files:
        parts.append(f"files: {', '.join(when.files)}")
    if when.paths:
        parts.append(f"paths: {', '.join(when.paths)}")
    if when.message_matches:
        parts.append(f"message_matches: /{when.message_matches}/")
    return "; ".join(parts) if parts else "always"
