#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import contextlib
import fcntl
import hashlib
import http.server
import json
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

from grok_x import build_fetch_prompt, build_search_prompt, enforce_live_fetch, fetch_response_format, parse_fetch_document


API_BASE = "https://api.x.ai/v1"
GROK_AUTH_PATH = Path(os.environ.get("GROK_HOME", str(Path.home() / ".grok"))) / "auth.json"
OWN_HOME = Path(os.environ.get("GROK_SEARCH_HOME", str(Path.home() / ".config" / "grok-search")))
OWN_AUTH_PATH = OWN_HOME / "auth.json"
OWN_LOCK_PATH = OWN_HOME / "auth.lock"
CLI_LOCK_PATH = OWN_HOME / "grok-cli-refresh.lock"
DEVICE_HOME = OWN_HOME / "device"
DEFAULT_MODEL = os.environ.get("GROK_SEARCH_MODEL", "grok-4-fast")
DEFAULT_TIMEOUT = 180
MAX_HANDLES = 10
EXPIRY_SKEW_SECONDS = 60
OAUTH_ISSUER = "https://auth.x.ai"
OAUTH_DISCOVERY_URL = f"{OAUTH_ISSUER}/.well-known/openid-configuration"
OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access"
OAUTH_REDIRECT_PORT = 56121
OAUTH_REDIRECT_URI = f"http://127.0.0.1:{OAUTH_REDIRECT_PORT}/callback"
OAUTH_ALLOWED_ENDPOINT_PREFIXES = ("https://auth.x.ai/", "https://accounts.x.ai/")
OAUTH_CALLBACK_TIMEOUT_SECONDS = 300
DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
STATUS_ID_RE = re.compile(r"(?:x|twitter)\.com/([^/]+)/status/(\d+)")


class GrokError(Exception):
    def __init__(self, code: str, message: str, source: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.source = source


class OAuthError(Exception):
    def __init__(self, code: str, description: str, status: int):
        super().__init__(description)
        self.code = code
        self.description = description
        self.status = status


def _ensure_private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path, 0o700)


@contextlib.contextmanager
def _exclusive_lock(path: Path):
    _ensure_private_dir(path.parent)
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    os.fchmod(descriptor, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def _atomic_json(path: Path, value: dict) -> None:
    _ensure_private_dir(path.parent)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def _private_json(path: Path) -> tuple[str, dict | None]:
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return "missing", None
    except OSError:
        return "malformed", None
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        return "malformed", None
    if metadata.st_mode & 0o077:
        return "malformed", None
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return "malformed", None
    if not isinstance(value, dict):
        return "malformed", None
    return "present", value


def _ordinary_json(path: Path) -> tuple[str, dict | None]:
    try:
        value = json.loads(path.read_text())
    except FileNotFoundError:
        return "missing", None
    except (OSError, ValueError):
        return "malformed", None
    if not isinstance(value, dict):
        return "malformed", None
    return "present", value


def _token_expired(expires_at: str) -> bool:
    raw = expires_at.strip()
    if not raw:
        return False
    try:
        expiry = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return False
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    return expiry.timestamp() - EXPIRY_SKEW_SECONDS <= time.time()


def _read_grok_cli_token() -> tuple[str, dict | None]:
    state, value = _ordinary_json(GROK_AUTH_PATH)
    if state != "present" or value is None:
        return state, None
    for name in sorted(value):
        entry = value[name]
        if not isinstance(entry, dict):
            continue
        token = str(entry.get("key") or "").strip()
        if token:
            return "valid", {
                "access_token": token,
                "expires_at": str(entry.get("expires_at") or ""),
            }
    return "malformed", None


def _read_own_tokens() -> tuple[str, dict | None]:
    state, value = _private_json(OWN_AUTH_PATH)
    if state != "present" or value is None:
        return state, None
    access_token = str(value.get("access_token") or "").strip()
    if not access_token:
        return "malformed", None
    expires_at = str(value.get("expires_at") or "")
    refresh_token = str(value.get("refresh_token") or "").strip()
    if _token_expired(expires_at) and not refresh_token:
        return "unrefreshable", value
    return "valid", value


def _expires_at_iso(expires_in: object) -> str:
    try:
        ttl = int(expires_in)
    except (TypeError, ValueError):
        ttl = 3600
    return datetime.fromtimestamp(time.time() + ttl, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _safe_http_message(raw: str, fallback: str) -> str:
    try:
        value = json.loads(raw)
    except ValueError:
        return fallback
    if isinstance(value, dict):
        error = value.get("error")
        if isinstance(error, dict):
            message = str(error.get("message") or "").strip()
            if message:
                return message[:500]
        description = str(value.get("error_description") or "").strip()
        if description:
            return description[:500]
    return fallback


def _oauth_discovery(required: tuple[str, ...]) -> dict:
    request = urllib.request.Request(OAUTH_DISCOVERY_URL, headers={"User-Agent": "grok-search-cli/2.0"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            value = json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise GrokError("oauth_discovery_failed", f"OAuth discovery failed: {error}") from error
    if not isinstance(value, dict):
        raise GrokError("oauth_discovery_failed", "OAuth discovery returned an invalid document.")
    for field in required:
        endpoint = str(value.get(field) or "")
        if not endpoint.startswith(OAUTH_ALLOWED_ENDPOINT_PREFIXES):
            raise GrokError("oauth_discovery_failed", f"OAuth discovery returned an untrusted {field}.")
    return value


def _form_request(endpoint: str, form: dict, timeout: int = 30) -> dict:
    if not endpoint.startswith(OAUTH_ALLOWED_ENDPOINT_PREFIXES):
        raise GrokError("oauth_endpoint_untrusted", "OAuth endpoint is not trusted.")
    request = urllib.request.Request(
        endpoint,
        data=urllib.parse.urlencode(form).encode(),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "grok-search-cli/2.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            value = json.load(response)
    except urllib.error.HTTPError as error:
        try:
            raw = error.read().decode("utf-8", "replace")[:2000]
        except OSError:
            raw = ""
        try:
            value = json.loads(raw)
        except ValueError:
            value = {}
        code = str(value.get("error") or f"http_{error.code}") if isinstance(value, dict) else f"http_{error.code}"
        description = _safe_http_message(raw, f"OAuth endpoint returned HTTP {error.code}.")
        raise OAuthError(code, description, error.code) from error
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise GrokError("oauth_request_failed", f"OAuth request failed: {error}") from error
    if not isinstance(value, dict):
        raise GrokError("oauth_request_failed", "OAuth endpoint returned an invalid response.")
    return value


def _save_own_tokens(value: dict) -> None:
    with _exclusive_lock(OWN_LOCK_PATH):
        _atomic_json(OWN_AUTH_PATH, value)


def _refresh_own_tokens(failed_access: str | None = None, expired_only: bool = False) -> bool:
    with _exclusive_lock(OWN_LOCK_PATH):
        state, stored = _read_own_tokens()
        if state != "valid" or stored is None:
            return False
        current_access = str(stored.get("access_token") or "")
        if failed_access is not None and current_access != failed_access:
            return True
        if expired_only and not _token_expired(str(stored.get("expires_at") or "")):
            return True
        refresh_token = str(stored.get("refresh_token") or "").strip()
        if not refresh_token:
            return False
        token_endpoint = str(stored.get("token_endpoint") or "")
        if not token_endpoint.startswith(OAUTH_ALLOWED_ENDPOINT_PREFIXES):
            token_endpoint = str(_oauth_discovery(("token_endpoint",))["token_endpoint"])
        try:
            payload = _form_request(
                token_endpoint,
                {
                    "grant_type": "refresh_token",
                    "client_id": OAUTH_CLIENT_ID,
                    "refresh_token": refresh_token,
                },
            )
        except (GrokError, OAuthError):
            return False
        access_token = str(payload.get("access_token") or "").strip()
        if not access_token:
            return False
        _atomic_json(
            OWN_AUTH_PATH,
            {
                "access_token": access_token,
                "refresh_token": str(payload.get("refresh_token") or refresh_token),
                "expires_at": _expires_at_iso(payload.get("expires_in")),
                "token_endpoint": token_endpoint,
                "obtained_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
        )
        return True


def _refresh_grok_cli(failed_access: str | None = None, expired_only: bool = False) -> bool:
    with _exclusive_lock(CLI_LOCK_PATH):
        state, stored = _read_grok_cli_token()
        if state != "valid" or stored is None:
            return False
        current_access = str(stored.get("access_token") or "")
        if failed_access is not None and current_access != failed_access:
            return True
        if expired_only and not _token_expired(str(stored.get("expires_at") or "")):
            return True
        grok = shutil.which("grok")
        if grok is None:
            return False
        try:
            result = subprocess.run(
                [grok, "--no-auto-update", "-p", "Reply with exactly: ok"],
                capture_output=True,
                timeout=120,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return False
        if result.returncode != 0:
            return False
        refreshed_state, refreshed = _read_grok_cli_token()
        if refreshed_state != "valid" or refreshed is None:
            return False
        return str(refreshed.get("access_token") or "") != current_access or not _token_expired(str(refreshed.get("expires_at") or ""))


def _resolve_credential(
    args: argparse.Namespace,
    allow_refresh: bool = True,
    excluded_sources: frozenset[str] = frozenset(),
) -> tuple[str, str]:
    selection = str(getattr(args, "credential_source", "auto"))
    env_key = os.environ.get("XAI_API_KEY", "").strip()
    block_api_key = os.environ.get("GROK_SEARCH_BLOCK_API_KEY") == "1"
    if selection == "api-key":
        if env_key:
            return env_key, "env"
        raise GrokError("auth_required", "Explicit API-key access was selected, but XAI_API_KEY is unavailable.", "env")

    host_token = os.environ.get("GROK_SEARCH_HOST_OAUTH_TOKEN", "").strip()
    if host_token and "host-xai" not in excluded_sources:
        return host_token, "host-xai"

    issues: list[tuple[str, str]] = []
    if "grok-cli" not in excluded_sources:
        cli_state, cli = _read_grok_cli_token()
        if cli_state == "malformed":
            issues.append(("grok-cli", "malformed"))
        if cli_state == "valid" and cli is not None:
            if _token_expired(str(cli.get("expires_at") or "")) and allow_refresh:
                _refresh_grok_cli(expired_only=True)
                cli_state, cli = _read_grok_cli_token()
            if cli_state == "valid" and cli is not None:
                if _token_expired(str(cli.get("expires_at") or "")):
                    issues.append(("grok-cli", "expired"))
                else:
                    return str(cli["access_token"]), "grok-cli"

    if "plugin-oauth" not in excluded_sources:
        own_state, own = _read_own_tokens()
        if own_state in {"malformed", "unrefreshable"}:
            issues.append(("plugin-oauth", own_state))
        if own_state == "valid" and own is not None:
            if _token_expired(str(own.get("expires_at") or "")) and allow_refresh:
                _refresh_own_tokens(expired_only=True)
                own_state, own = _read_own_tokens()
            if own_state == "valid" and own is not None:
                if _token_expired(str(own.get("expires_at") or "")):
                    issues.append(("plugin-oauth", "expired"))
                else:
                    return str(own["access_token"]), "plugin-oauth"
    if block_api_key:
        raise GrokError(
            "host_oauth_unavailable",
            "Host xAI subscription authorization is present but could not be delegated. Billed API access was not used.",
            "host-xai",
        )

    if issues:
        source, state = issues[0]
        if state == "malformed":
            raise GrokError("credential_malformed", f"The {source} credential store is malformed.", source)
        raise GrokError("auth_expired", f"The {source} authorization is expired or cannot be refreshed.", source)
    if excluded_sources:
        source = sorted(excluded_sources)[0]
        raise GrokError("auth_expired", f"The {source} authorization is no longer valid.", source)
    if env_key and not block_api_key:
        return env_key, "env"
    raise GrokError(
        "auth_required",
        "No supported xAI credential is available. Offer the user Grok device authorization before starting it.",
    )


def _refresh_source(source: str, failed_access: str) -> bool:
    if source == "grok-cli":
        return _refresh_grok_cli(failed_access=failed_access)
    if source == "plugin-oauth":
        return _refresh_own_tokens(failed_access=failed_access)
    return False


def _auth_failure(code: int, detail: str) -> bool:
    if code == 401:
        return True
    lowered = detail.lower()
    return code == 403 and ("unauthenticated" in lowered or "access token could not be validated" in lowered)


def _api_request(path: str, payload: dict | None, args: argparse.Namespace) -> dict:
    bearer, source = _resolve_credential(args)
    body = json.dumps(payload).encode() if payload is not None else None
    failed_sources: set[str] = set()
    while True:
        request = urllib.request.Request(
            f"{API_BASE}{path}",
            data=body,
            headers={
                "Authorization": f"Bearer {bearer}",
                "Content-Type": "application/json",
                "User-Agent": "grok-search-cli/2.0",
            },
            method="POST" if payload is not None else "GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=args.timeout) as response:
                value = json.load(response)
                if not isinstance(value, dict):
                    raise GrokError("invalid_response", "xAI returned an invalid response.", source)
                return value
        except urllib.error.HTTPError as error:
            try:
                raw = error.read().decode("utf-8", "replace")[:2000]
            except OSError:
                raw = ""
            if source in {"grok-cli", "plugin-oauth"} and _auth_failure(error.code, raw):
                current_source = source
                if current_source not in failed_sources:
                    failed_sources.add(current_source)
                    if _refresh_source(current_source, bearer):
                        bearer, source = _resolve_credential(
                            args,
                            allow_refresh=False,
                            excluded_sources=frozenset(failed_sources - {current_source}),
                        )
                        continue
                try:
                    bearer, source = _resolve_credential(
                        args,
                        allow_refresh=False,
                        excluded_sources=frozenset(failed_sources),
                    )
                except GrokError:
                    pass
                else:
                    continue
            if _auth_failure(error.code, raw):
                raise GrokError("auth_expired", "xAI authorization is no longer valid.", source) from error
            if error.code == 429:
                if source == "env":
                    raise GrokError("api_rate_limited", "Billed xAI API access is unavailable or rate limited.", source) from error
                raise GrokError("subscription_quota_exhausted", "Grok subscription access is unavailable or its quota is exhausted. Billed API access was not used.", source) from error
            message = _safe_http_message(raw, f"xAI returned HTTP {error.code}.")
            raise GrokError("http_error", message, source) from error
        except (urllib.error.URLError, TimeoutError) as error:
            code = "outcome_unknown" if payload is not None else "request_failed"
            raise GrokError(code, f"xAI request failed without an automatic retry: {error}", source) from error


def _extract_text(payload: dict) -> str:
    text = str(payload.get("output_text") or "").strip()
    if text:
        return text
    parts: list[str] = []
    for item in payload.get("output") or []:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if isinstance(content, dict) and content.get("type") in {"output_text", "text"}:
                chunk = str(content.get("text") or "").strip()
                if chunk:
                    parts.append(chunk)
    return "\n\n".join(parts).strip()


def _extract_citations(payload: dict) -> list[dict]:
    by_key: dict[str, dict] = {}
    order: list[str] = []

    def add(url: str, title: str) -> None:
        normalized_url = str(url or "").strip()
        if not normalized_url:
            return
        normalized_title = str(title or "").strip()
        if normalized_title == normalized_url or normalized_title.isdigit():
            normalized_title = ""
        match = STATUS_ID_RE.search(normalized_url)
        key = match.group(2) if match else normalized_url
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = {"url": normalized_url, "title": normalized_title}
            order.append(key)
            return
        if match and match.group(1) != "i" and "/i/status/" in existing["url"]:
            existing["url"] = normalized_url
        if normalized_title and not existing["title"]:
            existing["title"] = normalized_title

    for citation in payload.get("citations") or []:
        if isinstance(citation, str):
            add(citation, "")
        elif isinstance(citation, dict):
            add(citation.get("url", ""), citation.get("title", ""))
    for item in payload.get("output") or []:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if not isinstance(content, dict):
                continue
            for annotation in content.get("annotations") or []:
                if isinstance(annotation, dict) and annotation.get("type") == "url_citation":
                    add(annotation.get("url", ""), annotation.get("title", ""))
    return [by_key[key] for key in order]


def _read_query(value: str) -> str:
    if value != "-":
        return value
    text = sys.stdin.read().strip()
    if not text:
        raise GrokError("invalid_input", "stdin is empty.")
    return text


def _clean_handles(handles: list[str], flag: str) -> list[str]:
    cleaned = [handle.strip().lstrip("@") for handle in handles if handle.strip().lstrip("@")]
    if len(cleaned) > MAX_HANDLES:
        raise GrokError("invalid_input", f"{flag} supports at most {MAX_HANDLES} handles.")
    return cleaned


def _validate_date(value: str, flag: str) -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as error:
        raise GrokError("invalid_input", f"{flag} must be YYYY-MM-DD.") from error
    return value


def _emit_result(args: argparse.Namespace, value: dict) -> None:
    if args.json:
        print(json.dumps(value, ensure_ascii=False, indent=2))
        return
    if value.get("kind") == "search":
        print(value.get("answer") or "(no live X evidence returned)")
        citations = value.get("citations") or []
        if citations:
            shown = citations if args.max_citations <= 0 else citations[: args.max_citations]
            print("\nSources:")
            for citation in shown:
                title = f" -- {citation['title']}" if citation["title"] else ""
                print(f"- {citation['url']}{title}")
        return
    print(json.dumps(value, ensure_ascii=False, indent=2))


def cmd_x(args: argparse.Namespace) -> None:
    tool: dict = {"type": "x_search"}
    allowed = _clean_handles(args.handle, "--handle")
    excluded = _clean_handles(args.exclude_handle, "--exclude-handle")
    if allowed and excluded:
        raise GrokError("invalid_input", "--handle and --exclude-handle cannot be combined.")
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
    payload = {
        "model": args.model,
        "input": [{"role": "user", "content": build_search_prompt(_read_query(args.query), args.brief, args.depth)}],
        "tools": [tool],
        "store": False,
    }
    data = _api_request("/responses", payload, args)
    citations = _extract_citations(data)
    warnings: list[str] = []
    answer = _extract_text(data)
    degraded = not citations
    if degraded:
        answer = "No live X evidence was returned for this request."
        warnings.append("The response contained no live X citations; model memory was not returned as evidence.")
    _emit_result(
        args,
        {
            "kind": "search",
            "model": args.model,
            "answer": answer,
            "citations": citations,
            "degraded": degraded,
            "warnings": warnings,
        },
    )


def cmd_fetch(args: argparse.Namespace) -> None:
    payload = {
        "model": args.model,
        "input": [{"role": "user", "content": build_fetch_prompt(args.url, args.content, args.discussion)}],
        "tools": [{"type": "x_search", "enable_image_understanding": True, "enable_video_understanding": True}],
        "text": fetch_response_format(),
        "store": False,
    }
    data = _api_request("/responses", payload, args)
    citations = _extract_citations(data)
    try:
        document = parse_fetch_document(_extract_text(data))
    except (ValueError, json.JSONDecodeError) as error:
        raise GrokError("invalid_response", "xAI returned invalid structured X retrieval.") from error
    retrieval, warnings, degraded = enforce_live_fetch(document, citations, args.url, args.content, args.discussion)
    _emit_result(
        args,
        {
            "kind": "fetch",
            "model": args.model,
            "citations": citations,
            "degraded": degraded,
            "warnings": warnings,
            "retrieval": retrieval,
        },
    )


def cmd_models(args: argparse.Namespace) -> None:
    data = _api_request("/models", None, args)
    entries = data.get("data") or []
    if args.json:
        print(json.dumps(entries, ensure_ascii=False, indent=2))
        return
    for entry in entries:
        if isinstance(entry, dict):
            print(str(entry.get("id") or ""))


def _auth_status() -> dict:
    host_token = os.environ.get("GROK_SEARCH_HOST_OAUTH_TOKEN", "").strip()
    if host_token:
        return {"kind": "auth_status", "authenticated": True, "source": "host-xai", "refreshable": True, "state": "valid"}
    issues: list[tuple[str, str, bool]] = []
    cli_state, cli = _read_grok_cli_token()
    if cli_state == "valid" and cli is not None:
        if not _token_expired(str(cli.get("expires_at") or "")):
            return {"kind": "auth_status", "authenticated": True, "source": "grok-cli", "refreshable": True, "state": "valid"}
        issues.append(("grok-cli", "expired", True))
    elif cli_state == "malformed":
        issues.append(("grok-cli", "malformed", False))
    own_state, own = _read_own_tokens()
    if own_state == "valid" and own is not None:
        if not _token_expired(str(own.get("expires_at") or "")):
            return {"kind": "auth_status", "authenticated": True, "source": "plugin-oauth", "refreshable": bool(own.get("refresh_token")), "state": "valid"}
        issues.append(("plugin-oauth", "expired", bool(own.get("refresh_token"))))
    elif own_state in {"malformed", "unrefreshable"}:
        issues.append(("plugin-oauth", own_state, False))
    if os.environ.get("GROK_SEARCH_BLOCK_API_KEY") == "1":
        return {"kind": "auth_status", "authenticated": False, "source": "host-xai", "refreshable": True, "state": "unavailable"}
    if issues:
        source, state, refreshable = issues[0]
        return {"kind": "auth_status", "authenticated": False, "source": source, "refreshable": refreshable, "state": state}
    if os.environ.get("XAI_API_KEY", "").strip():
        return {"kind": "auth_status", "authenticated": True, "source": "env", "refreshable": False, "state": "valid"}
    return {"kind": "auth_status", "authenticated": False, "source": None, "refreshable": False, "state": "missing"}


def cmd_auth(args: argparse.Namespace) -> None:
    status_value = _auth_status()
    if args.json:
        print(json.dumps(status_value, ensure_ascii=False, indent=2))
        return
    source = status_value["source"] or "none"
    print(f"credential: {source}")
    print(f"state: {status_value['state']}")
    print(f"refreshable: {'yes' if status_value['refreshable'] else 'no'}")


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    result: dict = {}
    expected_state = ""

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return
        params = urllib.parse.parse_qs(parsed.query)
        code = (params.get("code") or [""])[0]
        callback_state = (params.get("state") or [""])[0]
        error = (params.get("error") or [""])[0]
        if callback_state != self.expected_state:
            error = error or "state_mismatch"
            code = ""
        if not _CallbackHandler.result:
            _CallbackHandler.result = {"code": code, "error": error}
        body = "<html><body><h2>Grok login complete</h2><p>You can close this tab.</p></body></html>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *_args):
        pass


def _tokens_from_payload(payload: dict, token_endpoint: str, previous_refresh: str = "") -> dict:
    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise GrokError("oauth_token_missing", "OAuth token endpoint returned no access token.")
    return {
        "access_token": access_token,
        "refresh_token": str(payload.get("refresh_token") or previous_refresh),
        "expires_at": _expires_at_iso(payload.get("expires_in")),
        "token_endpoint": token_endpoint,
        "obtained_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _device_session_path(session: str) -> Path:
    if not SESSION_RE.fullmatch(session):
        raise GrokError("device_session_invalid", "Device authorization session is invalid.")
    return DEVICE_HOME / f"{session}.json"


def _start_device() -> dict:
    discovery = _oauth_discovery(("device_authorization_endpoint", "token_endpoint"))
    endpoint = str(discovery["device_authorization_endpoint"])
    try:
        payload = _form_request(endpoint, {"client_id": OAUTH_CLIENT_ID, "scope": OAUTH_SCOPE})
    except OAuthError as error:
        raise GrokError("device_start_failed", error.description) from error
    device_code = str(payload.get("device_code") or "").strip()
    user_code = str(payload.get("user_code") or "").strip()
    verification_url = str(payload.get("verification_uri_complete") or payload.get("verification_uri") or "").strip()
    if not device_code or not user_code or not verification_url:
        raise GrokError("device_start_failed", "Device authorization endpoint returned incomplete instructions.")
    try:
        expires_in = max(1, int(payload.get("expires_in") or 600))
        interval = max(1, int(payload.get("interval") or 5))
    except (TypeError, ValueError) as error:
        raise GrokError("device_start_failed", "Device authorization endpoint returned invalid timing values.") from error
    session = secrets.token_urlsafe(24)
    expires_epoch = time.time() + expires_in
    _ensure_private_dir(DEVICE_HOME)
    _atomic_json(
        _device_session_path(session),
        {
            "deviceCode": device_code,
            "tokenEndpoint": str(discovery["token_endpoint"]),
            "interval": interval,
            "nextPollAt": time.time() + interval,
            "expiresEpoch": expires_epoch,
        },
    )
    return {
        "kind": "device_authorization",
        "session": session,
        "verificationUrl": verification_url,
        "userCode": user_code,
        "expiresAt": datetime.fromtimestamp(expires_epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _complete_device(session: str) -> dict:
    path = _device_session_path(session)
    state, pending = _private_json(path)
    if state != "present" or pending is None:
        raise GrokError("device_session_missing", "Device authorization session is missing or invalid.")
    interval = max(1, int(pending.get("interval") or 5))
    expires_epoch = float(pending.get("expiresEpoch") or 0)
    next_poll = float(pending.get("nextPollAt") or time.time())
    while time.time() < expires_epoch:
        delay = max(0.0, next_poll - time.time())
        if delay:
            time.sleep(delay)
        try:
            payload = _form_request(
                str(pending.get("tokenEndpoint") or ""),
                {
                    "grant_type": DEVICE_GRANT,
                    "client_id": OAUTH_CLIENT_ID,
                    "device_code": str(pending.get("deviceCode") or ""),
                },
            )
        except OAuthError as error:
            if error.code == "authorization_pending":
                next_poll = time.time() + interval
                continue
            if error.code == "slow_down":
                interval += 5
                next_poll = time.time() + interval
                continue
            path.unlink(missing_ok=True)
            if error.code in {"access_denied", "authorization_denied"}:
                raise GrokError("device_access_denied", "Device authorization was denied.") from error
            if error.code == "expired_token":
                raise GrokError("device_code_expired", "Device authorization code expired.") from error
            raise GrokError("device_login_failed", error.description) from error
        tokens = _tokens_from_payload(payload, str(pending["tokenEndpoint"]))
        _save_own_tokens(tokens)
        path.unlink(missing_ok=True)
        return {"kind": "auth_status", "authenticated": True, "source": "plugin-oauth", "refreshable": bool(tokens["refresh_token"]), "state": "valid"}
    path.unlink(missing_ok=True)
    raise GrokError("device_code_expired", "Device authorization code expired.")


def _loopback_login(args: argparse.Namespace) -> dict:
    discovery = _oauth_discovery(("authorization_endpoint", "token_endpoint"))
    verifier = base64.urlsafe_b64encode(os.urandom(64)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    callback_state = secrets.token_urlsafe(24)
    authorize_url = str(discovery["authorization_endpoint"]) + "?" + urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": OAUTH_CLIENT_ID,
            "redirect_uri": OAUTH_REDIRECT_URI,
            "scope": OAUTH_SCOPE,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": callback_state,
        }
    )
    _CallbackHandler.result = {}
    _CallbackHandler.expected_state = callback_state
    try:
        server = http.server.HTTPServer(("127.0.0.1", OAUTH_REDIRECT_PORT), _CallbackHandler)
    except OSError as error:
        raise GrokError("callback_bind_failed", f"Cannot bind the local OAuth callback: {error}") from error
    server.timeout = 1.0
    print(f"Open this URL to sign in:\n  {authorize_url}")
    if not args.no_browser:
        threading.Thread(target=webbrowser.open, args=(authorize_url,), daemon=True).start()
    deadline = time.time() + OAUTH_CALLBACK_TIMEOUT_SECONDS
    try:
        while time.time() < deadline and not _CallbackHandler.result:
            server.handle_request()
    finally:
        server.server_close()
    result = _CallbackHandler.result
    if not result or not result.get("code"):
        raise GrokError("login_failed", f"Loopback login failed: {result.get('error') or 'callback timeout'}")
    try:
        payload = _form_request(
            str(discovery["token_endpoint"]),
            {
                "grant_type": "authorization_code",
                "code": result["code"],
                "redirect_uri": OAUTH_REDIRECT_URI,
                "client_id": OAUTH_CLIENT_ID,
                "code_verifier": verifier,
            },
        )
    except OAuthError as error:
        raise GrokError("login_failed", error.description) from error
    tokens = _tokens_from_payload(payload, str(discovery["token_endpoint"]))
    _save_own_tokens(tokens)
    return {"kind": "auth_status", "authenticated": True, "source": "plugin-oauth", "refreshable": bool(tokens["refresh_token"]), "state": "valid"}


def cmd_login(args: argparse.Namespace) -> None:
    if args.complete:
        value = _complete_device(args.complete)
    elif args.device:
        started = _start_device()
        if args.start:
            value = started
        else:
            print(f"Open this URL to authorize Grok:\n  {started['verificationUrl']}")
            print(f"Code: {started['userCode']}")
            value = _complete_device(started["session"])
    else:
        own_state, _ = _read_own_tokens()
        if own_state == "valid" and not args.force:
            raise GrokError("already_authenticated", "Plugin OAuth already exists. Use --force to replace it.", "plugin-oauth")
        value = _loopback_login(args)
    if args.json:
        print(json.dumps(value, ensure_ascii=False, indent=2))
    elif value["kind"] == "auth_status":
        print("Grok login successful.")


def cmd_logout(_args: argparse.Namespace) -> None:
    with _exclusive_lock(OWN_LOCK_PATH):
        OWN_AUTH_PATH.unlink(missing_ok=True)
    print("Plugin OAuth removed.")


def _common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--max-citations", type=int, default=10, metavar="N")
    parser.add_argument("--credential-source", choices=["auto", "api-key"], default="auto")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="grok-search", description="Live X search and faithful X retrieval through Grok.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    search = subparsers.add_parser("x", help="search live X")
    search.add_argument("query")
    search.add_argument("--handle", action="append", default=[])
    search.add_argument("--exclude-handle", action="append", default=[])
    search.add_argument("--from", dest="from_date", default="")
    search.add_argument("--to", dest="to_date", default="")
    search.add_argument("--images", action="store_true")
    search.add_argument("--videos", action="store_true")
    search.add_argument("--brief", action="store_true")
    search.add_argument("--depth", choices=["quick", "deep"], default="quick")
    _common(search)
    search.set_defaults(func=cmd_x)

    fetch = subparsers.add_parser("fetch", help="retrieve an X post, thread, or X Article")
    fetch.add_argument("url")
    fetch.add_argument("--content", choices=["anchor", "authored"], default="anchor")
    fetch.add_argument("--discussion", action="store_true")
    _common(fetch)
    fetch.set_defaults(func=cmd_fetch)

    models = subparsers.add_parser("models", help="list available xAI models")
    models.add_argument("--timeout", type=int, default=30)
    models.add_argument("--json", action="store_true")
    models.add_argument("--credential-source", choices=["auto", "api-key"], default="auto")
    models.set_defaults(func=cmd_models)

    auth = subparsers.add_parser("auth", help="show active credential status")
    auth.add_argument("--json", action="store_true")
    auth.set_defaults(func=cmd_auth)

    login = subparsers.add_parser("login", help="authorize a Grok subscription")
    login.add_argument("--device", action="store_true")
    login.add_argument("--start", action="store_true")
    login.add_argument("--complete", default="")
    login.add_argument("--json", action="store_true")
    login.add_argument("--no-browser", action="store_true")
    login.add_argument("--force", action="store_true")
    login.set_defaults(func=cmd_login)

    logout = subparsers.add_parser("logout", help="remove plugin-owned OAuth")
    logout.set_defaults(func=cmd_logout)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        args.func(args)
        return 0
    except GrokError as error:
        if getattr(args, "json", False):
            print(json.dumps({"kind": "error", "code": error.code, "message": error.message, "source": error.source}, ensure_ascii=False, indent=2))
            return 0
        print(f"grok-search: {error.message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
