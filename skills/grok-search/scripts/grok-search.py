#!/usr/bin/env python3
"""grok-search: search X (Twitter) and the web through xAI's server-side tools.

Uses your Grok subscription via the standalone `grok` CLI's OAuth token
(~/.grok/auth.json), or XAI_API_KEY if set. Calls the xAI Responses API
(https://api.x.ai/v1/responses) with the built-in `x_search` / `web_search`
tools -- Grok runs the search server-side and returns a cited answer.

Subcommands:
  x      Search X (Twitter) posts, profiles, and threads.
  web    Search the web.
  ask    Free-form question; Grok picks between X search and web search.
  fetch  Fetch one X post / thread URL and quote its content.
  auth   Show which credential would be used.

No third-party dependencies. Auth lifecycle stays owned by the `grok` CLI:
this script never uses the (single-use) refresh token itself; when the access
token is expired it runs a minimal `grok -p` call so the CLI refreshes and
persists new tokens, then re-reads them.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_BASE = os.environ.get("XAI_BASE_URL", "https://api.x.ai/v1").rstrip("/")
GROK_AUTH_PATH = Path(os.environ.get("GROK_HOME", str(Path.home() / ".grok"))) / "auth.json"
DEFAULT_MODEL = os.environ.get("GROK_SEARCH_MODEL", "grok-4-fast")
DEFAULT_TIMEOUT = 180
MAX_HANDLES = 10
EXPIRY_SKEW_SECONDS = 60


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

def _read_grok_cli_token() -> tuple[str, str] | None:
    """Return (access_token, expires_at_iso) from the grok CLI auth store."""
    try:
        data = json.loads(GROK_AUTH_PATH.read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    for entry in data.values():
        if not isinstance(entry, dict):
            continue
        key = str(entry.get("key") or "").strip()
        if key:
            return key, str(entry.get("expires_at") or "")
    return None


def _token_expired(expires_at: str) -> bool:
    raw = expires_at.strip()
    if not raw:
        return False  # unknown expiry: try it, the 401 path recovers
    try:
        # Truncate fractional seconds of any length; keep the UTC marker.
        base = raw.split(".")[0].rstrip("Z")
        expiry = datetime.strptime(base, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return expiry.timestamp() - EXPIRY_SKEW_SECONDS <= time.time()


def _run_grok_cli_refresh() -> bool:
    """Make the grok CLI refresh its own token (it rewrites auth.json)."""
    grok = shutil.which("grok")
    if not grok:
        return False
    try:
        subprocess.run(
            [grok, "--no-auto-update", "-p", "Reply with exactly: ok"],
            capture_output=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return True


def resolve_bearer(allow_refresh: bool = True) -> tuple[str, str]:
    """Return (bearer, source). source is 'env' or 'grok-cli'."""
    env_key = os.environ.get("XAI_API_KEY", "").strip()
    if env_key:
        return env_key, "env"
    stored = _read_grok_cli_token()
    if stored is not None:
        token, expires_at = stored
        if _token_expired(expires_at) and allow_refresh:
            if _run_grok_cli_refresh():
                fresh = _read_grok_cli_token()
                if fresh is not None:
                    return fresh[0], "grok-cli"
        return token, "grok-cli"
    sys.exit(
        "grok-search: no xAI credentials.\n"
        f"  Expected the grok CLI auth store at {GROK_AUTH_PATH} (run: grok login)\n"
        "  or set XAI_API_KEY."
    )


# ---------------------------------------------------------------------------
# Responses API
# ---------------------------------------------------------------------------

def _post_responses(payload: dict, timeout: int) -> dict:
    bearer, source = resolve_bearer()
    body = json.dumps(payload).encode()
    for attempt in range(3):
        req = urllib.request.Request(
            f"{API_BASE}/responses",
            data=body,
            headers={
                "Authorization": f"Bearer {bearer}",
                "Content-Type": "application/json",
                "User-Agent": "grok-search-cli/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode("utf-8", "replace")[:2000]
            except OSError:
                pass
            if exc.code == 401 and source == "grok-cli" and attempt == 0:
                # Token was revoked or expired under us: let the grok CLI
                # refresh it, re-read, and retry once.
                if _run_grok_cli_refresh():
                    bearer, source = resolve_bearer(allow_refresh=False)
                    continue
            if exc.code >= 500 and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            sys.exit(f"grok-search: HTTP {exc.code} from {API_BASE}/responses\n{detail}")
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            sys.exit(f"grok-search: request failed: {exc}")
    raise AssertionError("unreachable")


def _extract_text(payload: dict) -> str:
    text = str(payload.get("output_text") or "").strip()
    if text:
        return text
    parts = []
    for item in payload.get("output") or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if content.get("type") in {"output_text", "text"}:
                chunk = str(content.get("text") or "").strip()
                if chunk:
                    parts.append(chunk)
    return "\n\n".join(parts).strip()


_STATUS_ID_RE = re.compile(r"(?:x|twitter)\.com/([^/]+)/status/(\d+)")


def _extract_citations(payload: dict) -> list[dict]:
    """Merge top-level citations and inline url_citation annotations.

    Deduplicates by X status ID: xAI reports the same post both as
    x.com/i/status/<id> and x.com/<handle>/status/<id>. Prefers the
    handle form and drops junk titles (bare numbers, title == url).
    """
    by_key: dict[str, dict] = {}
    order: list[str] = []

    def add(url: str, title: str) -> None:
        url = str(url or "").strip()
        if not url:
            return
        title = str(title or "").strip()
        if title == url or title.isdigit():
            title = ""
        match = _STATUS_ID_RE.search(url)
        key = match.group(2) if match else url
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = {"url": url, "title": title}
            order.append(key)
            return
        # Upgrade the anonymous /i/status/ form to the handle form.
        if match and match.group(1) != "i" and "/i/status/" in existing["url"]:
            existing["url"] = url
        if title and not existing["title"]:
            existing["title"] = title

    for cite in payload.get("citations") or []:
        if isinstance(cite, str):
            add(cite, "")
        elif isinstance(cite, dict):
            add(cite.get("url", ""), cite.get("title", ""))
    for item in payload.get("output") or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            for note in content.get("annotations") or []:
                if note.get("type") == "url_citation":
                    add(note.get("url", ""), note.get("title", ""))
    return [by_key[key] for key in order]


# ---------------------------------------------------------------------------
# Argument helpers
# ---------------------------------------------------------------------------

def _clean_handles(handles: list[str], flag: str) -> list[str]:
    cleaned = []
    for handle in handles:
        normalized = handle.strip().lstrip("@")
        if normalized:
            cleaned.append(normalized)
    if len(cleaned) > MAX_HANDLES:
        sys.exit(f"grok-search: {flag} supports at most {MAX_HANDLES} handles")
    return cleaned


def _validate_date(value: str, flag: str) -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        sys.exit(f"grok-search: {flag} must be YYYY-MM-DD (got {value!r})")
    return value


def _run(args: argparse.Namespace, prompt: str, tools: list[dict], filters_active: bool) -> None:
    payload = {
        "model": args.model,
        "input": [{"role": "user", "content": prompt}],
        "tools": tools,
        "store": False,
    }
    data = _post_responses(payload, args.timeout)
    answer = _extract_text(data)
    citations = _extract_citations(data)

    if args.json:
        print(json.dumps(
            {
                "model": args.model,
                "answer": answer,
                "citations": citations,
                "degraded": filters_active and not citations,
            },
            ensure_ascii=False,
            indent=2,
        ))
        return

    print(answer or "(no answer text returned)")
    if citations:
        shown = citations if args.max_citations <= 0 else citations[: args.max_citations]
        print("\nCitations:")
        for cite in shown:
            title = f" -- {cite['title']}" if cite["title"] else ""
            print(f"- {cite['url']}{title}")
        hidden = len(citations) - len(shown)
        if hidden > 0:
            print(f"(+{hidden} more; rerun with --json or --max-citations 0 for all)")
    elif filters_active:
        print(
            "\n[warning] no citations returned despite narrowing filters -- "
            "the answer above may come from model memory, not live posts. "
            "Broaden the date range or handle filters and retry.",
            file=sys.stderr,
        )


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

def cmd_x(args: argparse.Namespace) -> None:
    tool: dict = {"type": "x_search"}
    allowed = _clean_handles(args.handle, "--handle")
    excluded = _clean_handles(args.exclude_handle, "--exclude-handle")
    if allowed and excluded:
        sys.exit("grok-search: --handle and --exclude-handle cannot be combined")
    if allowed:
        tool["allowed_x_handles"] = allowed
    if excluded:
        tool["excluded_x_handles"] = excluded
    if args.from_date:
        tool["from_date"] = _validate_date(args.from_date, "--from")
    if args.to_date:
        tool["to_date"] = _validate_date(args.to_date, "--to")
    if args.images:
        tool["enable_image_understanding"] = True
    if args.videos:
        tool["enable_video_understanding"] = True
    filters_active = bool(allowed or excluded or args.from_date or args.to_date)
    _run(args, args.query, [tool], filters_active)


def cmd_web(args: argparse.Namespace) -> None:
    tool: dict = {"type": "web_search"}
    if args.allow_domain:
        tool["allowed_domains"] = args.allow_domain
    if args.block_domain:
        tool["excluded_domains"] = args.block_domain
    if args.allow_domain and args.block_domain:
        sys.exit("grok-search: --allow-domain and --block-domain cannot be combined")
    _run(args, args.query, [tool], bool(args.allow_domain or args.block_domain))


def cmd_ask(args: argparse.Namespace) -> None:
    _run(args, args.query, [{"type": "x_search"}, {"type": "web_search"}], False)


def cmd_fetch(args: argparse.Namespace) -> None:
    prompt = (
        f"Fetch this X post: {args.url}\n"
        "Quote the full post text verbatim, with author handle, display name, "
        "and timestamp. If it is part of a thread, include the full thread in "
        "order. Note quoted posts and linked media. Do not editorialize."
    )
    _run(args, prompt, [{"type": "x_search"}], False)


def cmd_auth(args: argparse.Namespace) -> None:
    if os.environ.get("XAI_API_KEY", "").strip():
        print("credential: XAI_API_KEY (env)")
        return
    stored = _read_grok_cli_token()
    if stored is None:
        sys.exit(f"credential: none (no {GROK_AUTH_PATH}; run `grok login` or set XAI_API_KEY)")
    _, expires_at = stored
    state = "expired (grok CLI will auto-refresh on use)" if _token_expired(expires_at) else "valid"
    print(f"credential: grok CLI OAuth ({GROK_AUTH_PATH})")
    print(f"expires_at: {expires_at or 'unknown'} [{state}]")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        prog="grok-search",
        description="Search X (Twitter) and the web via xAI Grok server-side tools.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--model", default=DEFAULT_MODEL, help=f"xAI model (default: {DEFAULT_MODEL})")
        p.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="request timeout seconds")
        p.add_argument("--json", action="store_true", help="emit structured JSON instead of markdown")
        p.add_argument("--max-citations", type=int, default=10, metavar="N",
                       help="cap the markdown citation list (0 = unlimited; default 10)")

    p_x = sub.add_parser("x", help="search X (Twitter) posts, profiles, threads")
    p_x.add_argument("query", help="natural-language search question")
    p_x.add_argument("--handle", action="append", default=[], metavar="@USER",
                     help="only search posts from this handle (repeatable, max 10)")
    p_x.add_argument("--exclude-handle", action="append", default=[], metavar="@USER",
                     help="exclude posts from this handle (repeatable, max 10)")
    p_x.add_argument("--from", dest="from_date", default="", metavar="YYYY-MM-DD",
                     help="earliest post date")
    p_x.add_argument("--to", dest="to_date", default="", metavar="YYYY-MM-DD",
                     help="latest post date")
    p_x.add_argument("--images", action="store_true", help="let Grok read images in posts")
    p_x.add_argument("--videos", action="store_true", help="let Grok read videos in posts")
    common(p_x)
    p_x.set_defaults(func=cmd_x)

    p_web = sub.add_parser("web", help="search the web")
    p_web.add_argument("query", help="natural-language search question")
    p_web.add_argument("--allow-domain", action="append", default=[], metavar="DOMAIN",
                       help="restrict search to this domain (repeatable)")
    p_web.add_argument("--block-domain", action="append", default=[], metavar="DOMAIN",
                       help="exclude this domain (repeatable)")
    common(p_web)
    p_web.set_defaults(func=cmd_web)

    p_ask = sub.add_parser("ask", help="free-form question; Grok picks X search and/or web search")
    p_ask.add_argument("query", help="question")
    common(p_ask)
    p_ask.set_defaults(func=cmd_ask)

    p_fetch = sub.add_parser("fetch", help="fetch one X post or thread by URL")
    p_fetch.add_argument("url", help="https://x.com/... post URL")
    common(p_fetch)
    p_fetch.set_defaults(func=cmd_fetch)

    p_auth = sub.add_parser("auth", help="show which credential would be used")
    p_auth.set_defaults(func=cmd_auth)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
