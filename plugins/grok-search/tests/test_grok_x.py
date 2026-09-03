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

    def test_anchor_only_authored_fetch_reports_unverified_completeness(self) -> None:
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
        self.assertEqual(warnings, [
            "The full authored unit was requested but no additional cited author-composed content was recovered, so completeness could not be verified."
        ])
        self.assertTrue(degraded)

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

    def test_filters_uncited_and_misclassified_expansions(self) -> None:
        def item(url: str, relation: str, author: str = "@a") -> dict:
            return {"url": url, "relation": relation, "authorHandle": author}

        anchor = item("https://x.com/a/status/1", "anchor")
        authored = item("https://x.com/a/status/2", "authored")
        parent = item("https://x.com/b/status/3", "parent", "@b")
        reply = item("https://x.com/c/status/4", "reply", "@c")
        document = {
            "available": True,
            "anchor": anchor,
            "authoredContextAvailable": True,
            "authoredContext": [
                authored,
                item("https://x.com/d/status/5", "authored", "@d"),
                item("https://x.com/e/status/6", "reply"),
                item("https://x.com/a/status/7", "authored"),
                item("https://x.com/a/status/10", "authored", " "),
                item("https://x.com/a/status/1", "authored"),
                item("https://x.com/a/status/13", "authored", "@@a"),
            ],
            "relatedContext": [
                parent,
                item("https://x.com/a/status/8", "authored"),
                item("https://x.com/a/status/1", "parent", "@b"),
            ],
            "discussion": {
                "included": True,
                "sampleNotice": "Bounded sample",
                "viewpoints": [
                    {
                        "theme": "Mixed",
                        "summary": "Some agree and some disagree",
                        "examples": [
                            reply,
                            item("https://x.com/b/status/9", "parent", "@b"),
                            item("https://x.com/a/status/11", "reply"),
                            item("https://x.com/d/status/12", "reply", " "),
                            item("https://x.com/a/status/1", "reply", "@b"),
                        ],
                    },
                    {
                        "theme": "Unsupported",
                        "summary": "No examples",
                        "examples": [],
                    },
                ],
            },
        }
        citations = [
            {"url": value, "title": ""}
            for value in [
                "https://x.com/i/status/1",
                "https://x.com/i/status/2",
                "https://x.com/i/status/3",
                "https://x.com/i/status/4",
                "https://x.com/i/status/5",
                "https://x.com/i/status/6",
                "https://x.com/i/status/9",
                "https://x.com/i/status/13",
                "https://x.com/i/status/10",
                "https://x.com/i/status/11",
                "https://x.com/i/status/12",
            ]
        ]

        result, warnings, degraded = grok_x.enforce_live_fetch(
            document,
            citations,
            "https://x.com/a/status/1",
            "authored",
            True,
        )

        self.assertEqual(result["authoredContext"], [authored])
        self.assertEqual(result["relatedContext"], [parent])
        self.assertEqual(result["discussion"]["viewpoints"], [{
            "theme": "Mixed",
            "summary": "Some agree and some disagree",
            "examples": [reply],
        }])
        self.assertTrue(degraded)
        self.assertTrue(any("authored context" in warning for warning in warnings))
        self.assertTrue(any("related context" in warning for warning in warnings))
        self.assertTrue(any("discussion" in warning for warning in warnings))

    def test_malformed_context_collections_degrade(self) -> None:
        document = {
            "available": True,
            "anchor": {
                "url": "https://x.com/a/status/1",
                "relation": "anchor",
                "authorHandle": "@a",
            },
            "authoredContextAvailable": False,
            "authoredContext": {},
            "relatedContext": None,
            "discussion": {"included": False, "sampleNotice": "", "viewpoints": []},
        }
        result, warnings, degraded = grok_x.enforce_live_fetch(
            document,
            [{"url": "https://x.com/i/status/1", "title": ""}],
            "https://x.com/a/status/1",
            "anchor",
        )

        self.assertEqual(result["authoredContext"], [])
        self.assertEqual(result["relatedContext"], [])
        self.assertTrue(degraded)
        self.assertTrue(any("authored context" in warning for warning in warnings))
        self.assertTrue(any("related context" in warning for warning in warnings))

    def test_requested_discussion_requires_notice_and_cited_examples(self) -> None:
        document = {
            "available": True,
            "anchor": {
                "url": "https://x.com/a/status/1",
                "relation": "anchor",
                "authorHandle": "@a",
            },
            "authoredContextAvailable": False,
            "authoredContext": [],
            "relatedContext": [],
            "discussion": {
                "included": True,
                "sampleNotice": " ",
                "viewpoints": [{
                    "theme": "Consensus",
                    "summary": "Everyone agrees",
                    "examples": [],
                }],
            },
        }

        result, warnings, degraded = grok_x.enforce_live_fetch(
            document,
            [{"url": "https://x.com/i/status/1", "title": ""}],
            "https://x.com/a/status/1",
            "anchor",
            True,
        )

        self.assertEqual(result["discussion"], {
            "included": False,
            "sampleNotice": "",
            "viewpoints": [],
        })
        self.assertTrue(degraded)
        self.assertEqual(warnings, ["Representative discussion was requested but no cited, bounded sample was recovered."])


if __name__ == "__main__":
    unittest.main()
