from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERMES_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERMES_DIR))

from strip_comments import NO_CODE_COMMENTS_PROMPT, rewrite_tool_args, strip_code_comments


class StripCommentsTests(unittest.TestCase):
    def test_c_family_preserves_literals_regexes_and_directives(self):
        source = "\n".join((
            '"use strict";',
            'const url = "https://example.com/a//b"; // prose',
            r'const pattern = /https?:\/\/[^/]+/; /* prose */',
            '/// <reference types="node" />',
            '// @ts-expect-error required compatibility gate',
            'const value = 1; // remove',
            '',
        ))
        result = strip_code_comments(source, "src/example.ts")
        self.assertEqual(result.removed, 3)
        self.assertIn('"use strict"', result.content)
        self.assertIn("https://example.com", result.content)
        self.assertIn("<reference types=", result.content)
        self.assertIn("@ts-expect-error", result.content)
        self.assertNotRegex(result.content, r"prose|remove")

    def test_hash_family_preserves_executable_and_checker_directives(self):
        source = "\n".join((
            "#!/usr/bin/env python3",
            "# -*- coding: utf-8 -*-",
            "value = '# literal'  # prose",
            "other = 1  # type: ignore[assignment]",
            "third = 2  # noqa: F401",
            "# standalone prose",
            "",
        ))
        result = strip_code_comments(source, "tool.py")
        self.assertEqual(result.removed, 2)
        self.assertIn("#!/usr/bin/env python3", result.content)
        self.assertIn("coding: utf-8", result.content)
        self.assertIn("'# literal'", result.content)
        self.assertIn("type: ignore", result.content)
        self.assertIn("noqa", result.content)
        self.assertNotRegex(result.content, r"standalone prose|# prose")

    def test_rewrites_hermes_write_and_replace_tools(self):
        write = rewrite_tool_args("write_file", {"path": "a.ts", "content": "const a = 1; // remove\n"})
        self.assertEqual(write.removed, 1)
        assert write.args is not None
        self.assertEqual(write.args["content"], "const a = 1;\n")
        edit = rewrite_tool_args("patch", {
            "mode": "replace",
            "path": "a.py",
            "old_string": "x = 1",
            "new_string": "x = 2  # remove",
        })
        self.assertEqual(edit.removed, 1)
        assert edit.args is not None
        self.assertEqual(edit.args["new_string"], "x = 2")

    def test_rewrites_v4a_patch_additions_without_changing_structure(self):
        patch = "\n".join((
            "*** Begin Patch",
            "*** Update File: src/a.ts",
            "@@",
            "+const a = 1; // remove",
            "+const b = '/* literal */';",
            "*** End Patch",
        ))
        result = rewrite_tool_args("patch", {"mode": "patch", "patch": patch})
        self.assertEqual(result.removed, 1)
        assert result.args is not None
        rewritten = result.args["patch"]
        self.assertIn("+const a = 1;", rewritten)
        self.assertIn("+const b = '/* literal */';", rewritten)
        self.assertEqual(len(rewritten.splitlines()), len(patch.splitlines()))

    def test_passes_markdown_derivatives_and_unknown_extensions_through(self):
        markdown = "\n".join(("# Heading", "", "<!-- note -->", "- item with # hash", ""))
        for path in ("README.md", "docs/guide.mdx", "report.qmd", "notes.rmd", "example.xyzlang"):
            result = rewrite_tool_args("write_file", {"path": path, "content": markdown})
            self.assertFalse(result.block)
            self.assertIsNone(result.args)
            self.assertEqual(result.removed, 0)
            self.assertEqual(strip_code_comments(markdown, path).content, markdown)

    def test_keeps_scheme_adjacent_slashes_in_jsx_text(self):
        source = "render(<a>https://example.com/path</a>); // prose\n"
        result = strip_code_comments(source, "view.tsx")
        self.assertEqual(result.removed, 1)
        self.assertIn("https://example.com/path", result.content)
        self.assertNotIn("prose", result.content)

    def test_preserves_tooling_directives_across_families(self):
        shell = "\n".join((
            "# shellcheck disable=SC2086",
            "# pragma: no cover",
            "x = 1  # nosec B101",
            "y = 2  # isort: off",
            "",
        ))
        self.assertEqual(strip_code_comments(shell, "run.sh").removed, 0)

        app = "\n".join((
            "// biome-ignore lint/suspicious/noExplicitAny: needed",
            "//nolint:gosec",
            "// swiftlint:disable:next force_try",
            "//#region init",
            "//#endregion",
            "const a = 1; // gone",
            "",
        ))
        result = strip_code_comments(app, "app.ts")
        self.assertEqual(result.removed, 1)
        self.assertIn("biome-ignore", result.content)
        self.assertIn("nolint:gosec", result.content)
        self.assertIn("swiftlint:disable", result.content)
        self.assertIn("#region init", result.content)
        self.assertNotIn("gone", result.content)

        page = "<!-- markdownlint-disable MD033 -->\n<div>x</div>\n"
        self.assertEqual(strip_code_comments(page, "page.html").removed, 0)


class RegistrationTests(unittest.TestCase):
    def test_registers_prompt_middleware_hook_and_command(self):
        spec = importlib.util.spec_from_file_location(
            "no_code_comments_hermes",
            HERMES_DIR / "__init__.py",
            submodule_search_locations=[str(HERMES_DIR)],
        )
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)

        class Context:
            def __init__(self):
                self.calls = []

            def register_system_prompt_section(self, *args, **kwargs):
                self.calls.append(("prompt", args, kwargs))

            def register_middleware(self, *args, **kwargs):
                self.calls.append(("middleware", args, kwargs))

            def register_hook(self, *args, **kwargs):
                self.calls.append(("hook", args, kwargs))

            def register_command(self, *args, **kwargs):
                self.calls.append(("command", args, kwargs))

        ctx = Context()
        module.register(ctx)
        self.assertEqual([call[0] for call in ctx.calls], ["prompt", "middleware", "command"])
        middleware = ctx.calls[1][1][1]
        rewritten = middleware("write_file", {"path": "x.py", "content": "x = 1 # prose"})
        self.assertEqual(rewritten["args"]["content"], "x = 1")
        command = ctx.calls[2][2]["handler"]
        self.assertEqual(command(""), NO_CODE_COMMENTS_PROMPT)


if __name__ == "__main__":
    unittest.main()
