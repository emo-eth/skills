from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "session-history.py"
FAKE_CASS = ROOT / "tests" / "fixtures" / "fake_cass.py"

SPEC = importlib.util.spec_from_file_location("session_history_runtime", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
RUNTIME = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RUNTIME
SPEC.loader.exec_module(RUNTIME)


class SessionHistoryTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.home = Path(self.tempdir.name)
        self.env = {
            **os.environ,
            "SESSION_HISTORY_HOME": str(self.home / "session-history"),
            "SESSION_HISTORY_CASS": str(FAKE_CASS),
            "CASS_BIN": str(FAKE_CASS),
            "FAKE_CASS_SLEEP": "",
            "FAKE_CASS_FALLBACK": "",
            "FAKE_CASS_ERROR": "",
        }

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def invoke(self, args: list[str], extra_env: dict[str, str] | None = None) -> dict:
        env = {**self.env, **(extra_env or {})}
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        return json.loads(result.stdout)

    def mcp_exchange(self, requests: list[dict], extra_env: dict[str, str] | None = None) -> list[dict]:
        env = {**self.env, **(extra_env or {})}
        payload = "\n".join(json.dumps(req) for req in requests) + "\n"
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "mcp"],
            input=payload,
            capture_output=True,
            text=True,
            env=env,
            check=True,
        )
        lines = [line for line in result.stdout.splitlines() if line.strip()]
        return [json.loads(line) for line in lines]


class RecallTests(SessionHistoryTestCase):
    def test_recall_happy_path_hybrid(self) -> None:
        value = self.invoke(["recall", "--query", "hybrid", "--json", "--limit", "3", "--hybrid"])
        self.assertIn("answer", value)
        self.assertGreaterEqual(len(value["citations"]), 1)
        self.assertLessEqual(len(value["citations"]), 3)
        self.assertFalse(value["degraded"])
        harnesses = {citation["harness"] for citation in value["citations"]}
        self.assertTrue(harnesses.issubset({"pi", "omp", "codex", "claude"}))

    def test_recall_timeout_returns_unavailable(self) -> None:
        value = self.invoke(["recall", "--query", "hybrid", "--json"], extra_env={"FAKE_CASS_SLEEP": "3"})
        self.assertEqual(value["error"], "unavailable")

    def test_recall_lexical_degradation_warning(self) -> None:
        value = self.invoke(["recall", "--query", "hybrid", "--json"], extra_env={"FAKE_CASS_FALLBACK": "1"})
        self.assertTrue(value["degraded"])
        self.assertTrue(any("lexical" in warning.lower() for warning in value["warnings"]))


class InspectExpandTests(SessionHistoryTestCase):
    def test_inspect_shape(self) -> None:
        value = self.invoke(["inspect", "--session", "sess-pi-001", "--moment", "12", "--json"])
        self.assertEqual(value["session_id"], "sess-pi-001")
        self.assertIn("content", value["moment"])

    def test_expand_shape(self) -> None:
        value = self.invoke(["expand", "--session", "sess-pi-001", "--moment", "12", "--json"])
        self.assertEqual(value["session_id"], "sess-pi-001")
        self.assertTrue(value["moments"])
        self.assertIn("content", value["moments"][0])


class ResumeQueryTests(SessionHistoryTestCase):
    def test_resume_packet_extraction(self) -> None:
        value = self.invoke(["resume", "--session", "sess-pi-001", "--json"])
        self.assertEqual(value["session_id"], "sess-pi-001")
        self.assertLessEqual(len(value["excerpts"]), 3)
        self.assertTrue(value["decisions"])
        self.assertTrue(value["unfinished_work"])

    def test_resume_missing_unfinished_is_empty(self) -> None:
        value = self.invoke(["resume", "--session", "sess-omp-002", "--json"])
        self.assertEqual(value["unfinished_work"], [])

    def test_session_scoped_query(self) -> None:
        value = self.invoke(["query-session", "--session", "sess-omp-002", "--query", "OMP", "--json"])
        self.assertEqual(value["session_id"], "sess-omp-002")
        self.assertTrue(value["moments"])
        for moment in value["moments"]:
            self.assertTrue(moment["content"])


class LifecycleTests(SessionHistoryTestCase):
    def test_exclude_filters_recall(self) -> None:
        self.invoke(["manage", "--action", "exclude", "--session", "sess-excluded", "--json"])
        value = self.invoke(["recall", "--query", "excluded", "--json"])
        session_ids = {citation["session_id"] for citation in value["citations"]}
        self.assertNotIn("sess-excluded", session_ids)

    def test_purge_filters_all_paths(self) -> None:
        self.invoke(["manage", "--action", "purge", "--session", "sess-purged", "--json"])
        search = self.invoke(["recall", "--query", "purged", "--json"])
        self.assertNotIn("sess-purged", {c["session_id"] for c in search["citations"]})
        denied = self.invoke(["inspect", "--session", "sess-purged", "--moment", "5", "--json"])
        self.assertEqual(denied["error"], "denied")

    def test_reinclude_restores_session(self) -> None:
        self.invoke(["manage", "--action", "exclude", "--session", "sess-pi-001", "--json"])
        blocked = self.invoke(["recall", "--query", "hybrid", "--json"])
        self.assertNotIn("sess-pi-001", {c["session_id"] for c in blocked["citations"]})
        self.invoke(["manage", "--action", "reinclude", "--session", "sess-pi-001", "--json"])
        restored = self.invoke(["recall", "--query", "hybrid", "--json"])
        self.assertIn("sess-pi-001", {c["session_id"] for c in restored["citations"]})

    def test_disconnect_retains_without_purge_flag(self) -> None:
        value = self.invoke(["manage", "--action", "disconnect", "--source", "remote-claude", "--json"])
        self.assertEqual(value["action"], "disconnect")
        self.assertTrue(value["ok"])
        fake = subprocess.run(
            [sys.executable, str(FAKE_CASS), "sources", "remove", "remote-claude", "--json"],
            capture_output=True,
            text=True,
            check=True,
            env=self.env,
        )
        payload = json.loads(fake.stdout)
        self.assertFalse(payload["purged"])
        self.assertTrue(payload["retained"])


class StatusMcpTests(SessionHistoryTestCase):
    def test_status_reports_sources_and_warnings(self) -> None:
        value = self.invoke(["status", "--json"])
        self.assertTrue(value["healthy"])
        self.assertTrue(value["sources"])
        self.assertTrue(any("offline" in warning.lower() for warning in value["warnings"]))

    def test_mcp_initialize_tools_list_and_recall(self) -> None:
        responses = self.mcp_exchange(
            [
                {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05"}},
                {"jsonrpc": "2.0", "method": "notifications/initialized"},
                {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                {
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {"name": "session_recall", "arguments": {"query": "hybrid", "limit": 2}},
                },
            ]
        )
        self.assertEqual(responses[0]["result"]["serverInfo"]["name"], "session-history")
        tool_names = [tool["name"] for tool in responses[1]["result"]["tools"]]
        self.assertIn("session_recall", tool_names)
        self.assertIn("session_manage", tool_names)
        recall_payload = json.loads(responses[2]["result"]["content"][0]["text"])
        self.assertIn("citations", recall_payload)


class RuntimeUnitTests(unittest.TestCase):
    def test_normalize_harness(self) -> None:
        self.assertEqual(RUNTIME.normalize_harness("oh-my-pi"), "omp")
        self.assertEqual(RUNTIME.normalize_harness("claude-code"), "claude")
        self.assertEqual(RUNTIME.normalize_harness("pi"), "pi")


if __name__ == "__main__":
    unittest.main()
