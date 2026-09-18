import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  extractPathTokens,
  formatWhen,
  globToRegex,
  matchAdvisorWhen,
  normalizePosixPath,
  parseAdvisorWhen,
  type AdvisorWhen,
} from "../src/when.ts";

test("parseAdvisorWhen parses valid when objects with single strings and lists", () => {
  const result1 = parseAdvisorWhen({
    files: "vibe.md",
    paths: ["src/**/*.ts", "*.py"],
    message_matches: "^(fix|feat):",
  });
  assert.equal(result1.ok, true);
  if (result1.ok) {
    assert.deepEqual(result1.when, {
      files: ["vibe.md"],
      paths: ["src/**/*.ts", "*.py"],
      message_matches: "^(fix|feat):",
    });
  }

  const resultEmpty = parseAdvisorWhen({});
  assert.equal(resultEmpty.ok, true);
  if (resultEmpty.ok) {
    assert.deepEqual(resultEmpty.when, {});
  }

  const resultUndefined = parseAdvisorWhen(undefined);
  assert.equal(resultUndefined.ok, true);
  if (resultUndefined.ok) {
    assert.equal(resultUndefined.when, undefined);
  }
});

test("parseAdvisorWhen fails closed on invalid types or unknown keys", () => {
  assert.equal(parseAdvisorWhen("not an object").ok, false);
  assert.equal(parseAdvisorWhen([1, 2, 3]).ok, false);
  assert.equal(parseAdvisorWhen({ unknown_key: true }).ok, false);
  assert.equal(parseAdvisorWhen({ files: 123 }).ok, false);
  assert.equal(parseAdvisorWhen({ files: [123] }).ok, false);
  assert.equal(parseAdvisorWhen({ paths: { a: 1 } }).ok, false);
  assert.equal(parseAdvisorWhen({ message_matches: 456 }).ok, false);
});

test("globToRegex correctly matches * and ** patterns", () => {
  const r1 = globToRegex("src/**/*.ts");
  assert.ok(r1.test("src/when.ts"));
  assert.ok(r1.test("src/sub/dir/when.ts"));
  assert.ok(!r1.test("test/when.ts"));
  assert.ok(!r1.test("src/when.js"));

  const r2 = globToRegex("*.py");
  assert.ok(r2.test("app.py"));
  assert.ok(!r2.test("src/app.py"));

  const r3 = globToRegex("**/*.py");
  assert.ok(r3.test("app.py"));
  assert.ok(r3.test("src/app.py"));
  assert.ok(r3.test("a/b/c/d.py"));

  const r4 = globToRegex("docs/**");
  assert.ok(r4.test("docs/vibe.md"));
  assert.ok(r4.test("docs/a/b/c.md"));
});

test("normalizePosixPath handles slashes and leading ./", () => {
  assert.equal(normalizePosixPath("./src\\when.ts"), "src/when.ts");
  assert.equal(normalizePosixPath("src//when.ts/"), "src/when.ts");
  assert.equal(normalizePosixPath("vibe.md"), "vibe.md");
});

test("extractPathTokens extracts path-like tokens and filters numbers and URLs", () => {
  const text = [
    "I modified src/when.ts and tests/when.test.ts.",
    "Also check vibe.md and .gitignore!",
    "Do not match https://example.com/foo or version 1.2.3 or plain words.",
  ].join(" ");
  const tokens = extractPathTokens(text);
  assert.ok(tokens.includes("src/when.ts"));
  assert.ok(tokens.includes("tests/when.test.ts"));
  assert.ok(tokens.includes("vibe.md"));
  assert.ok(tokens.includes(".gitignore"));
  assert.ok(!tokens.includes("1.2.3"));
  assert.ok(!tokens.some((t) => t.startsWith("https://")));
  assert.ok(!tokens.includes("modified"));
  assert.ok(!tokens.includes("plain"));
});

test("matchAdvisorWhen: empty or missing when always matches", () => {
  assert.equal(matchAdvisorWhen(undefined, { cwd: "/tmp" }).matches, true);
  assert.equal(matchAdvisorWhen({}, { cwd: "/tmp" }).matches, true);
});

test("matchAdvisorWhen: files condition checks cwd, ancestors, and loadedWatchdogDirs", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "when-files-"));
  try {
    const gitDir = path.join(tmpRoot, ".git");
    await fs.mkdir(gitDir);
    const subDir = path.join(tmpRoot, "packages", "sub");
    await fs.mkdir(subDir, { recursive: true });
    const watchdogDir = path.join(tmpRoot, "custom-watchdog");
    await fs.mkdir(watchdogDir, { recursive: true });

    await fs.writeFile(path.join(tmpRoot, "vibe.md"), "root vibe");
    await fs.writeFile(path.join(watchdogDir, "shared.txt"), "shared text");

    const when1: AdvisorWhen = { files: ["vibe.md"] };
    const res1 = matchAdvisorWhen(when1, { cwd: subDir });
    assert.equal(res1.matches, true);

    const whenWatchdog: AdvisorWhen = { files: ["shared.txt"] };
    const resW = matchAdvisorWhen(whenWatchdog, { cwd: subDir, loadedWatchdogDirs: [watchdogDir] });
    assert.equal(resW.matches, true);

    const whenMissing: AdvisorWhen = { files: ["nonexistent.md"] };
    const resMissing = matchAdvisorWhen(whenMissing, { cwd: subDir });
    assert.equal(resMissing.matches, false);
    if (!resMissing.matches) {
      assert.ok(resMissing.reason.includes("none of [nonexistent.md] exist"));
    }
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("matchAdvisorWhen: paths condition matches current turn paths", () => {
  const when: AdvisorWhen = { paths: ["src/**/*.ts", "*.md"] };

  const match1 = matchAdvisorWhen(when, {
    cwd: "/tmp",
    currentTurnPaths: ["src/when.ts", "package.json"],
  });
  const match2 = matchAdvisorWhen(when, {
    cwd: "/tmp",
    currentTurnPaths: ["vibe.md"],
  });
  assert.equal(match2.matches, true);

  const whenGlob = { paths: ["**/*.md"] };
  const match3 = matchAdvisorWhen(whenGlob, {
    cwd: "/tmp",
    currentTurnPaths: ["docs/vibe.md"],
  });
  assert.equal(match3.matches, true);

  const matchFail = matchAdvisorWhen(when, {
    currentTurnPaths: ["other/file.py"],
  });
  assert.equal(matchFail.matches, false);
  if (!matchFail.matches) {
    assert.ok(matchFail.reason.includes("no paths matched"));
  }
});

test("matchAdvisorWhen: message_matches regex and invalid regex handling", () => {
  const when: AdvisorWhen = { message_matches: "^repro" };

  const matchOk = matchAdvisorWhen(when, {
    cwd: "/tmp",
    lastUserMessage: "repro the issue please",
  });
  assert.equal(matchOk.matches, true);

  const matchFail = matchAdvisorWhen(when, {
    cwd: "/tmp",
    lastUserMessage: "hello world",
  });
  assert.equal(matchFail.matches, false);
  if (!matchFail.matches) {
    assert.ok(matchFail.reason.includes("user message did not match"));
  }

  const whenInvalid: AdvisorWhen = { message_matches: "[unclosed" };
  const matchInvalid = matchAdvisorWhen(whenInvalid, {
    cwd: "/tmp",
    lastUserMessage: "anything",
  });
  assert.equal(matchInvalid.matches, false);
  if (!matchInvalid.matches) {
    assert.ok(matchInvalid.reason.includes("invalid regex"));
  }
});

test("matchAdvisorWhen: AND semantics across present keys", () => {
  const when: AdvisorWhen = {
    paths: ["src/**/*.ts"],
    message_matches: "^fix",
  };

  const bothMatch = matchAdvisorWhen(when, {
    cwd: "/tmp",
    currentTurnPaths: ["src/when.ts"],
    lastUserMessage: "fix the issue",
  });
  assert.equal(bothMatch.matches, true);

  const pathFails = matchAdvisorWhen(when, {
    cwd: "/tmp",
    currentTurnPaths: ["docs/readme.md"],
    lastUserMessage: "fix the issue",
  });
  assert.equal(pathFails.matches, false);

  const messageFails = matchAdvisorWhen(when, {
    cwd: "/tmp",
    currentTurnPaths: ["src/when.ts"],
    lastUserMessage: "hello world",
  });
  assert.equal(messageFails.matches, false);
});

test("formatWhen produces readable description", () => {
  assert.equal(formatWhen(undefined), "always");
  assert.equal(formatWhen({}), "always");
  assert.equal(formatWhen({ files: ["vibe.md", "docs/vibe.md"] }), "files: vibe.md, docs/vibe.md");
  assert.equal(
    formatWhen({ paths: ["src/**"], message_matches: "^fix" }),
    "paths: src/**; message_matches: /^fix/",
  );
});
