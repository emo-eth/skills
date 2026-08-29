import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must contain an object`);
  return value as Record<string, unknown>;
}

test("package follows the skill-only Agent Plugins root layout", () => {
  const manifest = readJson(join(pluginRoot, "plugin.json"));
  assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(manifest.name, "wall-clock");
  assert.equal(typeof manifest.version, "string");
  assert.equal(typeof manifest.description, "string");
  assert.deepEqual(Object.keys(manifest).sort(), ["$schema", "author", "description", "keywords", "name", "repository", "version"]);
  assert.ok(existsSync(join(pluginRoot, "skills", "wall-clock", "SKILL.md")));
  assert.equal(existsSync(join(pluginRoot, "mcp.json")), false);
  assert.equal(existsSync(join(pluginRoot, "bin", "wall-clock")), false);
});

test("package declares native Pi and OMP extension entry points", () => {
  const packageJson = readJson(join(pluginRoot, "package.json"));
  assert.equal(packageJson.version, "0.1.0");
  assert.deepEqual(packageJson.engines, { node: ">=22.6" });
  assert.deepEqual(packageJson.pi, { extensions: ["./src/pi.ts"] });
  assert.deepEqual(packageJson.omp, { extensions: ["./src/omp.ts"] });
});


test("the bundled skill matches its directory name", () => {
  const skill = readFileSync(join(pluginRoot, "skills", "wall-clock", "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: wall-clock\ndescription: .+\n/);
  assert.match(skill, /The portable Agent Plugins package provides instructions only\./);
  assert.match(skill, /Use `block-new` when the user does not select a policy\./);
});
