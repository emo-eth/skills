from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any

NO_CODE_COMMENTS_PROMPT = (
    "No-code-comments is active. Write self-explanatory code without prose comments. "
    "Semantic directives, shebangs, compiler annotations, and source-map directives are allowed. "
    "The host strips comments from write and replacement payloads before execution."
)

_FAMILY_BY_EXTENSION = {
    **{ext: "c" for ext in (
        ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".m", ".mm", ".cs", ".java",
        ".kt", ".kts", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".css", ".scss",
        ".sass", ".less", ".go", ".rs", ".swift", ".scala", ".dart", ".php", ".proto", ".sol",
    )},
    **{ext: "hash" for ext in (
        ".py", ".pyi", ".rb", ".sh", ".bash", ".zsh", ".fish", ".pl", ".pm", ".r",
        ".yaml", ".yml", ".toml", ".ps1",
    )},
    **{ext: "html" for ext in (".html", ".htm", ".xml", ".svg", ".vue", ".svelte")},
    ".sql": "sql",
    ".lua": "lua",
    ".hs": "haskell",
    ".lhs": "haskell",
}
_SPECIAL_NAMES = {name: "hash" for name in ("Dockerfile", "Makefile", "Rakefile", "Gemfile")}
_LIKELY_COMMENT = re.compile(r"(^|\s)(?://|/\*|#|--|<!--)", re.MULTILINE)


@dataclass(frozen=True)
class StripResult:
    content: str
    removed: int
    supported: bool


@dataclass(frozen=True)
class RewriteResult:
    args: dict[str, Any] | None = None
    block: bool = False
    reason: str | None = None
    removed: int = 0


def strip_code_comments(content: str, path: str) -> StripResult:
    family = _family_for(path)
    if family is None:
        return StripResult(content, 0, False)
    if family == "hash":
        return _strip_hash_comments(content, path)
    if family == "html":
        return _strip_html_comments(content)
    if family == "sql":
        return _strip_delimited(content, path, "--", "/*", "*/", False)
    if family == "lua":
        return _strip_delimited(content, path, "--", "--[[", "]]", False)
    if family == "haskell":
        return _strip_delimited(content, path, "--", "{-", "-}", False)
    return _strip_delimited(content, path, "//", "/*", "*/", True)


def rewrite_tool_args(tool_name: str, args: dict[str, Any]) -> RewriteResult:
    if tool_name == "write_file":
        return _rewrite_write(args)
    if tool_name == "patch":
        return _rewrite_patch(args)
    return RewriteResult()


def block_reason(tool_name: str, args: dict[str, Any]) -> str | None:
    result = rewrite_tool_args(tool_name, args)
    return result.reason if result.block else None


def _rewrite_write(args: dict[str, Any]) -> RewriteResult:
    path = args.get("path")
    content = args.get("content")
    if not isinstance(path, str) or not isinstance(content, str):
        return RewriteResult()
    return _rewrite_field(args, "content", content, path)


def _rewrite_patch(args: dict[str, Any]) -> RewriteResult:
    mode = args.get("mode")
    if mode == "replace":
        path = args.get("path")
        value = args.get("new_string")
        if not isinstance(path, str) or not isinstance(value, str):
            return RewriteResult()
        return _rewrite_field(args, "new_string", value, path)
    if mode == "patch":
        value = args.get("patch")
        if not isinstance(value, str):
            return RewriteResult()
        result = _strip_patch_input(value)
        if result.block or result.args is None:
            return result
        updated = dict(args)
        updated["patch"] = result.args["patch"]
        return RewriteResult(updated, removed=result.removed)
    return RewriteResult()


def _rewrite_field(args: dict[str, Any], field: str, value: str, path: str) -> RewriteResult:
    result = strip_code_comments(value, path)
    if not result.supported and _LIKELY_COMMENT.search(value):
        return _unsupported(path)
    if result.content == value:
        return RewriteResult()
    updated = dict(args)
    updated[field] = result.content
    return RewriteResult(updated, removed=result.removed)


def _strip_patch_input(value: str) -> RewriteResult:
    lines = value.split("\n")
    current_path: str | None = None
    removed = 0
    index = 0
    while index < len(lines):
        match = re.match(r"^\*\*\* (?:Add|Update) File:\s+(.+)$", lines[index])
        if match:
            current_path = match.group(1).strip()
        if current_path is None or not _is_added_line(lines[index]):
            index += 1
            continue
        start = index
        bodies: list[str] = []
        while index < len(lines) and _is_added_line(lines[index]):
            bodies.append(lines[index][1:])
            index += 1
        source = "\n".join(bodies)
        result = strip_code_comments(source, current_path)
        if not result.supported and _LIKELY_COMMENT.search(source):
            return _unsupported(current_path)
        rewritten = result.content.split("\n")
        if len(rewritten) != len(bodies):
            return RewriteResult(
                block=True,
                reason=f"No-code-comments could not safely preserve patch line structure for {current_path}. Retry with comment-free code.",
                removed=removed,
            )
        for offset, line in enumerate(rewritten):
            lines[start + offset] = f"+{line}"
        removed += result.removed
    content = "\n".join(lines)
    if content == value:
        return RewriteResult()
    return RewriteResult({"patch": content}, removed=removed)


def _is_added_line(line: str) -> bool:
    return line.startswith("+") and not line.startswith("+++")


def _unsupported(path: str) -> RewriteResult:
    return RewriteResult(
        block=True,
        reason=f"No-code-comments cannot safely classify comments for {path}. Retry using a supported code extension or write comment-free content.",
    )


def _family_for(path: str) -> str | None:
    name = path.replace("\\", "/").rsplit("/", 1)[-1]
    return _SPECIAL_NAMES.get(name) or _FAMILY_BY_EXTENSION.get(os.path.splitext(name)[1].lower())


def _strip_hash_comments(content: str, path: str) -> StripResult:
    output: list[str] = []
    removed = 0
    for index, line in enumerate(content.splitlines(keepends=True)):
        newline = "\n" if line.endswith("\n") else ""
        body = line[:-1] if newline else line
        position = _hash_comment_start(body)
        if position < 0:
            output.append(line)
            continue
        raw = body[position:]
        if _is_directive(raw, path, index):
            output.append(line)
            continue
        output.append(body[:position].rstrip() + newline)
        removed += 1
    return StripResult("".join(output), removed, True)


def _hash_comment_start(line: str) -> int:
    quote: str | None = None
    escaped = False
    for index, char in enumerate(line):
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in ("'", '"', "`"):
            quote = char
        elif char == "#":
            return index
    return -1


def _strip_html_comments(content: str) -> StripResult:
    output: list[str] = []
    cursor = 0
    removed = 0
    while cursor < len(content):
        start = content.find("<!--", cursor)
        if start < 0:
            output.append(content[cursor:])
            break
        end = content.find("-->", start + 4)
        if end < 0:
            output.append(content[cursor:])
            break
        raw = content[start:end + 3]
        if _is_directive(raw, "markup", 0):
            output.append(content[cursor:end + 3])
        else:
            output.append(content[cursor:start] + _blank_comment(raw))
            removed += 1
        cursor = end + 3
    return StripResult("".join(output), removed, True)


def _strip_delimited(content: str, path: str, line_open: str, block_open: str, block_close: str, regex_aware: bool) -> StripResult:
    output: list[str] = []
    index = 0
    removed = 0
    quote: str | None = None
    escaped = False
    in_regex = False
    regex_class = False
    previous_significant = ""
    while index < len(content):
        char = content[index]
        if quote:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            index += 1
            continue
        if in_regex:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == "[":
                regex_class = True
            elif char == "]":
                regex_class = False
            elif char == "/" and not regex_class:
                in_regex = False
            index += 1
            continue
        if content.startswith(line_open, index):
            end = content.find("\n", index)
            stop = len(content) if end < 0 else end
            raw = content[index:stop]
            if _is_directive(raw, path, content.count("\n", 0, index)):
                output.append(raw)
            else:
                output = list("".join(output).rstrip())
                removed += 1
            index = stop
            continue
        if content.startswith(block_open, index):
            close = content.find(block_close, index + len(block_open))
            if close < 0:
                output.append(char)
                index += 1
                continue
            stop = close + len(block_close)
            raw = content[index:stop]
            if _is_directive(raw, path, content.count("\n", 0, index)):
                output.append(raw)
            else:
                output.append(_blank_comment(raw))
                removed += 1
            index = stop
            continue
        if char in ("'", '"', "`"):
            quote = char
            output.append(char)
            index += 1
            continue
        if regex_aware and char == "/" and _regex_can_start(previous_significant):
            in_regex = True
            output.append(char)
            index += 1
            continue
        output.append(char)
        if not char.isspace():
            previous_significant = char
        index += 1
    trimmed = "\n".join(line.rstrip() for line in "".join(output).split("\n"))
    return StripResult(trimmed, removed, True)


def _regex_can_start(previous: str) -> bool:
    return previous == "" or previous in "=([{!?:;,>"


def _blank_comment(raw: str) -> str:
    newlines = raw.count("\n")
    return " " if newlines == 0 else "\n" * newlines


def _is_directive(raw: str, path: str, zero_based_line: int) -> bool:
    value = raw.strip()
    if zero_based_line == 0 and value.startswith("#!"):
        return True
    if zero_based_line <= 1 and re.match(r"^#.*(?:coding\s*[:=]|-\*-\s*coding\s*:)", value, re.IGNORECASE):
        return True
    patterns = (
        r"^#\s*(?:type\s*:|noqa\b|pyright\b|mypy\b|ruff\b|pylint\b|fmt\s*:)",
        r"^///\s*<(?:reference|amd-module|amd-dependency)\b",
        r"^//[#@]\s*(?:sourceMappingURL|sourceURL)=",
        r"^//\s*(?:@ts-(?:ignore|expect-error|nocheck|check)\b|eslint-|prettier-ignore\b|c8\s+ignore\b|istanbul\s+ignore\b)",
        r"^//\s*(?:go:|\+build\b|line\b|swift-tools-version\s*:)",
        r"^/\*\s*(?:@jsx\b|@jsxFrag\b|@jsxImportSource\b|@flow\b|#__PURE__|@__PURE__|eslint\b|prettier-ignore\b|istanbul\s+ignore\b)",
        r"^<!--\s*\[(?:if|endif)\b",
        r"^<!--\s*(?:svelte:|vue:)",
    )
    if any(re.match(pattern, value, re.IGNORECASE) for pattern in patterns):
        return True
    return path.lower().endswith(".sql") and bool(re.match(r"^--\s*(?:liquibase|changeset|rollback|flyway:)", value, re.IGNORECASE))
