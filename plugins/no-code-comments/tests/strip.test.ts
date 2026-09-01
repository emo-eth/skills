import assert from "node:assert/strict";
import test from "node:test";
import { rewriteToolCall } from "../src/host.ts";
import { stripCodeComments } from "../src/strip.ts";

test("strips C-family comments without touching strings, regexes, or directives", () => {
  const input = [
    '"use strict";',
    'const url = "https://example.com/a//b"; // prose',
    'const pattern = /https?:\\/\\/[^/]+/; /* prose */',
    '/// <reference types="node" />',
    '// @ts-expect-error required compatibility gate',
    'const value = 1; // remove',
    '',
  ].join("\n");
  const result = stripCodeComments(input, "src/example.ts");
  assert.equal(result.removed, 3);
  assert.match(result.content, /"use strict"/u);
  assert.match(result.content, /https:\/\/example\.com/u);
  assert.match(result.content, /\/https\?:\\\/\\\/\[\^\/\]\+\//u);
  assert.match(result.content, /<reference types="node"/u);
  assert.match(result.content, /@ts-expect-error/u);
  assert.doesNotMatch(result.content, /prose|remove/u);
});

test("strips hash comments and preserves executable and checker directives", () => {
  const input = [
    "#!/usr/bin/env python3",
    "# -*- coding: utf-8 -*-",
    "value = '# literal'  # prose",
    "other = 1  # type: ignore[assignment]",
    "third = 2  # noqa: F401",
    "# standalone prose",
    "",
  ].join("\n");
  const result = stripCodeComments(input, "tool.py");
  assert.equal(result.removed, 2);
  assert.match(result.content, /^#!\/usr\/bin\/env python3/mu);
  assert.match(result.content, /coding: utf-8/u);
  assert.match(result.content, /'# literal'/u);
  assert.match(result.content, /type: ignore/u);
  assert.match(result.content, /noqa/u);
  assert.doesNotMatch(result.content, /standalone prose|# prose/u);
});

test("rewrites write and replace calls before execution", () => {
  const write = rewriteToolCall({
    toolName: "write",
    input: { path: "a.ts", content: "const a = 1; // remove\n" },
  });
  assert.equal(write.removed, 1);
  assert.equal(write.input?.content, "const a = 1;\n");

  const edit = rewriteToolCall({
    toolName: "edit",
    input: { path: "a.py", old_string: "x = 1", new_string: "x = 2  # remove" },
  });
  assert.equal(edit.removed, 1);
  assert.equal(edit.input?.new_string, "x = 2");
});

test("rewrites hashline and unified patch additions while preserving structure", () => {
  const hashline = [
    "*** Begin Patch",
    "[src/a.ts#ABCD]",
    "PUT 1:",
    "+const a = 1; // remove",
    "+const b = '/* literal */';",
    "*** End Patch",
  ].join("\n");
  const result = rewriteToolCall({ toolName: "edit", input: { input: hashline } });
  assert.equal(result.removed, 1);
  const rewritten = String(result.input?.input);
  assert.match(rewritten, /^\+const a = 1;$/mu);
  assert.match(rewritten, /^\+const b = '\/\* literal \*\/';$/mu);
  assert.equal(rewritten.split("\n").length, hashline.split("\n").length);
});

test("passes markdown, markdown derivatives, and unknown extensions through untouched", () => {
  const markdown = ["# Heading", "", "<!-- note -->", "- item with # hash", ""].join("\n");
  for (const path of ["README.md", "docs/guide.mdx", "report.qmd", "notes.rmd", "example.xyzlang"]) {
    const result = rewriteToolCall({ toolName: "write", input: { path, content: markdown } });
    assert.equal(result.block, undefined);
    assert.equal(result.removed, 0);
    assert.equal(result.input, undefined);
    assert.equal(stripCodeComments(markdown, path).content, markdown);
  }
});

test("keeps scheme-adjacent slashes in JSX text while stripping prose", () => {
  const input = "render(<a>https://example.com/path</a>); // prose\n";
  const result = stripCodeComments(input, "view.tsx");
  assert.equal(result.removed, 1);
  assert.match(result.content, /https:\/\/example\.com\/path/u);
  assert.doesNotMatch(result.content, /prose/u);
});

test("preserves tooling directives across families", () => {
  const shell = ["# shellcheck disable=SC2086", "# pragma: no cover", "x = 1  # nosec B101", "y = 2  # isort: off", ""].join("\n");
  assert.equal(stripCodeComments(shell, "run.sh").removed, 0);

  const ts = [
    "// biome-ignore lint/suspicious/noExplicitAny: needed",
    "//nolint:gosec",
    "// swiftlint:disable:next force_try",
    "//#region init",
    "//#endregion",
    "const a = 1; // gone",
    "",
  ].join("\n");
  const result = stripCodeComments(ts, "app.ts");
  assert.equal(result.removed, 1);
  assert.match(result.content, /biome-ignore/u);
  assert.match(result.content, /nolint:gosec/u);
  assert.match(result.content, /swiftlint:disable/u);
  assert.match(result.content, /#region init/u);
  assert.doesNotMatch(result.content, /gone/u);

  const html = "<!-- markdownlint-disable MD033 -->\n<div>x</div>\n";
  assert.equal(stripCodeComments(html, "page.html").removed, 0);
});
