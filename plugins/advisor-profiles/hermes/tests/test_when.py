from __future__ import annotations

import importlib.util
import os
import shutil
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

AdvisorWhen = _PKG.when.AdvisorWhen
extract_path_tokens = _PKG.when.extract_path_tokens
format_when = _PKG.when.format_when
glob_to_regex = _PKG.when.glob_to_regex
match_advisor_when = _PKG.when.match_advisor_when
normalize_posix_path = _PKG.when.normalize_posix_path
parse_advisor_when = _PKG.when.parse_advisor_when

class WhenTests(unittest.TestCase):
    def test_parse_advisor_when_valid(self):
        when, err = parse_advisor_when({
            "files": ["vibe.md", "docs/vibe.md"],
            "paths": "src/**/*.ts",
            "message_matches": "^(fix|feat):",
        })
        self.assertIsNone(err)
        self.assertIsNotNone(when)
        self.assertEqual(when.files, ("vibe.md", "docs/vibe.md"))
        self.assertEqual(when.paths, ("src/**/*.ts",))
        self.assertEqual(when.message_matches, "^(fix|feat):")

    def test_parse_advisor_when_empty_and_none(self):
        when_none, err = parse_advisor_when(None)
        self.assertIsNone(err)
        self.assertIsNone(when_none)

        when_empty, err = parse_advisor_when({})
        self.assertIsNone(err)
        self.assertIsNotNone(when_empty)
        self.assertIsNone(when_empty.files)
        self.assertIsNone(when_empty.paths)
        self.assertIsNone(when_empty.message_matches)

    def test_parse_advisor_when_invalid(self):
        _, err = parse_advisor_when("not a map")
        self.assertIn("must be a mapping", err)

        _, err = parse_advisor_when({"unknown": 123})
        self.assertIn("unknown key", err)

        _, err = parse_advisor_when({"files": 123})
        self.assertIn("when.files must be", err)

        _, err = parse_advisor_when({"files": [123]})
        self.assertIn("when.files must be strings", err)

        _, err = parse_advisor_when({"paths": 456})
        self.assertIn("when.paths must be", err)

        _, err = parse_advisor_when({"message_matches": 789})
        self.assertIn("when.message_matches must be a string", err)

    def test_glob_to_regex(self):
        r1 = glob_to_regex("src/**/*.ts")
        self.assertTrue(r1.match("src/when.ts"))
        self.assertTrue(r1.match("src/a/b/when.ts"))
        self.assertFalse(r1.match("test/when.ts"))
        self.assertFalse(r1.match("src/when.py"))

        r2 = glob_to_regex("*.py")
        self.assertTrue(r2.match("test.py"))
        self.assertFalse(r2.match("dir/test.py"))

        r3 = glob_to_regex("**/*.py")
        self.assertTrue(r3.match("test.py"))
        self.assertTrue(r3.match("dir/test.py"))

        r4 = glob_to_regex("docs/**")
        self.assertTrue(r4.match("docs/vibe.md"))
        self.assertTrue(r4.match("docs/a/b.md"))

    def test_normalize_posix_path(self):
        self.assertEqual(normalize_posix_path(r".\src\when.ts"), "src/when.ts")
        self.assertEqual(normalize_posix_path("src//when.ts/"), "src/when.ts")
        self.assertEqual(normalize_posix_path("vibe.md"), "vibe.md")

    def test_extract_path_tokens(self):
        text = "Modified src/when.ts and tests/test_when.py: done. Also check vibe.md, .gitignore and 1.2.3 or https://example.com"
        tokens = extract_path_tokens(text)
        self.assertIn("src/when.ts", tokens)
        self.assertIn("tests/test_when.py", tokens)
        self.assertIn("vibe.md", tokens)
        self.assertIn(".gitignore", tokens)
        self.assertNotIn("1.2.3", tokens)
        self.assertNotIn("https://example.com", tokens)

    def test_match_advisor_when_empty_or_none(self):
        matched, reason = match_advisor_when(None, cwd=Path("/tmp"))
        self.assertTrue(matched)
        self.assertIsNone(reason)

        matched, reason = match_advisor_when(AdvisorWhen(), cwd=Path("/tmp"))
        self.assertTrue(matched)
        self.assertIsNone(reason)

    def test_match_advisor_when_files(self):
        tmp_dir = Path(tempfile.mkdtemp(prefix="when-test-"))
        try:
            git_dir = tmp_dir / ".git"
            git_dir.mkdir()
            sub_dir = tmp_dir / "sub" / "project"
            sub_dir.mkdir(parents=True)
            watchdog_dir = tmp_dir / "custom"
            watchdog_dir.mkdir()

            vibe_file = tmp_dir / "vibe.md"
            vibe_file.write_text("vibe", encoding="utf-8")
            watchdog_file = watchdog_dir / "rules.md"
            watchdog_file.write_text("rules", encoding="utf-8")

            # matches file in ancestor
            when_vibe = AdvisorWhen(files=("vibe.md",))
            matched, _ = match_advisor_when(when_vibe, cwd=sub_dir)
            self.assertTrue(matched)

            # matches file in loaded_watchdog_dirs
            when_wd = AdvisorWhen(files=("rules.md",))
            matched, _ = match_advisor_when(when_wd, cwd=sub_dir, loaded_watchdog_dirs=[watchdog_dir])
            self.assertTrue(matched)

            # fails for missing file
            when_missing = AdvisorWhen(files=("nonexistent.md",))
            matched, reason = match_advisor_when(when_missing, cwd=sub_dir)
            self.assertFalse(matched)
            self.assertIn("none of [nonexistent.md] exist", reason)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    def test_match_advisor_when_paths(self):
        when = AdvisorWhen(paths=("src/**/*.ts", "*.md"))

        matched, _ = match_advisor_when(when, cwd=Path("/tmp"), current_turn_paths=["src/when.ts"])
        self.assertTrue(matched)

        matched, _ = match_advisor_when(when, cwd=Path("/tmp"), current_turn_text="I edited vibe.md today")
        self.assertTrue(matched)

        matched, reason = match_advisor_when(when, cwd=Path("/tmp"), current_turn_paths=["other/script.py"])
        self.assertFalse(matched)
        self.assertIn("no paths matched", reason)

    def test_match_advisor_when_message_matches(self):
        when = AdvisorWhen(message_matches=r"^fix\b")

        matched, _ = match_advisor_when(when, cwd=Path("/tmp"), last_user_message="fix the bug")
        self.assertTrue(matched)

        matched, reason = match_advisor_when(when, cwd=Path("/tmp"), last_user_message="feature request")
        self.assertFalse(matched)
        self.assertIn("user message did not match", reason)

        when_invalid = AdvisorWhen(message_matches="[unclosed")
        matched, reason = match_advisor_when(when_invalid, cwd=Path("/tmp"), last_user_message="fix")
        self.assertFalse(matched)
        self.assertIn("invalid regex", reason)

    def test_match_advisor_when_and_semantics(self):
        when = AdvisorWhen(paths=("src/**",), message_matches=r"^fix")

        matched, _ = match_advisor_when(
            when,
            cwd=Path("/tmp"),
            current_turn_paths=["src/app.ts"],
            last_user_message="fix the bug",
        )
        self.assertTrue(matched)

        # path fails
        matched, _ = match_advisor_when(
            when,
            cwd=Path("/tmp"),
            current_turn_paths=["docs/readme.md"],
            last_user_message="fix the bug",
        )
        self.assertFalse(matched)

        # message fails
        matched, _ = match_advisor_when(
            when,
            cwd=Path("/tmp"),
            current_turn_paths=["src/app.ts"],
            last_user_message="hello",
        )
        self.assertFalse(matched)

    def test_format_when(self):
        self.assertEqual(format_when(None), "always")
        self.assertEqual(format_when(AdvisorWhen()), "always")
        self.assertEqual(
            format_when(AdvisorWhen(files=("vibe.md",))),
            "files: vibe.md",
        )
        self.assertEqual(
            format_when(AdvisorWhen(paths=("src/**",), message_matches=r"^fix")),
            "paths: src/**; message_matches: /^fix/",
        )


if __name__ == "__main__":
    unittest.main()
