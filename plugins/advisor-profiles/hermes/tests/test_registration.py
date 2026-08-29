from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERMES_DIR = Path(__file__).resolve().parents[1]
TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HERMES_DIR))
sys.path.insert(0, str(TESTS_DIR))

from fake_ctx import FakeCtx, FakeLlm, FakeLlmResult, FakeState

_SPEC = importlib.util.spec_from_file_location(
    "advisor_profiles_hermes",
    HERMES_DIR / "__init__.py",
    submodule_search_locations=[str(HERMES_DIR)],
)
assert _SPEC is not None and _SPEC.loader is not None
MODULE = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = MODULE
_SPEC.loader.exec_module(MODULE)

FOLLOWUP_MARK = MODULE.review.FOLLOWUP_MARK

WATCHDOG = """
instructions: |
  Review like a careful senior engineer.
advisors:
  - name: vibe
    enabled: true
    instructions: |
      Enforce the vibe contract.
  - name: code-quality
    enabled: true
    instructions: |
      Watch for regressions.
  - name: dormant
    enabled: false
    instructions: |
      Disabled by default.
"""


def pass_result() -> FakeLlmResult:
    return FakeLlmResult(parsed={"verdict": "pass"})


def note_result(severity: str, note: str) -> FakeLlmResult:
    return FakeLlmResult(parsed={"verdict": "note", "severity": severity, "note": note})


class AdvisorProfilesPluginTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.project = self.root / "project"
        self.project.mkdir()
        self._old_home = os.environ.get("HERMES_HOME")
        os.environ["HERMES_HOME"] = str(self.home)
        self._old_cwd = MODULE.watchdog.cwd
        MODULE.watchdog.cwd = lambda: self.project
        (self.project / "WATCHDOG.yml").write_text(WATCHDOG, encoding="utf-8")

    def tearDown(self) -> None:
        MODULE.watchdog.cwd = self._old_cwd
        if self._old_home is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = self._old_home
        self._tmp.cleanup()

    def _plugin(self, llm=None, capability=False, state=None, inject_result=True):
        ctx = FakeCtx(capability=capability, llm=llm, state=state)
        ctx.inject_result = inject_result
        plugin = MODULE.AdvisorProfilesPlugin(ctx)
        plugin.register()
        return plugin, ctx

    def test_registers_hooks_and_command(self):
        plugin, ctx = self._plugin()
        self.assertIn("post_llm_call", ctx.hooks)
        self.assertIn("on_session_start", ctx.hooks)
        self.assertIn("advisor-profile", ctx.commands)
        self.assertEqual(ctx.commands["advisor-profile"]["args_hint"], "status|list|use <name>|all|off|reload")

    def test_new_session_defaults_to_enabled_advisors(self):
        llm = FakeLlm(results=[pass_result(), pass_result()])
        plugin, ctx = self._plugin(llm=llm)
        plugin._on_session_start(session_id="s1")
        plugin._on_post_llm_call(session_id="s1", user_message="hi", assistant_response="ok", conversation_history=[])
        self.assertEqual(len(llm.calls), 2)
        self.assertEqual(ctx.injected, [])
        status = plugin._handle_command("status")
        self.assertIn("all enabled (2 advisors)", status)
        self.assertIn("pass", status)
        self.assertNotIn("dormant", status)

    def test_use_unknown_advisor_reports_known_names(self):
        plugin, _ = self._plugin()
        result = plugin._handle_command("use ghost")
        self.assertIn("Unknown advisor 'ghost'", result)
        self.assertIn("vibe", result)
        self.assertIn("dormant", result)

    def test_use_off_and_status_round_trip(self):
        plugin, ctx = self._plugin()
        plugin._on_session_start(session_id="s1")
        self.assertEqual(plugin._handle_command("use vibe"), "Advisor review: vibe")
        self.assertEqual(plugin._handle_command("off"), "Advisor review is off for this session.")
        llm = ctx.llm
        plugin._on_post_llm_call(session_id="s1", user_message="hi", assistant_response="ok", conversation_history=[])
        self.assertEqual(llm.calls, [])
        self.assertIn("Advisor review: off", plugin._handle_command("status"))

    def test_use_all_selects_every_enabled_advisor(self):
        plugin, _ = self._plugin()
        plugin._on_session_start(session_id="s1")
        result = plugin._handle_command("use all")
        self.assertIn("vibe", result)
        self.assertIn("code-quality", result)
        self.assertNotIn("dormant", result)

    def test_bare_all_command_selects_all_enabled(self):
        plugin, _ = self._plugin()
        plugin._on_session_start(session_id="s1")
        result = plugin._handle_command("all")
        self.assertIn("vibe", result)
        self.assertIn("code-quality", result)
        self.assertNotIn("dormant", result)
        status = plugin._handle_command("status")
        self.assertIn("vibe, code-quality", status)
        self.assertNotIn("dormant", status)

    def test_use_matches_by_slug_and_keeps_display_name(self):
        (self.project / "WATCHDOG.yml").write_text(
            "advisors:\n  - name: Vibe Advisor\n    instructions: x\n", encoding="utf-8"
        )
        plugin, _ = self._plugin()
        plugin._on_session_start(session_id="s1")
        result = plugin._handle_command("use vibe-advisor")
        self.assertIn("Advisor review: vibe-advisor", result)
        status = plugin._handle_command("status")
        self.assertIn("Vibe Advisor", status)

    def test_concern_injects_exactly_one_marked_followup(self):
        llm = FakeLlm(results=[note_result("concern", "The vibe clause is broken.")])
        plugin, ctx = self._plugin(llm=llm)
        plugin._on_session_start(session_id="s1")
        plugin._handle_command("use vibe")
        plugin._on_post_llm_call(session_id="s1", user_message="do it", assistant_response="done", conversation_history=[])
        self.assertEqual(len(ctx.injected), 1)
        message = ctx.injected[0]
        self.assertTrue(message.startswith(FOLLOWUP_MARK))
        self.assertIn("The vibe clause is broken.", message)
        status = plugin._handle_command("status")
        self.assertIn("follow-up delivered", status)

    def test_generated_correction_turn_is_not_reviewed(self):
        llm = FakeLlm(results=[note_result("blocker", "Fix the invariant.")])
        plugin, ctx = self._plugin(llm=llm)
        plugin._on_session_start(session_id="s1")
        plugin._handle_command("use vibe")
        plugin._on_post_llm_call(session_id="s1", user_message="do it", assistant_response="done", conversation_history=[])
        calls_after_injection = len(llm.calls)
        plugin._on_post_llm_call(
            session_id="s1",
            user_message=ctx.injected[0],
            assistant_response="addressed",
            conversation_history=[],
        )
        self.assertEqual(len(llm.calls), calls_after_injection)
        status = plugin._handle_command("status")
        self.assertIn("generated follow-up turn", status)

    def test_exact_normalized_note_dedupes_per_session(self):
        llm = FakeLlm(results=[
            note_result("concern", "Drop  the\n  trailing work."),
            note_result("concern", "Drop the trailing work."),
        ])
        plugin, ctx = self._plugin(llm=llm)
        plugin._on_session_start(session_id="s1")
        plugin._on_post_llm_call(session_id="s1", user_message="t1", assistant_response="a1", conversation_history=[])
        plugin._on_post_llm_call(session_id="s1", user_message="t2", assistant_response="a2", conversation_history=[])
        self.assertEqual(len(ctx.injected), 1)
        status = plugin._handle_command("status")
        self.assertIn("duplicate note suppressed", status)

    def test_distinct_note_on_other_session_injects_again(self):
        llm = FakeLlm(results=[
            note_result("concern", "Same text."),
            note_result("concern", "Same text."),
        ])
        plugin, ctx = self._plugin(llm=llm)
        plugin._on_session_start(session_id="s1")
        plugin._handle_command("use vibe")
        plugin._on_post_llm_call(session_id="s1", user_message="t1", assistant_response="a1", conversation_history=[])
        plugin._on_session_start(session_id="s2")
        plugin._handle_command("use vibe")
        plugin._on_post_llm_call(session_id="s2", user_message="t2", assistant_response="a2", conversation_history=[])
        self.assertEqual(len(ctx.injected), 2)

    def test_one_followup_maximum_per_turn_with_two_advisors(self):
        llm = FakeLlm(results=[
            note_result("blocker", "A is broken."),
            note_result("blocker", "B is broken too."),
        ])
        plugin, ctx = self._plugin(llm=llm)
        plugin._on_session_start(session_id="s1")
        plugin._on_post_llm_call(session_id="s1", user_message="t", assistant_response="a", conversation_history=[])
        self.assertEqual(len(ctx.injected), 1)
        self.assertIn("A is broken.", ctx.injected[0])

    def test_blocker_outranks_concern_for_injection(self):
        llm = FakeLlm(results=[
            note_result("concern", "Concern from vibe."),
            note_result("blocker", "Blocker from code-quality."),
        ])
        plugin, ctx = self._plugin(llm=llm)
        plugin._on_session_start(session_id="s1")
        plugin._on_post_llm_call(session_id="s1", user_message="t", assistant_response="a", conversation_history=[])
        self.assertEqual(len(ctx.injected), 1)
        self.assertIn("Blocker from code-quality.", ctx.injected[0])

    def test_nit_is_status_only_never_injected(self):
        llm = FakeLlm(results=[note_result("nit", "Consider a rename.")])
        plugin, ctx = self._plugin(llm=llm)
        plugin._on_session_start(session_id="s1")
        plugin._handle_command("use vibe")
        plugin._on_post_llm_call(session_id="s1", user_message="t", assistant_response="a", conversation_history=[])
        self.assertEqual(ctx.injected, [])
        self.assertIn("nit — Consider a rename.", plugin._handle_command("status"))

    def test_explicit_model_ungranted_is_visible_no_model(self):
        (self.project / "WATCHDOG.yml").write_text(
            "advisors:\n  - name: senior\n    model: vendor/model-x\n    instructions: Be senior.\n",
            encoding="utf-8",
        )
        llm = FakeLlm(results=[pass_result()])
        plugin, ctx = self._plugin(llm=llm, capability=False)
        plugin._on_session_start(session_id="s1")
        plugin._on_post_llm_call(session_id="s1", user_message="t", assistant_response="a", conversation_history=[])
        self.assertEqual(llm.calls, [])
        self.assertEqual(ctx.injected, [])
        status = plugin._handle_command("status")
        self.assertIn("no_model", status)
        self.assertIn("vendor/model-x", status)

    def test_explicit_provider_and_model_used_when_granted(self):
        (self.project / "WATCHDOG.yml").write_text(
            "advisors:\n  - name: senior\n    model: vendor/model-x\n    instructions: Be senior.\n",
            encoding="utf-8",
        )
        llm = FakeLlm(results=[pass_result()])
        plugin, ctx = self._plugin(llm=llm, capability=True)
        plugin._on_session_start(session_id="s1")
        plugin._on_post_llm_call(session_id="s1", user_message="t", assistant_response="a", conversation_history=[])
        self.assertEqual(llm.calls[0]["provider"], "vendor")
        self.assertEqual(llm.calls[0]["model"], "model-x")
        status = plugin._handle_command("status")
        self.assertIn("llm.model_override", status)
        self.assertIn("llm.provider_override", status)

    def test_advisor_failure_never_fails_turn_and_is_visible(self):
        llm = FakeLlm(error=RuntimeError("provider 500"))
        plugin, ctx = self._plugin(llm=llm)
        plugin._on_session_start(session_id="s1")
        plugin._handle_command("use vibe")
        plugin._on_post_llm_call(session_id="s1", user_message="t", assistant_response="a", conversation_history=[])
        self.assertEqual(ctx.injected, [])
        status = plugin._handle_command("status")
        self.assertIn("provider 500", status)
        self.assertIn("error", status)

    def test_hook_level_failure_is_recorded_not_raised(self):
        llm = FakeLlm(results=[pass_result()])
        plugin, ctx = self._plugin(llm=llm)
        plugin._on_session_start(session_id="s1")

        def boom(*args, **kwargs):
            raise ValueError("internal review failure")

        plugin._reviewer.review_turn = boom
        result = plugin._on_post_llm_call(
            session_id="s1", user_message="t", assistant_response="a", conversation_history=[]
        )
        self.assertIsNone(result)
        self.assertIn("internal review failure", plugin._handle_command("status"))

    def test_failed_injection_is_recorded_and_retried_next_turn(self):
        llm = FakeLlm(results=[
            note_result("blocker", "Must fix."),
            note_result("blocker", "Must fix."),
        ])
        plugin, ctx = self._plugin(llm=llm, inject_result=False)
        plugin._on_session_start(session_id="s1")
        plugin._handle_command("use vibe")
        plugin._on_post_llm_call(session_id="s1", user_message="t1", assistant_response="a1", conversation_history=[])
        status = plugin._handle_command("status")
        self.assertIn("delivery failed", status)
        self.assertEqual(len(ctx.injected), 1)
        plugin._on_post_llm_call(session_id="s1", user_message="t2", assistant_response="a2", conversation_history=[])
        self.assertEqual(len(ctx.injected), 2)

    def test_use_before_any_session_applies_to_next_session(self):
        plugin, ctx = self._plugin()
        result = plugin._handle_command("use vibe")
        self.assertIn("next session", result)
        plugin._on_session_start(session_id="fresh")
        self.assertIn("Advisor review: vibe", plugin._handle_command("status"))

    def test_status_before_any_session_is_helpful(self):
        plugin, _ = self._plugin()
        self.assertIn("No active session yet", plugin._handle_command("status"))

    def test_reload_reshapes_roster_and_drops_stale_selection(self):
        plugin, _ = self._plugin()
        plugin._on_session_start(session_id="s1")
        plugin._handle_command("use vibe")
        (self.project / "WATCHDOG.yml").write_text(
            "advisors:\n  - name: vibe\n  - name: newcomer\n", encoding="utf-8"
        )
        result = plugin._handle_command("reload")
        self.assertIn("newcomer", result)
        self.assertIn("vibe", plugin._handle_command("status"))
        (self.project / "WATCHDOG.yml").write_text(
            "advisors:\n  - name: newcomer\n", encoding="utf-8"
        )
        plugin._handle_command("reload")
        self.assertIn("Advisor review: off", plugin._handle_command("status"))

    def test_list_shows_enabled_flags_sources_and_tool_limits(self):
        (self.project / "WATCHDOG.yml").write_text(
            "advisors:\n  - name: tooled\n    tools: [grep, read]\n",
            encoding="utf-8",
        )
        plugin, _ = self._plugin()
        listing = plugin._handle_command("list")
        self.assertIn("tooled: enabled", listing)
        self.assertIn("tools [grep, read]", listing)
        self.assertIn("OMP-only", listing)
        self.assertIn("WATCHDOG.yml", listing)

    def test_status_notes_tools_as_unsupported_when_configured(self):
        (self.project / "WATCHDOG.yml").write_text(
            "advisors:\n  - name: tooled\n    tools: [grep]\n",
            encoding="utf-8",
        )
        plugin, _ = self._plugin()
        plugin._on_session_start(session_id="s1")
        status = plugin._handle_command("status")
        self.assertIn("no tool loop on Hermes", status)

    def test_usage_help_text(self):
        plugin, _ = self._plugin()
        usage = plugin._handle_command("")
        for fragment in ("status", "list", "use <name>", "use all", "off", "reload"):
            self.assertIn(fragment, usage)

    def test_state_is_keyed_by_session_id_and_bounded(self):
        state = FakeState()
        plugin, _ = self._plugin(state=state)
        plugin._on_session_start(session_id="s1")
        plugin._handle_command("use vibe")
        raw = state.data["advisor-profiles.v1"]
        self.assertIn("s1", raw["sessions"])
        self.assertEqual(raw["sessions"]["s1"]["selection"], ["vibe"])


if __name__ == "__main__":
    unittest.main()
