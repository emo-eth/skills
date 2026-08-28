import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const SKILLS = join(import.meta.dir, "../..");
const UPSTREAM_SKILLS = [
  "architect",
  "arena",
  "automate-me",
  "blast-radius",
  "bro",
  "create-verification-skill",
  "figure-it-out",
  "make-bot-ui",
  "how",
  "interrogate",
  "maintain-verification-skill",
  "no-comments",
  "poteto-mode",
  "principle-boundary-discipline",
  "principle-build-the-lever",
  "principle-encode-lessons-in-structure",
  "principle-exhaust-the-design-space",
  "principle-experience-first",
  "principle-fix-root-causes",
  "principle-foundational-thinking",
  "principle-guard-the-context-window",
  "principle-laziness-protocol",
  "principle-make-operations-idempotent",
  "principle-migrate-callers-then-delete-legacy-apis",
  "principle-minimize-reader-load",
  "principle-model-the-domain",
  "principle-never-block-on-the-human",
  "principle-outcome-oriented-execution",
  "principle-prove-it-works",
  "principle-redesign-from-first-principles",
  "principle-separate-before-serializing-shared-state",
  "principle-sequence-verifiable-units",
  "principle-subtract-before-you-add",
  "principle-type-system-discipline",
  "recall",
  "reflect",
  "setup-pstack",
  "show-me-your-work",
  "swarm",
  "pstack-tdd",
  "pstack-teach",
  "technical-writing",
  "typescript-best-practices",
  "unslop",
  "why",
] as const;

async function skillName(directory: string): Promise<string | undefined> {
  const content = await readFile(join(SKILLS, directory, "SKILL.md"), "utf8");
  return content.match(/^name:\s*(.+)$/m)?.[1].trim();
}

describe("pstack port packaging", () => {
  it("publishes every upstream skill with matching frontmatter and a license", async () => {
    expect(UPSTREAM_SKILLS).toHaveLength(45);

    for (const directory of UPSTREAM_SKILLS) {
      expect(await skillName(directory)).toBe(directory);
      expect(await readFile(join(SKILLS, directory, "LICENSE"), "utf8")).toContain("Copyright (c) 2026 Lauren Tan");
    }
  });

  it("publishes the host runtime adapter", async () => {
    expect(await skillName("pstack-runtime")).toBe("pstack-runtime");
    expect(await readFile(join(SKILLS, "pstack-runtime", "LICENSE"), "utf8")).toContain("Copyright (c) 2026 Lauren Tan");
  });

  it("bundles installable poteto and comment agents", async () => {
    const poteto = await readFile(join(SKILLS, "poteto-mode/agents/poteto-agent.agent.md"), "utf8");
    const comments = await readFile(join(SKILLS, "no-comments/agents/comment-sicko.agent.md"), "utf8");

    expect(poteto).toMatch(/^name:\s*poteto-agent$/m);
    expect(comments).toMatch(/^name:\s*comment-sicko$/m);
  });
});
