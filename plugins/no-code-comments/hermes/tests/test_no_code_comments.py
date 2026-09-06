from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERMES_DIR = Path(__file__).resolve().parents[1]

spec = importlib.util.spec_from_file_location(
    "no_code_comments_pkg", HERMES_DIR / "__init__.py", submodule_search_locations=[str(HERMES_DIR)]
)
package = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = package
spec.loader.exec_module(package)


class FakeRegistry:
    def __init__(self):
        self.sections: list[tuple] = []
        self.commands: dict = {}
        self.middlewares: dict = {}

    def register_system_prompt_section(self, name, content, **kwargs):
        self.sections.append((name, content))

    def register_middleware(self, hook, handler):
        self.middlewares.setdefault(hook, []).append(handler)

    def register_command(self, name, **kwargs):
        self.commands[name] = kwargs

    def dispatch_tool_request(self, tool_name, args):
        for handler in self.middlewares.get("tool_request", []):
            result = handler(tool_name, args)
            if result is not None and "args" in result:
                args = result["args"]
        return args


class AdvisoryPolicyTests(unittest.TestCase):
    def test_registry_dispatch_preserves_commented_payloads(self):
        registry = FakeRegistry()
        package.register(registry)
        self.assertIn("no-code-comments.policy", [name for name, _ in registry.sections])
        self.assertIn("no-code-comments", registry.commands)
        commented = {"path": "a.ts", "content": "const a = 1; // prose\nconst b = 2; /* kept */\n"}
        self.assertEqual(registry.dispatch_tool_request("write_file", commented), commented)
        self.assertEqual(registry.dispatch_tool_request("patch", {"patch": "+const a = 1; // prose\n"}), {"patch": "+const a = 1; // prose\n"})

    def test_command_reports_policy(self):
        registry = FakeRegistry()
        package.register(registry)
        handler = registry.commands["no-code-comments"]["handler"]
        self.assertEqual(handler(""), package.NO_CODE_COMMENTS_PROMPT)
        self.assertEqual(handler("extra"), "Usage: /no-code-comments")


if __name__ == "__main__":
    unittest.main()
