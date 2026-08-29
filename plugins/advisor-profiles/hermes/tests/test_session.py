from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERMES_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERMES_DIR))
TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS_DIR))

from fake_ctx import FakeState

_SPEC = importlib.util.spec_from_file_location(
    "advisor_profiles_hermes",
    HERMES_DIR / "__init__.py",
    submodule_search_locations=[str(HERMES_DIR)],
)
assert _SPEC is not None and _SPEC.loader is not None
_PKG = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = _PKG
_SPEC.loader.exec_module(_PKG)

MAX_PENDING_FOLLOWUPS = _PKG.session.MAX_PENDING_FOLLOWUPS
MAX_SEEN_NOTES = _PKG.session.MAX_SEEN_NOTES
MAX_SESSIONS = _PKG.session.MAX_SESSIONS
MAX_STATUS_PER_SESSION = _PKG.session.MAX_STATUS_PER_SESSION
STATE_KEY = _PKG.session.STATE_KEY
SessionData = _PKG.session.SessionData
SessionStore = _PKG.session.SessionStore


class SessionStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.state = FakeState()
        self.store = SessionStore(self.state)

    def test_defaults_materialize_on_first_touch(self):
        data = self.store.mutate("s1", ["vibe", "code-quality"], lambda s: None)
        self.assertEqual(data.selection, ["vibe", "code-quality"])
        self.assertEqual(data.selection_source, "default")
        self.assertTrue(data.initialized)

    def test_pending_selection_is_consumed_by_first_session(self):
        self.store.set_pending({"selection": ["vibe"], "source": "use"})
        data = self.store.mutate("s1", ["vibe", "code-quality"], lambda s: None)
        self.assertEqual(data.selection, ["vibe"])
        self.assertEqual(data.selection_source, "use")

    def test_pending_off_disables_reviews(self):
        self.store.set_pending({"selection": [], "source": "off"})
        data = self.store.mutate("s1", ["vibe"], lambda s: None)
        self.assertEqual(data.selection, [])
        self.assertEqual(data.selection_source, "off")

    def test_pending_is_single_shot(self):
        self.store.set_pending({"selection": ["vibe"], "source": "use"})
        self.store.mutate("s1", ["vibe"], lambda s: None)
        later = self.store.mutate("s2", ["code-quality"], lambda s: None)
        self.assertEqual(later.selection, ["code-quality"])

    def test_existing_session_ignores_defaults_and_pending(self):
        self.store.set_pending({"selection": ["code-quality"], "source": "use"})
        self.store.mutate("s1", ["vibe"], lambda s: None)
        self.store.mutate("s1", ["other"], lambda s: None)
        data = self.store.mutate("s1", ["other-defaults"], lambda s: None)
        self.assertEqual(data.selection, ["code-quality"])

    def test_mutation_persists_through_state_facade(self):
        def apply(data: SessionData) -> None:
            data.selection = ["vibe"]
            data.add_status({"advisor": "vibe", "state": "pass"})

        self.store.mutate("s1", ["vibe"], apply)
        reloaded = self.store.mutate("s1", ["vibe"], lambda s: None)
        self.assertEqual(reloaded.selection, ["vibe"])
        self.assertEqual(reloaded.status[0]["state"], "pass")
        raw = self.state.data[STATE_KEY]
        self.assertIn("s1", raw["sessions"])

    def test_status_is_bounded_per_session(self):
        def apply(data: SessionData) -> None:
            data.add_status({"advisor": "vibe", "state": "pass"})

        for _ in range(MAX_STATUS_PER_SESSION + 10):
            self.store.mutate("s1", ["vibe"], apply)
        data = self.store.mutate("s1", ["vibe"], lambda s: None)
        self.assertEqual(len(data.status), MAX_STATUS_PER_SESSION)

    def test_seen_notes_are_bounded(self):
        def apply(data: SessionData) -> None:
            data.record_note(f"note {len(data.seen_notes)}")

        for _ in range(MAX_SEEN_NOTES + 20):
            self.store.mutate("s1", ["vibe"], apply)
        data = self.store.mutate("s1", ["vibe"], lambda s: None)
        self.assertEqual(len(data.seen_notes), MAX_SEEN_NOTES)
        self.assertNotIn("note 0", data.seen_notes)

    def test_pending_followups_are_bounded(self):
        def apply(data: SessionData) -> None:
            data.pending_followups.append(f"message {len(data.pending_followups)}")

        for _ in range(MAX_PENDING_FOLLOWUPS + 5):
            self.store.mutate("s1", ["vibe"], apply)
        data = self.store.mutate("s1", ["vibe"], lambda s: None)
        self.assertEqual(len(data.pending_followups), MAX_PENDING_FOLLOWUPS)

    def test_old_sessions_evicted_keeping_current(self):
        for index in range(MAX_SESSIONS + 5):
            self.store.mutate(f"s{index}", ["vibe"], lambda s: None)
        data = self.store.mutate("current", ["vibe"], lambda s: None)
        self.assertIsNotNone(data)
        raw = self.state.data[STATE_KEY]
        self.assertIn("current", raw["sessions"])
        self.assertLessEqual(len(raw["sessions"]), MAX_SESSIONS)

    def test_corrupt_session_entry_is_rebuilt(self):
        self.store.mutate("s1", ["vibe"], lambda s: None)
        raw = self.state.data[STATE_KEY]
        raw["sessions"]["s1"] = {"selection": "not-a-list", "initialized": True}
        data = self.store.mutate("s1", ["vibe"], lambda s: None)
        self.assertEqual(data.selection, [])

    def test_take_pending_returns_and_clears(self):
        self.store.set_pending({"selection": ["vibe"], "source": "use"})
        pending = self.store.take_pending()
        self.assertEqual(pending, {"selection": ["vibe"], "source": "use"})
        self.assertIsNone(self.store.take_pending())


if __name__ == "__main__":
    unittest.main()
