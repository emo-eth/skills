from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

HERMES_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERMES_DIR))

_SPEC = importlib.util.spec_from_file_location(
    "advisor_profiles_hermes",
    HERMES_DIR / "__init__.py",
    submodule_search_locations=[str(HERMES_DIR)],
)
assert _SPEC is not None and _SPEC.loader is not None
_PKG = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = _PKG
_SPEC.loader.exec_module(_PKG)

Advisor = _PKG.watchdog.Advisor
Roster = _PKG.watchdog.Roster
discover_config_files = _PKG.watchdog.discover_config_files
load_roster = _PKG.watchdog.load_roster
parse_watchdog = _PKG.watchdog.parse_watchdog
slugify = _PKG.watchdog.slugify

HOME_ROSTER = """
instructions: |
  Home shared guidance.
advisors:
  - name: home-only
    instructions: Home advisor.
  - name: shared
    enabled: false
    instructions: Home version of shared.
"""

PROJECT_ROSTER = """
instructions: |
  Project shared guidance.
advisors:
  - name: project-only
    model: project-model
    tools: [grep, read]
    instructions: Project advisor.
  - name: shared
    instructions: Project version of shared.
"""


class WatchdogTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.project = self.root / "project"
        self.project.mkdir()
        self.nested = self.project / "src" / "deep"
        self.nested.mkdir(parents=True)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _write(self, path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def test_discovery_orders_home_then_ancestors_then_leaf(self):
        (self.home / "WATCHDOG.yml").write_text(HOME_ROSTER, encoding="utf-8")
        (self.project / "WATCHDOG.yml").write_text(PROJECT_ROSTER, encoding="utf-8")
        files = discover_config_files(self.home, self.nested)
        self.assertEqual(files, [self.home / "WATCHDOG.yml", self.project / "WATCHDOG.yml"])

    def test_leaf_replaces_ancestor_replaces_home_by_slug(self):
        (self.home / "WATCHDOG.yml").write_text(HOME_ROSTER, encoding="utf-8")
        (self.project / "WATCHDOG.yml").write_text(PROJECT_ROSTER, encoding="utf-8")
        roster = load_roster(self.home, self.nested)
        self.assertEqual(set(roster.advisors), {"home-only", "project-only", "shared"})
        self.assertEqual(roster.advisors["shared"].instructions, "Project version of shared.")
        self.assertEqual(roster.advisors["home-only"].instructions, "Home advisor.")
        self.assertTrue(roster.advisors["shared"].enabled)
        self.assertTrue(roster.advisors["home-only"].enabled)
        self.assertEqual(roster.advisors["project-only"].model, "project-model")
        self.assertEqual(roster.advisors["project-only"].tools, ("grep", "read"))

    def test_shared_instructions_concatenate_in_discovery_order(self):
        (self.home / "WATCHDOG.yml").write_text(HOME_ROSTER, encoding="utf-8")
        (self.project / "WATCHDOG.yml").write_text(PROJECT_ROSTER, encoding="utf-8")
        roster = load_roster(self.home, self.nested)
        self.assertIn("Home shared guidance.", roster.instructions)
        self.assertIn("Project shared guidance.", roster.instructions)
        self.assertLess(roster.instructions.index("Home"), roster.instructions.index("Project"))

    def test_imports_resolve_relative_to_each_config_file(self):
        (self.home / "vibe.md").write_text("HOME VIBE CONTENT", encoding="utf-8")
        (self.project / "vibe.md").write_text("PROJECT VIBE CONTENT", encoding="utf-8")
        (self.home / "WATCHDOG.yml").write_text(
            "advisors:\n  - name: a\n    instructions: Hold to @vibe.md.\n", encoding="utf-8"
        )
        (self.project / "WATCHDOG.yml").write_text(
            "advisors:\n  - name: a\n    instructions: Hold to @vibe.md.\n", encoding="utf-8"
        )
        roster = load_roster(self.home, self.project)
        self.assertIn("PROJECT VIBE CONTENT", roster.advisors["a"].instructions)
        self.assertNotIn("HOME VIBE CONTENT", roster.advisors["a"].instructions)

    def test_top_level_instructions_expand_imports(self):
        self._write(self.project / "docs" / "guide.md", "GUIDE BODY")
        self._write(
            self.project / "WATCHDOG.yml",
            "instructions: Follow @docs/guide.md strictly.\nadvisors:\n  - name: a\n",
        )
        roster = load_roster(self.home, self.project)
        self.assertIn("GUIDE BODY", roster.instructions)

    def test_missing_import_keeps_token_and_warns(self):
        self._write(
            self.project / "WATCHDOG.yml",
            "advisors:\n  - name: a\n    instructions: See @missing/file.md for details.\n",
        )
        roster = load_roster(self.home, self.project)
        self.assertIn("@missing/file.md", roster.advisors["a"].instructions)
        self.assertTrue(any("cannot resolve import" in warning for warning in roster.warnings))

    def test_import_token_with_trailing_punctuation(self):
        (self.project / "vibe.md").write_text("VIBE", encoding="utf-8")
        self._write(
            self.project / "WATCHDOG.yml",
            "advisors:\n  - name: a\n    instructions: Read @vibe.md, then judge.\n",
        )
        roster = load_roster(self.home, self.project)
        self.assertIn("VIBE", roster.advisors["a"].instructions)
        self.assertNotIn("@vibe.md", roster.advisors["a"].instructions)

    def test_enabled_defaults_true(self):
        self._write(
            self.project / "WATCHDOG.yml",
            "advisors:\n  - name: alpha\n  - name: beta\n    enabled: false\n",
        )
        roster = load_roster(self.home, self.project)
        self.assertTrue(roster.advisors["alpha"].enabled)
        self.assertFalse(roster.advisors["beta"].enabled)
        self.assertEqual(roster.enabled_advisors(), ["alpha"])

    def test_malformed_yaml_skips_file_with_warning(self):
        (self.home / "WATCHDOG.yml").write_text("advisors: [unclosed", encoding="utf-8")
        self._write(self.project / "WATCHDOG.yml", "advisors:\n  - name: ok\n")
        roster = load_roster(self.home, self.project)
        self.assertEqual(set(roster.advisors), {"ok"})
        self.assertTrue(any("invalid YAML" in warning for warning in roster.warnings))

    def test_advisor_without_name_is_skipped_with_warning(self):
        self._write(
            self.project / "WATCHDOG.yml",
            "advisors:\n  - instructions: nameless\n  - name: named\n",
        )
        roster = load_roster(self.home, self.project)
        self.assertEqual(set(roster.advisors), {"named"})
        self.assertTrue(any("missing a 'name'" in warning for warning in roster.warnings))

    def test_missing_file_contributes_nothing(self):
        roster = load_roster(self.home, self.nested)
        self.assertEqual(roster.advisors, {})
        self.assertEqual(roster.files, ())

    def test_same_resolved_path_is_not_counted_twice(self):
        (self.project / "WATCHDOG.yml").write_text("advisors:\n  - name: a\n", encoding="utf-8")
        files = discover_config_files(self.home, self.project)
        self.assertEqual(files, [self.project / "WATCHDOG.yml"])
        roster = load_roster(self.home, self.project)
        self.assertEqual(len(roster.files), 1)

    def test_parse_watchdog_reports_non_mapping_top_level(self):
        path = self.project / "WATCHDOG.yml"
        path.write_text("- just\n- a list\n", encoding="utf-8")
        advisors, shared, warnings = parse_watchdog(path, Path.read_text)
        self.assertEqual(advisors, {})
        self.assertEqual(shared, "")
        self.assertTrue(any("mapping" in warning for warning in warnings))

    def test_duplicate_slug_within_one_file_last_wins(self):
        self._write(
            self.project / "WATCHDOG.yml",
            "advisors:\n  - name: a\n    instructions: first\n  - name: a\n    instructions: second\n",
        )
        roster = load_roster(self.home, self.project)
        self.assertEqual(roster.advisors["a"].instructions, "second")

    def test_roster_frozen_snapshot_fields(self):
        (self.project / "WATCHDOG.yml").write_text("advisors:\n  - name: a\n", encoding="utf-8")
        roster = load_roster(self.home, self.project)
        self.assertIsInstance(roster.advisors["a"], Advisor)
        self.assertIsInstance(roster, Roster)

    def test_slugify_lowercases_and_collapses_non_alphanumerics(self):
        self.assertEqual(slugify("Vibe Advisor"), "vibe-advisor")
        self.assertEqual(slugify("Code_Quality!"), "code-quality")
        self.assertEqual(slugify("  spaced  name "), "spaced-name")
        self.assertEqual(slugify("vibe--advisor"), "vibe-advisor")
        self.assertEqual(slugify("The_Vibe!"), "the-vibe")

    def test_slugify_empty_and_symbol_only_fall_back_to_advisor(self):
        self.assertEqual(slugify(""), "advisor")
        self.assertEqual(slugify("---"), "advisor")
        self.assertEqual(slugify("!!!"), "advisor")

    def test_merge_by_slug_replaces_despite_display_name_difference(self):
        (self.home / "WATCHDOG.yml").write_text(
            "advisors:\n  - name: The Vibe\n    instructions: home version\n", encoding="utf-8"
        )
        (self.project / "WATCHDOG.yml").write_text(
            "advisors:\n  - name: the_vibe\n    instructions: project version\n", encoding="utf-8"
        )
        roster = load_roster(self.home, self.project)
        self.assertEqual(set(roster.advisors), {"the-vibe"})
        advisor = roster.advisors["the-vibe"]
        self.assertEqual(advisor.name, "the_vibe")
        self.assertEqual(advisor.instructions, "project version")

    def test_distinct_slugs_coexist_despite_similar_names(self):
        (self.home / "WATCHDOG.yml").write_text("advisors:\n  - name: code quality\n", encoding="utf-8")
        (self.project / "WATCHDOG.yml").write_text("advisors:\n  - name: codequality\n", encoding="utf-8")
        roster = load_roster(self.home, self.project)
        self.assertEqual(set(roster.advisors), {"code-quality", "codequality"})

    def test_enabled_advisors_returns_slugs(self):
        self._write(
            self.project / "WATCHDOG.yml",
            "advisors:\n  - name: Alpha One\n  - name: Beta Two\n    enabled: false\n",
        )
        roster = load_roster(self.home, self.project)
        self.assertEqual(roster.enabled_advisors(), ["alpha-one"])


if __name__ == "__main__":
    unittest.main()
