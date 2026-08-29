import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  collectConfigCandidates,
  discoverAdvisorConfigs,
  expandAtImports,
  slugifyAdvisorName,
} from "../src/config.ts";

async function makeTree(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "advisor-config-"));
  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.join(root, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
  return root;
}

async function withTree(
  files: Record<string, string>,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await makeTree(files);
  try {
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("slugifyAdvisorName produces id-safe slugs", () => {
  assert.equal(slugifyAdvisorName("Vibe Check"), "vibe-check");
  assert.equal(slugifyAdvisorName("  Code Quality "), "code-quality");
  assert.equal(slugifyAdvisorName("!!!"), "advisor");
});

test("discovery merges user, project ancestor, and leaf configs; leaf wins per slug", async () => {
  await withTree(
    {
      ".git": "",
      "WATCHDOG.yml": [
        "instructions: |",
        "  root shared",
        "advisors:",
        "  - name: vibe",
        "    model: anthropic/claude-sonnet-4-5",
        "    instructions: |",
        "      root vibe",
      ].join("\n"),
      "sub/WATCHDOG.yml": [
        "instructions: |",
        "  leaf shared",
        "advisors:",
        "  - name: vibe",
        "    enabled: false",
        "    instructions: |",
        "      leaf vibe",
      ].join("\n"),
      "agent/WATCHDOG.yml": [
        "instructions: |",
        "  user shared",
        "advisors:",
        "  - name: vibe",
        "    instructions: |",
        "      user vibe",
        "  - name: user-only",
        "    instructions: |",
        "      user only",
      ].join("\n"),
    },
    async (root) => {
      const discovered = await discoverAdvisorConfigs(path.join(root, "sub"), path.join(root, "agent"));
      assert.equal(discovered.sharedInstructions, "user shared\n\nroot shared\n\nleaf shared");
      assert.deepEqual(
        discovered.advisors.map((advisor) => advisor.name),
        ["vibe", "user-only"],
      );
      const vibe = discovered.advisors[0];
      assert.equal(vibe.enabled, false);
      assert.equal(vibe.instructions, "leaf vibe");
      assert.equal(vibe.model, undefined);
      const userOnly = discovered.advisors[1];
      assert.equal(userOnly.instructions, "user only");
    },
  );
});

test("discovery stops at the git root and sorts user first then ancestors to leaf", async () => {
  await withTree(
    {
      ".git": "",
      "WATCHDOG.yml": "advisors:\n  - name: root-advisor\n",
      "sub/WATCHDOG.yml": "advisors:\n  - name: leaf-advisor\n",
      "agent/WATCHDOG.yml": "advisors:\n  - name: user-advisor\n",
    },
    async (root) => {
      const candidates = await collectConfigCandidates(path.join(root, "sub"), path.join(root, "agent"), [
        "WATCHDOG.yml",
      ]);
      const relative = candidates.map((candidate) => path.relative(root, candidate.path));
      assert.deepEqual(
        relative.sort(),
        ["WATCHDOG.yml", path.join("agent", "WATCHDOG.yml"), path.join("sub", "WATCHDOG.yml")].sort(),
      );
      assert.deepEqual(
        candidates.map((candidate) => candidate.level),
        ["user", "project", "project"],
      );
      assert.equal(path.relative(root, candidates[1].path), "WATCHDOG.yml");
      assert.equal(path.relative(root, candidates[2].path), path.join("sub", "WATCHDOG.yml"));
    },
  );
});

test("@path imports expand relative to each config file", async () => {
  await withTree(
    {
      ".git": "",
      "sub/WATCHDOG.yml": [
        "instructions: |",
        "  Follow @docs/vibe.md for taste.",
        "advisors:",
        "  - name: vibe",
        "    instructions: |",
        "      Specialize per @SPEC.md",
      ].join("\n"),
      "sub/docs/vibe.md": "vibe contract text",
      "sub/SPEC.md": "spec text",
    },
    async (root) => {
      const discovered = await discoverAdvisorConfigs(path.join(root, "sub"));
      assert.ok(discovered.sharedInstructions?.includes("vibe contract text"));
      assert.equal(discovered.advisors[0].instructions, "Specialize per spec text");
    },
  );
});

test("config inside .omp/ resolves imports relative to the .omp directory", async () => {
  await withTree(
    {
      ".git": "",
      ".omp/WATCHDOG.yml": "instructions: |\n  Base on @omp-note.md\n",
      ".omp/omp-note.md": "omp note contents",
    },
    async (root) => {
      const discovered = await discoverAdvisorConfigs(root);
      assert.ok(discovered.sharedInstructions?.includes("omp note contents"));
    },
  );
});

test("expandAtImports handles absolute paths, home paths, and missing files", async () => {
  await withTree(
    {
      "abs.md": "absolute contents",
      "notes.md": "notes contents",
    },
    async (root) => {
      const absolute = path.join(root, "abs.md");
      const expanded = await expandAtImports(`A @${absolute} B`, path.join(root, "file.md"));
      assert.ok(expanded.includes("absolute contents"));

      const homeExpanded = await expandAtImports("Read @~/notes.md", path.join(root, "file.md"), {
        home: root,
      });
      assert.ok(homeExpanded.includes("notes contents"));

      const missing = await expandAtImports("See @missing.md here", path.join(root, "file.md"));
      assert.equal(missing, "See @missing.md here");
    },
  );
});

test("imports do not expand inside code fences or inline code", async () => {
  await withTree(
    {
      "real.md": "real contents",
      "file.md": [
        "Before @real.md",
        "",
        "```",
        "@real.md",
        "```",
        "",
        "Inline `@real.md` stays literal.",
      ].join("\n"),
    },
    async (root) => {
      const expanded = await expandAtImports(
        await fs.readFile(path.join(root, "file.md"), "utf8"),
        path.join(root, "file.md"),
      );
      assert.ok(expanded.includes("Before real contents"));
      assert.ok(expanded.includes("```\n@real.md\n```"));
      assert.ok(expanded.includes("Inline `@real.md` stays literal."));
    },
  );
});

test("import cycles are broken and depth is capped", async () => {
  await withTree(
    {
      "a.md": "A start @b.md A end",
      "b.md": "B start @a.md B end",
      "c.md": "C start @d.md C end",
      "d.md": "D start @e.md D end",
      "e.md": "E start @f.md E end",
      "f.md": "F start @g.md F end",
      "g.md": "G contents",
    },
    async (root) => {
      const expandedA = await expandAtImports("root @a.md", path.join(root, "root.md"));
      assert.ok(expandedA.includes("A start"));
      assert.ok(expandedA.includes("B start"));
      assert.ok(expandedA.includes("B end"));
      assert.ok(expandedA.includes("A end"));
      assert.ok(expandedA.includes("@a.md"), "cycle reference left in place");

      const shallow = await expandAtImports("root @c.md", path.join(root, "root.md"), {
        maxDepth: 2,
      });
      assert.ok(shallow.includes("C start"));
      assert.ok(shallow.includes("D start"));
      assert.ok(shallow.includes("@e.md"), "hop beyond the depth cap left in place");
      assert.ok(!shallow.includes("E start"));
    },
  );
});

test("malformed or schema-invalid files are skipped without throwing", async () => {
  await withTree(
    {
      ".git": "",
      "WATCHDOG.yml": "advisors:\n  - name: good\n    instructions: good text\n",
      "sub/WATCHDOG.yml": "not: [valid yaml\n",
      "sub/WATCHDOG.yaml": "just a scalar string",
      "sub/entries/WATCHDOG.yml": [
        "advisors:",
        "  - name: ok",
        "  - enabled: true",
        "  - name: bad",
        "    enabled: \"yes\"",
        "  - name: also-bad",
        "    tools: [1, 2]",
      ].join("\n"),
    },
    async (root) => {
      const discovered = await discoverAdvisorConfigs(path.join(root, "sub", "entries"));
      const names = discovered.advisors.map((advisor) => advisor.name);
      assert.deepEqual(names, ["good", "ok"]);
      assert.equal(discovered.sharedInstructions, undefined);
    },
  );
});

test("enabled false is retained in the roster; omitted enabled defaults to true", async () => {
  await withTree(
    {
      ".git": "",
      "WATCHDOG.yml": [
        "advisors:",
        "  - name: active",
        "  - name: dormant",
        "    enabled: false",
        "  - name: explicit-on",
        "    enabled: true",
      ].join("\n"),
    },
    async (root) => {
      const discovered = await discoverAdvisorConfigs(root);
      assert.deepEqual(
        discovered.advisors.map((advisor) => [advisor.name, advisor.enabled]),
        [
          ["active", undefined],
          ["dormant", false],
          ["explicit-on", true],
        ],
      );
    },
  );
});

test("WATCHDOG.yaml is honored when no .yml exists", async () => {
  await withTree(
    {
      ".git": "",
      "WATCHDOG.yaml": "advisors:\n  - name: yaml-only\n",
    },
    async (root) => {
      const discovered = await discoverAdvisorConfigs(root);
      assert.deepEqual(
        discovered.advisors.map((advisor) => advisor.name),
        ["yaml-only"],
      );
    },
  );
});

test("tools lists are parsed and retained verbatim", async () => {
  await withTree(
    {
      ".git": "",
      "WATCHDOG.yml": "advisors:\n  - name: toolsy\n    tools: [read, bash, write]\n",
    },
    async (root) => {
      const discovered = await discoverAdvisorConfigs(root);
      assert.deepEqual(discovered.advisors[0].tools, ["read", "bash", "write"]);
    },
  );
});
