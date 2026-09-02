from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "grok-search.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("grok_search_runtime", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)


class AuthContractTest(unittest.TestCase):
    def run_auth(self, root: Path, extra: dict[str, str] | None = None) -> dict:
        env = {
            **os.environ,
            "HOME": str(root),
            "GROK_HOME": str(root / "grok"),
            "GROK_SEARCH_HOME": str(root / "search"),
        }
        env.pop("XAI_API_KEY", None)
        env.pop("GROK_SEARCH_HOST_OAUTH_TOKEN", None)
        if extra:
            env.update(extra)
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "auth", "--json"],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        return json.loads(result.stdout)

    def test_subscription_cli_precedes_api_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "grok").mkdir()
            (root / "grok" / "auth.json").write_text(json.dumps({"xai": {"key": "subscription-token"}}))
            value = self.run_auth(root, {"XAI_API_KEY": "billed-key"})
            self.assertEqual(value["source"], "grok-cli")

    def test_host_oauth_precedes_every_other_source(self):
        with tempfile.TemporaryDirectory() as directory:
            value = self.run_auth(Path(directory), {"GROK_SEARCH_HOST_OAUTH_TOKEN": "host-token", "XAI_API_KEY": "billed-key"})
            self.assertEqual(value["source"], "host-xai")

    def test_api_key_is_used_only_when_subscription_is_absent(self):
        with tempfile.TemporaryDirectory() as directory:
            value = self.run_auth(Path(directory), {"XAI_API_KEY": "billed-key"})
            self.assertEqual(value["source"], "env")
            self.assertNotIn("billed-key", json.dumps(value))

    def test_malformed_plugin_store_does_not_fall_back_to_api_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "search").mkdir()
            store = root / "search" / "auth.json"
            store.write_text("not-json")
            os.chmod(store, 0o600)
            value = self.run_auth(root, {"XAI_API_KEY": "billed-key"})
            self.assertEqual(value["source"], "plugin-oauth")
            self.assertEqual(value["state"], "malformed")
            self.assertFalse(value["authenticated"])

    def test_device_flow_returns_public_instructions_and_stores_private_tokens(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = (RUNTIME.OWN_HOME, RUNTIME.OWN_AUTH_PATH, RUNTIME.OWN_LOCK_PATH, RUNTIME.DEVICE_HOME)
            RUNTIME.OWN_HOME = root
            RUNTIME.OWN_AUTH_PATH = root / "auth.json"
            RUNTIME.OWN_LOCK_PATH = root / "auth.lock"
            RUNTIME.DEVICE_HOME = root / "device"
            discovery = {
                "device_authorization_endpoint": "https://auth.x.ai/oauth2/device/code",
                "token_endpoint": "https://auth.x.ai/oauth2/token",
            }
            device = {
                "device_code": "secret-device-code",
                "user_code": "ABCD-EFGH",
                "verification_uri": "https://accounts.x.ai/activate",
                "expires_in": 600,
                "interval": 1,
            }
            token = {"access_token": "secret-access-token", "refresh_token": "secret-refresh-token", "expires_in": 3600}
            try:
                with mock.patch.object(RUNTIME, "_oauth_discovery", return_value=discovery), mock.patch.object(RUNTIME, "_form_request", side_effect=[device, token]):
                    started = RUNTIME._start_device()
                    self.assertEqual(started["kind"], "device_authorization")
                    self.assertNotIn("secret-device-code", json.dumps(started))
                    pending_path = RUNTIME._device_session_path(started["session"])
                    pending = json.loads(pending_path.read_text())
                    pending["nextPollAt"] = 0
                    RUNTIME._atomic_json(pending_path, pending)
                    completed = RUNTIME._complete_device(started["session"])
                self.assertTrue(completed["authenticated"])
                self.assertEqual(completed["source"], "plugin-oauth")
                self.assertEqual(RUNTIME.OWN_AUTH_PATH.stat().st_mode & 0o777, 0o600)
                self.assertFalse(pending_path.exists())
            finally:
                RUNTIME.OWN_HOME, RUNTIME.OWN_AUTH_PATH, RUNTIME.OWN_LOCK_PATH, RUNTIME.DEVICE_HOME = original

    def test_explicit_api_key_selection_does_not_consume_subscription(self):
        with mock.patch.dict(os.environ, {"XAI_API_KEY": "billed-key", "GROK_SEARCH_HOST_OAUTH_TOKEN": "host-token"}, clear=False):
            token, source = RUNTIME._resolve_credential(SimpleNamespace(credential_source="api-key"))
        self.assertEqual((token, source), ("billed-key", "env"))

    def test_unusable_cli_oauth_yields_to_valid_plugin_oauth(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = (RUNTIME.GROK_AUTH_PATH, RUNTIME.OWN_HOME, RUNTIME.OWN_AUTH_PATH, RUNTIME.OWN_LOCK_PATH)
            RUNTIME.GROK_AUTH_PATH = root / "grok" / "auth.json"
            RUNTIME.OWN_HOME = root / "search"
            RUNTIME.OWN_AUTH_PATH = root / "search" / "auth.json"
            RUNTIME.OWN_LOCK_PATH = root / "search" / "auth.lock"
            RUNTIME.GROK_AUTH_PATH.parent.mkdir()
            RUNTIME.GROK_AUTH_PATH.write_text(json.dumps({"xai": {"key": "expired-token", "expires_at": "2000-01-01T00:00:00Z"}}))
            RUNTIME.OWN_HOME.mkdir()
            RUNTIME.OWN_AUTH_PATH.write_text(json.dumps({"access_token": "plugin-token", "refresh_token": "plugin-refresh"}))
            os.chmod(RUNTIME.OWN_AUTH_PATH, 0o600)
            try:
                token, source = RUNTIME._resolve_credential(
                    SimpleNamespace(credential_source="auto"),
                    allow_refresh=False,
                )
            finally:
                RUNTIME.GROK_AUTH_PATH, RUNTIME.OWN_HOME, RUNTIME.OWN_AUTH_PATH, RUNTIME.OWN_LOCK_PATH = original
        self.assertEqual((token, source), ("plugin-token", "plugin-oauth"))

    def test_failed_subscription_candidate_never_yields_to_api_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = (RUNTIME.GROK_AUTH_PATH, RUNTIME.OWN_HOME, RUNTIME.OWN_AUTH_PATH, RUNTIME.OWN_LOCK_PATH)
            RUNTIME.GROK_AUTH_PATH = root / "missing-grok.json"
            RUNTIME.OWN_HOME = root / "search"
            RUNTIME.OWN_AUTH_PATH = root / "search" / "auth.json"
            RUNTIME.OWN_LOCK_PATH = root / "search" / "auth.lock"
            try:
                with mock.patch.dict(os.environ, {"XAI_API_KEY": "billed-key"}, clear=False):
                    with self.assertRaises(RUNTIME.GrokError) as raised:
                        RUNTIME._resolve_credential(
                            SimpleNamespace(credential_source="auto"),
                            allow_refresh=False,
                            excluded_sources=frozenset({"grok-cli"}),
                        )
            finally:
                RUNTIME.GROK_AUTH_PATH, RUNTIME.OWN_HOME, RUNTIME.OWN_AUTH_PATH, RUNTIME.OWN_LOCK_PATH = original
        self.assertEqual(raised.exception.code, "auth_expired")

    def test_host_fallback_marker_blocks_api_key_without_other_subscription(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = (RUNTIME.GROK_AUTH_PATH, RUNTIME.OWN_HOME, RUNTIME.OWN_AUTH_PATH, RUNTIME.OWN_LOCK_PATH)
            RUNTIME.GROK_AUTH_PATH = root / "missing-grok.json"
            RUNTIME.OWN_HOME = root / "search"
            RUNTIME.OWN_AUTH_PATH = root / "search" / "auth.json"
            RUNTIME.OWN_LOCK_PATH = root / "search" / "auth.lock"
            try:
                with mock.patch.dict(
                    os.environ,
                    {"XAI_API_KEY": "billed-key", "GROK_SEARCH_BLOCK_API_KEY": "1"},
                    clear=False,
                ):
                    status = RUNTIME._auth_status()
                    with self.assertRaises(RUNTIME.GrokError) as raised:
                        RUNTIME._resolve_credential(SimpleNamespace(credential_source="auto"))
            finally:
                RUNTIME.GROK_AUTH_PATH, RUNTIME.OWN_HOME, RUNTIME.OWN_AUTH_PATH, RUNTIME.OWN_LOCK_PATH = original
        self.assertEqual(raised.exception.code, "host_oauth_unavailable")
        self.assertEqual(status["source"], "host-xai")
        self.assertEqual(status["state"], "unavailable")


if __name__ == "__main__":
    unittest.main()
