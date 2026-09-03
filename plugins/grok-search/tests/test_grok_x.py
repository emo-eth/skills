from __future__ import annotations

import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import grok_x


class SearchPromptTests(unittest.TestCase):
    def test_source_mode_requires_live_recoverable_evidence(self) -> None:
        prompt = grok_x.build_search_prompt("What changed?", True, "quick")
        self.assertIn("only live X content", prompt)
        self.assertIn("exact post text", prompt)
        self.assertIn("canonical X URL", prompt)
        self.assertIn("avoid unnecessary search expansion", prompt)
        self.assertNotIn("Web pages", prompt)

    def test_deep_mode_requires_bounded_representative_synthesis(self) -> None:
        prompt = grok_x.build_search_prompt("What are people saying?", False, "deep")
        self.assertIn("representative viewpoints", prompt)
        self.assertIn("agreement, disagreement, corrections", prompt)
        self.assertIn("bounded rather than exhaustive", prompt)
        self.assertIn("Never claim what all of X thinks", prompt)
        self.assertIn("invent population percentages", prompt)


class FetchContractTests(unittest.TestCase):
    def test_anchor_prompt_preserves_full_source_and_signals_authored_context(self) -> None:
        prompt = grok_x.build_fetch_prompt("https://x.com/a/status/1", "anchor", False)
        self.assertIn("complete and verbatim", prompt)
        self.assertIn("full article title and body", prompt)
        self.assertIn("authoredContextAvailable", prompt)
        self.assertIn("Do not retrieve general replies", prompt)
        self.assertIn("without reconstructing", prompt)

    def test_authored_discussion_prompt_separates_authors_and_samples_viewpoints(self) -> None:
        prompt = grok_x.build_fetch_prompt("https://x.com/a/status/1", "authored", True)
        self.assertIn("complete author-composed unit in order", prompt)
        self.assertIn("representative discussion", prompt)
        self.assertIn("Every viewpoint needs concrete examples", prompt)
        self.assertIn("Never mix replies", prompt)

    def test_response_schema_preserves_provenance_and_article_kind(self) -> None:
        response_format = grok_x.fetch_response_format()
        schema = response_format["format"]["schema"]
        self.assertEqual(response_format["format"]["type"], "json_schema")
        self.assertTrue(response_format["format"]["strict"])
        self.assertEqual(schema["properties"]["contentKind"]["enum"], ["post", "article", "unknown"])
        self.assertIn("relation", schema["$defs"]["item"]["required"])
        self.assertIn("discussion", schema["required"])

    def test_missing_live_citation_fails_closed(self) -> None:
        document = {
            "available": True,
            "anchor": {"url": "https://x.com/a/status/1", "text": "unverified"},
            "authoredContext": [{"text": "unverified"}],
            "relatedContext": [],
            "discussion": {"included": False, "sampleNotice": "", "viewpoints": []},
        }
        result, warnings, degraded = grok_x.enforce_live_fetch(
            document,
            [],
            "https://x.com/a/status/1",
            "anchor",
        )
        self.assertFalse(result["available"])
        self.assertIsNone(result["anchor"])
        self.assertEqual(result["authoredContext"], [])
        self.assertTrue(degraded)
        self.assertEqual(warnings, ["The requested object could not be verified against live X evidence."])

    def test_verified_fetch_preserves_full_document(self) -> None:
        anchor = {"url": "https://x.com/a/status/1", "text": "verbatim"}
        document = {
            "available": True,
            "anchor": anchor,
            "authoredContext": [],
            "authoredContextAvailable": False,
            "relatedContext": [],
            "discussion": {"included": False, "sampleNotice": "", "viewpoints": []},
        }
        result, warnings, degraded = grok_x.enforce_live_fetch(
            document,
            [{"url": "https://x.com/a/status/1", "title": ""}],
            "https://x.com/a/status/1",
            "authored",
        )
        self.assertIs(result["anchor"], anchor)
        self.assertEqual(result["content"], "authored")
        self.assertEqual(warnings, [])
        self.assertFalse(degraded)

    def test_unrelated_citation_does_not_verify_requested_object(self) -> None:
        document = {
            "available": True,
            "anchor": {"url": "https://x.com/b/status/2", "text": "wrong object"},
            "authoredContextAvailable": False,
            "authoredContext": [],
            "relatedContext": [],
            "discussion": {"included": False, "sampleNotice": "", "viewpoints": []},
        }
        result, warnings, degraded = grok_x.enforce_live_fetch(
            document,
            [{"url": "https://x.com/b/status/2", "title": ""}],
            "https://x.com/a/status/1",
            "anchor",
        )
        self.assertFalse(result["available"])
        self.assertIsNone(result["anchor"])
        self.assertTrue(degraded)
        self.assertEqual(warnings, ["The requested object could not be verified against live X evidence."])

    def test_missing_requested_expansions_are_reported_as_degraded(self) -> None:
        document = {
            "available": True,
            "anchor": {"url": "https://x.com/a/status/1", "text": "verbatim"},
            "authoredContextAvailable": True,
            "authoredContext": [],
            "relatedContext": [],
            "discussion": {"included": False, "sampleNotice": "", "viewpoints": []},
        }
        result, warnings, degraded = grok_x.enforce_live_fetch(
            document,
            [{"url": "https://x.com/i/status/1", "title": ""}],
            "https://x.com/a/status/1",
            "authored",
            True,
        )
        self.assertTrue(result["available"])
        self.assertTrue(degraded)
        self.assertEqual(len(warnings), 2)


if __name__ == "__main__":
    unittest.main()
