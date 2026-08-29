from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERMES_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERMES_DIR))
TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS_DIR))

from fake_ctx import FakeLlm, FakeLlmResult

_SPEC = importlib.util.spec_from_file_location(
    "advisor_profiles_hermes",
    HERMES_DIR / "__init__.py",
    submodule_search_locations=[str(HERMES_DIR)],
)
assert _SPEC is not None and _SPEC.loader is not None
_PKG = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = _PKG
_SPEC.loader.exec_module(_PKG)

FOLLOWUP_MARK = _PKG.review.FOLLOWUP_MARK
REVIEW_SCHEMA = _PKG.review.REVIEW_SCHEMA
AdvisorOutcome = _PKG.review.AdvisorOutcome
Reviewer = _PKG.review.Reviewer
build_review_instruction = _PKG.review.build_review_instruction
build_transcript = _PKG.review.build_transcript
followup_text = _PKG.review.followup_text
normalize_note = _PKG.review.normalize_note
Advisor = _PKG.watchdog.Advisor
Roster = _PKG.watchdog.Roster


def roster_with(*advisors: Advisor, shared: str = "") -> Roster:
    return Roster(advisors={advisor.slug: advisor for advisor in advisors}, instructions=shared)


def pass_result() -> FakeLlmResult:
    return FakeLlmResult(parsed={"verdict": "pass"})


def note_result(severity: str, note: str) -> FakeLlmResult:
    return FakeLlmResult(parsed={"verdict": "note", "severity": severity, "note": note})


class ReviewerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.advisor = Advisor(name="vibe", instructions="Hold the vibe.")
        self.roster = roster_with(self.advisor, shared="Shared rules.")

    def test_pass_verdict_yields_pass_outcome(self):
        llm = FakeLlm(results=[pass_result()])
        outcomes = Reviewer(llm).review_turn(self.roster, ["vibe"], "u", "a")
        self.assertEqual(outcomes, [AdvisorOutcome(advisor="vibe", state="pass")])
        self.assertEqual(len(llm.calls), 1)
        call = llm.calls[0]
        self.assertEqual(call["json_schema"], REVIEW_SCHEMA)
        self.assertIn("Shared rules.", call["instructions"])
        self.assertIn("Hold the vibe.", call["instructions"])
        self.assertEqual(call["input"][0]["type"], "text")

    def test_note_verdict_carries_severity_and_text(self):
        llm = FakeLlm(results=[note_result("concern", "Dropped the invariant check.")])
        outcomes = Reviewer(llm).review_turn(self.roster, ["vibe"], "u", "a")
        self.assertEqual(
            outcomes,
            [AdvisorOutcome(advisor="vibe", state="note", severity="concern", note="Dropped the invariant check.")],
        )

    def test_invalid_severity_defaults_to_nit(self):
        llm = FakeLlm(results=[FakeLlmResult(parsed={"verdict": "note", "severity": "fatal", "note": "N"})])
        outcomes = Reviewer(llm).review_turn(self.roster, ["vibe"], "u", "a")
        self.assertEqual(outcomes[0].severity, "nit")

    def test_note_with_empty_text_counts_as_pass(self):
        llm = FakeLlm(results=[FakeLlmResult(parsed={"verdict": "note", "severity": "blocker", "note": "  "})])
        outcomes = Reviewer(llm).review_turn(self.roster, ["vibe"], "u", "a")
        self.assertEqual(outcomes[0].state, "pass")

    def test_unparseable_review_is_an_error_not_a_crash(self):
        llm = FakeLlm(results=[FakeLlmResult(parsed=None, text="not json")])
        outcomes = Reviewer(llm).review_turn(self.roster, ["vibe"], "u", "a")
        self.assertEqual(outcomes[0].state, "error")
        self.assertIn("parseable", outcomes[0].error or "")

    def test_llm_exception_is_an_error_not_a_crash(self):
        llm = FakeLlm(error=RuntimeError("provider 500"))
        outcomes = Reviewer(llm).review_turn(self.roster, ["vibe"], "u", "a")
        self.assertEqual(outcomes[0].state, "error")
        self.assertIn("provider 500", outcomes[0].error or "")

    def test_unexpected_verdict_is_an_error(self):
        llm = FakeLlm(results=[FakeLlmResult(parsed={"verdict": "maybe"})])
        outcomes = Reviewer(llm).review_turn(self.roster, ["vibe"], "u", "a")
        self.assertEqual(outcomes[0].state, "error")

    def test_explicit_provider_and_model_passed_when_granted(self):
        model_advisor = Advisor(name="senior", model="vendor/model-x", instructions="Be senior.")
        llm = FakeLlm(results=[pass_result()])
        Reviewer(
            llm,
            model_override_granted=True,
            provider_override_granted=True,
        ).review_turn(roster_with(model_advisor), ["senior"], "u", "a")
        self.assertEqual(llm.calls[0]["provider"], "vendor")
        self.assertEqual(llm.calls[0]["model"], "model-x")

    def test_explicit_model_without_grant_is_no_model_and_skips_call(self):
        model_advisor = Advisor(name="senior", model="vendor/model-x", instructions="Be senior.")
        llm = FakeLlm(results=[pass_result()])
        outcomes = Reviewer(llm, model_override_granted=False).review_turn(roster_with(model_advisor), ["senior"], "u", "a")
        self.assertEqual(outcomes[0].state, "no_model")
        self.assertEqual(outcomes[0].model, "vendor/model-x")
        self.assertEqual(llm.calls, [])

    def test_provider_model_selector_requires_both_grants(self):
        model_advisor = Advisor(name="senior", model="vendor/model-x", instructions="Be senior.")
        llm = FakeLlm(results=[pass_result()])
        outcomes = Reviewer(
            llm,
            model_override_granted=True,
            provider_override_granted=False,
        ).review_turn(roster_with(model_advisor), ["senior"], "u", "a")
        self.assertEqual(outcomes[0].state, "no_model")
        self.assertIn("llm.provider_override", outcomes[0].error or "")
        self.assertEqual(llm.calls, [])

    def test_model_only_selector_needs_no_provider_grant(self):
        model_advisor = Advisor(name="senior", model="model-x", instructions="Be senior.")
        llm = FakeLlm(results=[pass_result()])
        Reviewer(
            llm,
            model_override_granted=True,
            provider_override_granted=False,
        ).review_turn(roster_with(model_advisor), ["senior"], "u", "a")
        self.assertEqual(llm.calls[0]["model"], "model-x")
        self.assertNotIn("provider", llm.calls[0])

    def test_model_omission_uses_host_routing(self):
        llm = FakeLlm(results=[pass_result()])
        Reviewer(llm, model_override_granted=False).review_turn(self.roster, ["vibe"], "u", "a")
        self.assertNotIn("model", llm.calls[0])

    def test_missing_llm_seam_is_an_error(self):
        outcomes = Reviewer(None).review_turn(self.roster, ["vibe"], "u", "a")
        self.assertEqual(outcomes[0].state, "error")

    def test_unknown_selected_advisor_is_an_error(self):
        llm = FakeLlm(results=[pass_result()])
        outcomes = Reviewer(llm).review_turn(self.roster, ["ghost"], "u", "a")
        self.assertEqual(outcomes[0].state, "error")
        self.assertEqual(llm.calls, [])

    def test_one_review_per_selected_advisor(self):
        second = Advisor(name="code-quality", instructions="Check invariants.")
        llm = FakeLlm(results=[pass_result(), note_result("nit", "Style.")])
        outcomes = Reviewer(llm).review_turn(roster_with(self.advisor, second), ["vibe", "code-quality"], "u", "a")
        self.assertEqual([outcome.state for outcome in outcomes], ["pass", "note"])
        self.assertEqual(len(llm.calls), 2)

    def test_normalize_note_collapses_whitespace(self):
        self.assertEqual(normalize_note("  a\n\n  b\t c  "), "a b c")
        self.assertEqual(normalize_note(""), "")

    def test_followup_text_is_marked(self):
        message = followup_text("vibe", "Fix the vibe break.")
        self.assertTrue(message.startswith(FOLLOWUP_MARK))
        self.assertIn("vibe", message)
        self.assertIn("Fix the vibe break.", message)


class TranscriptTests(unittest.TestCase):
    def test_transcript_includes_turn_and_bounded_history(self):
        history = [{"role": "user", "content": f"m{i}"} for i in range(15)]
        transcript = build_transcript("hello", "world", history)
        self.assertIn("user: hello", transcript)
        self.assertIn("assistant: world", transcript)
        self.assertNotIn("m0", transcript)
        self.assertIn("m14", transcript)

    def test_transcript_handles_block_content(self):
        history = [{"role": "assistant", "content": [{"type": "text", "text": "block text"}]}]
        transcript = build_transcript("q", "a", history)
        self.assertIn("block text", transcript)

    def test_transcript_clips_oversized_turn(self):
        transcript = build_transcript("x" * 20_000, "y")
        self.assertIn("[truncated]", transcript)
        self.assertLess(len(transcript), 12_000)

    def test_review_instruction_joins_shared_and_advisor_text(self):
        advisor = Advisor(name="vibe", instructions="Personal text.")
        instruction = build_review_instruction(advisor, "Shared text.")
        self.assertIn("Shared text.", instruction)
        self.assertIn("Personal text.", instruction)
        self.assertIn("'vibe' advisor", instruction)
        self.assertIn("concern", instruction)


if __name__ == "__main__":
    unittest.main()
