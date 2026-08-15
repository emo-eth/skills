#!/usr/bin/env python3
"""grok-search: X (Twitter) search, web search, and Grok inference on your
Grok subscription.

Talks to xAI's Responses API (https://api.x.ai/v1) with the server-side
`x_search` / `web_search` tools -- Grok runs the search on xAI's side and
returns a cited answer. Also does plain Grok inference (`prompt`) and model
listing (`models`).

Credential sources, first match wins:
  1. XAI_API_KEY env var (pay-as-you-go API billing).
  2. The standalone `grok` CLI's OAuth token (~/.grok/auth.json). Its
     lifecycle stays owned by the grok CLI: this script never spends the
     single-use refresh token; on expiry it runs a minimal `grok -p` call
     so the CLI rotates and persists its own tokens, then re-reads them.
  3. This script's own OAuth login (`grok-search.py login`), stored at
     ~/.config/grok-search/auth.json with self-managed refresh. Use this
     on machines without the grok CLI.

Subcommands:
  x       Search X (Twitter) posts, profiles, and threads.
  web     Search the web.
  ask     Free-form question; Grok picks between X search and web search.
  fetch   Fetch one X post / thread URL and quote its content.
  prompt  Plain Grok inference, no search tools.
  models  List models available to this credential.
  auth    Show which credential would be used.
  login   Sign in with your SuperGrok / X Premium+ subscription (OAuth).
  logout  Delete this script's own stored tokens (never the grok CLI's).

No third-party dependencies (python3 stdlib only).
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.server
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

API_BASE = os.environ.get("XAI_BASE_URL", "https://api.x.ai/v1").rstrip("/")
GROK_AUTH_PATH = Path(os.environ.get("GROK_HOME", str(Path.home() / ".grok"))) / "auth.json"
OWN_AUTH_PATH = Path(
    os.environ.get("GROK_SEARCH_HOME", str(Path.home() / ".config" / "grok-search"))
) / "auth.json"
DEFAULT_MODEL = os.environ.get("GROK_SEARCH_MODEL", "grok-4-fast")
DEFAULT_TIMEOUT = 180
MAX_HANDLES = 10
EXPIRY_SKEW_SECONDS = 60

# OAuth (same public PKCE client the grok CLI and Hermes use).
OAUTH_ISSUER = "https://auth.x.ai"
OAUTH_DISCOVERY_URL = f"{OAUTH_ISSUER}/.well-known/openid-configuration"
OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access"
OAUTH_REDIRECT_PORT = 56121
OAUTH_REDIRECT_URI = f"http://127.0.0.1:{OAUTH_REDIRECT_PORT}/callback"
OAUTH_ALLOWED_ENDPOINT_PREFIXES = ("https://auth.x.ai/", "https://accounts.x.ai/")
OAUTH_CALLBACK_TIMEOUT_SECONDS = 300


# ---------------------------------------------------------------------------
# Credentials: grok CLI store (read-only; CLI owns refresh)
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


# ---------------------------------------------------------------------------
# Credentials: own OAuth store (self-managed refresh)
# ---------------------------------------------------------------------------

def _read_own_tokens() -> dict | None:
    try:
        data = json.loads(OWN_AUTH_PATH.read_text())
    except (OSError, ValueError):
        return None
    if isinstance(data, dict) and str(data.get("access_token") or "").strip():
        return data
    return None


def _save_own_tokens(tokens: dict) -> None:
    OWN_AUTH_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = OWN_AUTH_PATH.with_suffix(".json.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(tokens, handle, indent=2)
    os.replace(tmp, OWN_AUTH_PATH)


def _expires_at_iso(expires_in: object) -> str:
    try:
        ttl = int(expires_in)
    except (TypeError, ValueError):
        return ""
    return datetime.fromtimestamp(time.time() + ttl, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


def _oauth_discovery(timeout: int = 15) -> dict:
    req = urllib.request.Request(OAUTH_DISCOVERY_URL, headers={"User-Agent": "grok-search-cli/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            doc = json.load(resp)
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        sys.exit(f"grok-search: OAuth discovery failed ({OAUTH_DISCOVERY_URL}): {exc}")
    for field in ("authorization_endpoint", "token_endpoint"):
        endpoint = str(doc.get(field) or "")
        if not endpoint.startswith(OAUTH_ALLOWED_ENDPOINT_PREFIXES):
            sys.exit(f"grok-search: discovery returned untrusted {field}: {endpoint!r}")
    return doc


def _token_request(token_endpoint: str, form: dict, timeout: int = 30) -> dict:
    req = urllib.request.Request(
        token_endpoint,
        data=urllib.parse.urlencode(form).encode(),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
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
            detail = exc.read().decode("utf-8", "replace")[:500]
        except OSError:
            pass
        raise RuntimeError(f"token endpoint returned HTTP {exc.code}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise RuntimeError(f"token request failed: {exc}") from exc


def _refresh_own_tokens() -> bool:
    """Spend our own refresh token and persist the rotated pair."""
    stored = _read_own_tokens()
    if stored is None:
        return False
    refresh_token = str(stored.get("refresh_token") or "").strip()
    token_endpoint = str(stored.get("token_endpoint") or "").strip()
    if not refresh_token:
        return False
    if not token_endpoint.startswith(OAUTH_ALLOWED_ENDPOINT_PREFIXES):
        token_endpoint = str(_oauth_discovery().get("token_endpoint"))
    try:
        payload = _token_request(
            token_endpoint,
            {
                "grant_type": "refresh_token",
                "client_id": OAUTH_CLIENT_ID,
                "refresh_token": refresh_token,
            },
        )
    except RuntimeError as exc:
        print(f"grok-search: own-token refresh failed: {exc}", file=sys.stderr)
        return False
    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        return False
    _save_own_tokens(
        {
            "access_token": access_token,
            # xAI rotates refresh tokens (single-use); keep the old one only
            # if the response omitted a replacement.
            "refresh_token": str(payload.get("refresh_token") or refresh_token),
            "expires_at": _expires_at_iso(payload.get("expires_in")),
            "token_endpoint": token_endpoint,
            "obtained_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    )
    return True


# ---------------------------------------------------------------------------
# Credential resolution
# ---------------------------------------------------------------------------

def _refresh_source(source: str) -> bool:
    if source == "grok-cli":
        return _run_grok_cli_refresh()
    if source == "own":
        return _refresh_own_tokens()
    return False


def resolve_bearer(allow_refresh: bool = True) -> tuple[str, str]:
    """Return (bearer, source). source is 'env', 'grok-cli', or 'own'."""
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

    own = _read_own_tokens()
    if own is not None:
        if _token_expired(str(own.get("expires_at") or "")) and allow_refresh:
            if _refresh_own_tokens():
                own = _read_own_tokens() or own
        return str(own["access_token"]), "own"

    sys.exit(
        "grok-search: no xAI credentials.\n"
        f"  Expected the grok CLI auth store at {GROK_AUTH_PATH} (run: grok login),\n"
        f"  or this script's own store at {OWN_AUTH_PATH} (run: grok-search.py login),\n"
        "  or set XAI_API_KEY."
    )


# ---------------------------------------------------------------------------
# xAI API
# ---------------------------------------------------------------------------

def _auth_failure_needs_refresh(code: int, detail: str) -> bool:
    """401 always; 403 only when xAI marks it as an auth problem (mirrors
    Hermes: '[WKE=unauthenticated:...]' / token-validation messages)."""
    if code == 401:
        return True
    if code == 403:
        haystack = detail.lower()
        return "unauthenticated" in haystack or "access token could not be validated" in haystack
    return False


def _api_request(path: str, payload: dict | None, timeout: int) -> dict:
    bearer, source = resolve_bearer()
    body = json.dumps(payload).encode() if payload is not None else None
    refreshed_once = False
    for attempt in range(3):
        req = urllib.request.Request(
            f"{API_BASE}{path}",
            data=body,
            headers={
                "Authorization": f"Bearer {bearer}",
                "Content-Type": "application/json",
                "User-Agent": "grok-search-cli/1.0",
            },
            method="POST" if payload is not None else "GET",
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
            if (
                not refreshed_once
                and source != "env"
                and _auth_failure_needs_refresh(exc.code, detail)
            ):
                refreshed_once = True
                if _refresh_source(source):
                    bearer, source = resolve_bearer(allow_refresh=False)
                    continue
            if exc.code >= 500 and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            sys.exit(f"grok-search: HTTP {exc.code} from {API_BASE}{path}\n{detail}")
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

def _read_query(value: str) -> str:
    """Support '-' to read the query/prompt from stdin."""
    if value == "-":
        text = sys.stdin.read().strip()
        if not text:
            sys.exit("grok-search: empty stdin")
        return text
    return value


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
    payload: dict = {
        "model": args.model,
        "input": [{"role": "user", "content": prompt}],
        "store": False,
    }
    if tools:
        payload["tools"] = tools
    system = getattr(args, "system", "")
    if system:
        payload["input"].insert(0, {"role": "system", "content": system})
    data = _api_request("/responses", payload, args.timeout)
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

BRIEF_INSTRUCTION = (
    "Return ONLY a source list -- no synthesis, no commentary, no conclusions. "
    "One line per source, most relevant first. "
    'X posts: @handle (YYYY-MM-DD): "exact post text, trim to ~200 chars" -- URL. '
    "Web pages: Title (site, date): one-line factual summary -- URL. "
    "Include every relevant source you found."
)


def _apply_brief(args: argparse.Namespace, query: str) -> str:
    if getattr(args, "brief", False):
        return f"{query}\n\n{BRIEF_INSTRUCTION}"
    return query


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
    _run(args, _apply_brief(args, _read_query(args.query)), [tool], filters_active)


def cmd_web(args: argparse.Namespace) -> None:
    tool: dict = {"type": "web_search"}
    if args.allow_domain and args.block_domain:
        sys.exit("grok-search: --allow-domain and --block-domain cannot be combined")
    if args.allow_domain:
        tool["allowed_domains"] = args.allow_domain
    if args.block_domain:
        tool["excluded_domains"] = args.block_domain
    filters_active = bool(args.allow_domain or args.block_domain)
    _run(args, _apply_brief(args, _read_query(args.query)), [tool], filters_active)


def cmd_ask(args: argparse.Namespace) -> None:
    _run(
        args,
        _apply_brief(args, _read_query(args.query)),
        [{"type": "x_search"}, {"type": "web_search"}],
        False,
    )


def cmd_fetch(args: argparse.Namespace) -> None:
    prompt = (
        f"Fetch this X post: {args.url}\n"
        "Quote the full post text verbatim, with author handle, display name, "
        "and timestamp. If it is part of a thread, include the full thread in "
        "order. Note quoted posts and linked media. Do not editorialize."
    )
    _run(args, prompt, [{"type": "x_search"}], False)


def cmd_prompt(args: argparse.Namespace) -> None:
    _run(args, _read_query(args.query), [], False)


def cmd_models(args: argparse.Namespace) -> None:
    data = _api_request("/models", None, args.timeout)
    entries = data.get("data") or []
    if args.json:
        print(json.dumps(entries, ensure_ascii=False, indent=2))
        return
    for entry in entries:
        model_id = str(entry.get("id") or "")
        context = entry.get("context_length")
        context_text = f"  ({context // 1000}k context)" if isinstance(context, int) else ""
        print(f"{model_id}{context_text}")
    if not entries:
        print("(no models returned)")


def cmd_auth(args: argparse.Namespace) -> None:
    found = False
    if os.environ.get("XAI_API_KEY", "").strip():
        print("credential: XAI_API_KEY (env) [active]")
        found = True
    cli = _read_grok_cli_token()
    if cli is not None:
        _, expires_at = cli
        state = "expired (grok CLI auto-refreshes on use)" if _token_expired(expires_at) else "valid"
        marker = "" if found else " [active]"
        print(f"credential: grok CLI OAuth ({GROK_AUTH_PATH}){marker}")
        print(f"  expires_at: {expires_at or 'unknown'} [{state}]")
        found = True
    own = _read_own_tokens()
    if own is not None:
        expires_at = str(own.get("expires_at") or "")
        state = "expired (self-refreshes on use)" if _token_expired(expires_at) else "valid"
        marker = "" if found else " [active]"
        print(f"credential: grok-search OAuth ({OWN_AUTH_PATH}){marker}")
        print(f"  expires_at: {expires_at or 'unknown'} [{state}]")
        found = True
    if not found:
        sys.exit(
            "credential: none\n"
            f"  Run `grok login` (grok CLI), `grok-search.py login`, or set XAI_API_KEY."
        )


# ---------------------------------------------------------------------------
# OAuth login (loopback PKCE)
# ---------------------------------------------------------------------------

class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    result: dict = {}
    expected_state = ""

    def do_GET(self):  # noqa: N802 (stdlib naming)
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return
        params = urllib.parse.parse_qs(parsed.query)
        code = (params.get("code") or [""])[0]
        state = (params.get("state") or [""])[0]
        error = (params.get("error") or [""])[0]
        if state != self.expected_state:
            error = error or "state_mismatch"
            code = ""
        if not _CallbackHandler.result:
            _CallbackHandler.result = {"code": code, "error": error}
        body = (
            "<html><body><h2>grok-search: login "
            + ("failed" if error else "complete")
            + "</h2><p>You can close this tab and return to the terminal.</p></body></html>"
        )
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *_args):  # silence request logging
        pass


def cmd_login(args: argparse.Namespace) -> None:
    if _read_own_tokens() is not None and not args.force:
        sys.exit(
            f"grok-search: already logged in ({OWN_AUTH_PATH}).\n"
            "  Re-run with --force to replace the stored tokens."
        )
    discovery = _oauth_discovery()
    verifier = base64.urlsafe_b64encode(os.urandom(64)).rstrip(b"=").decode()
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    state = secrets.token_urlsafe(24)
    authorize_url = (
        str(discovery["authorization_endpoint"])
        + "?"
        + urllib.parse.urlencode(
            {
                "response_type": "code",
                "client_id": OAUTH_CLIENT_ID,
                "redirect_uri": OAUTH_REDIRECT_URI,
                "scope": OAUTH_SCOPE,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "state": state,
            }
        )
    )

    _CallbackHandler.result = {}
    _CallbackHandler.expected_state = state
    try:
        server = http.server.HTTPServer(("127.0.0.1", OAUTH_REDIRECT_PORT), _CallbackHandler)
    except OSError as exc:
        sys.exit(
            f"grok-search: cannot bind 127.0.0.1:{OAUTH_REDIRECT_PORT} for the OAuth "
            f"callback ({exc}). Close whatever is using that port and retry."
        )
    server.timeout = 1.0

    print("Open this URL to sign in with your SuperGrok / X Premium+ account:")
    print(f"  {authorize_url}")
    if not args.no_browser:
        threading.Thread(target=webbrowser.open, args=(authorize_url,), daemon=True).start()
    print("Waiting for the browser callback"
          f" (http://127.0.0.1:{OAUTH_REDIRECT_PORT}/callback, {OAUTH_CALLBACK_TIMEOUT_SECONDS}s)...")

    deadline = time.time() + OAUTH_CALLBACK_TIMEOUT_SECONDS
    try:
        while time.time() < deadline and not _CallbackHandler.result:
            server.handle_request()
    finally:
        server.server_close()

    result = _CallbackHandler.result
    if not result or not result.get("code"):
        sys.exit(f"grok-search: login failed: {result.get('error') or 'callback timeout'}")

    token_endpoint = str(discovery["token_endpoint"])
    try:
        payload = _token_request(
            token_endpoint,
            {
                "grant_type": "authorization_code",
                "code": result["code"],
                "redirect_uri": OAUTH_REDIRECT_URI,
                "client_id": OAUTH_CLIENT_ID,
                "code_verifier": verifier,
            },
        )
    except RuntimeError as exc:
        sys.exit(f"grok-search: code exchange failed: {exc}")
    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        sys.exit("grok-search: token endpoint returned no access_token")
    _save_own_tokens(
        {
            "access_token": access_token,
            "refresh_token": str(payload.get("refresh_token") or ""),
            "expires_at": _expires_at_iso(payload.get("expires_in")),
            "token_endpoint": token_endpoint,
            "obtained_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    )
    print(f"Login successful. Tokens stored at {OWN_AUTH_PATH} (mode 600).")


def cmd_logout(args: argparse.Namespace) -> None:
    if OWN_AUTH_PATH.exists():
        OWN_AUTH_PATH.unlink()
        print(f"Removed {OWN_AUTH_PATH}.")
    else:
        print("No grok-search tokens stored (the grok CLI's own login is never touched).")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        prog="grok-search",
        description="X (Twitter) search, web search, and Grok inference via your Grok subscription.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--model", default=DEFAULT_MODEL, help=f"xAI model (default: {DEFAULT_MODEL})")
        p.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="request timeout seconds")
        p.add_argument("--json", action="store_true", help="emit structured JSON instead of markdown")
        p.add_argument("--max-citations", type=int, default=10, metavar="N",
                       help="cap the markdown citation list (0 = unlimited; default 10)")

    def brief(p: argparse.ArgumentParser) -> None:
        p.add_argument("--brief", action="store_true",
                       help="return a raw source list (no synthesis) for a smarter model to synthesize")

    p_x = sub.add_parser("x", help="search X (Twitter) posts, profiles, threads")
    p_x.add_argument("query", help="natural-language search question ('-' reads stdin)")
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
    brief(p_x)
    common(p_x)
    p_x.set_defaults(func=cmd_x)

    p_web = sub.add_parser("web", help="search the web")
    p_web.add_argument("query", help="natural-language search question ('-' reads stdin)")
    p_web.add_argument("--allow-domain", action="append", default=[], metavar="DOMAIN",
                       help="restrict search to this domain (repeatable)")
    p_web.add_argument("--block-domain", action="append", default=[], metavar="DOMAIN",
                       help="exclude this domain (repeatable)")
    brief(p_web)
    common(p_web)
    p_web.set_defaults(func=cmd_web)

    p_ask = sub.add_parser("ask", help="free-form question; Grok picks X search and/or web search")
    p_ask.add_argument("query", help="question ('-' reads stdin)")
    brief(p_ask)
    common(p_ask)
    p_ask.set_defaults(func=cmd_ask)

    p_fetch = sub.add_parser("fetch", help="fetch one X post or thread by URL")
    p_fetch.add_argument("url", help="https://x.com/... post URL")
    common(p_fetch)
    p_fetch.set_defaults(func=cmd_fetch)

    p_prompt = sub.add_parser("prompt", help="plain Grok inference, no search tools")
    p_prompt.add_argument("query", help="prompt text ('-' reads stdin)")
    p_prompt.add_argument("--system", default="", help="optional system prompt")
    common(p_prompt)
    p_prompt.set_defaults(func=cmd_prompt)

    p_models = sub.add_parser("models", help="list models available to this credential")
    p_models.add_argument("--timeout", type=int, default=30, help="request timeout seconds")
    p_models.add_argument("--json", action="store_true", help="emit full model metadata JSON")
    p_models.set_defaults(func=cmd_models)

    p_auth = sub.add_parser("auth", help="show which credential would be used")
    p_auth.set_defaults(func=cmd_auth)

    p_login = sub.add_parser("login", help="sign in with SuperGrok / X Premium+ (OAuth, no grok CLI needed)")
    p_login.add_argument("--no-browser", action="store_true", help="print the URL instead of opening a browser")
    p_login.add_argument("--force", action="store_true", help="replace existing stored tokens")
    p_login.set_defaults(func=cmd_login)

    p_logout = sub.add_parser("logout", help="delete this script's stored tokens (never the grok CLI's)")
    p_logout.set_defaults(func=cmd_logout)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
