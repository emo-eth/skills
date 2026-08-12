import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must contain an object`);
  return value as Record<string, unknown>;
}

test("package follows the Agent Plugins root layout", () => {
  const manifest = readJson(join(pluginRoot, "plugin.json"));
  assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(manifest.name, "wall-clock");
  assert.equal(typeof manifest.version, "string");
  assert.equal(typeof manifest.description, "string");
  assert.deepEqual(Object.keys(manifest).sort(), ["$schema", "author", "description", "keywords", "name", "repository", "version"]);
  assert.ok(existsSync(join(pluginRoot, "skills", "wall-clock", "SKILL.md")));
  assert.ok(existsSync(join(pluginRoot, "mcp.json")));
});

test("MCP configuration uses the portable v1 stdio contract", () => {
  const config = readJson(join(pluginRoot, "mcp.json"));
  assert.equal(config.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
  assert.deepEqual(Object.keys(config).sort(), ["$schema", "mcpServers"]);
  const servers = config.mcpServers;
  assert.ok(servers && typeof servers === "object" && !Array.isArray(servers));
  const server = (servers as Record<string, unknown>)["wall-clock"];
  assert.ok(server && typeof server === "object" && !Array.isArray(server));
  const values = server as Record<string, unknown>;
  assert.equal(values.type, "stdio");
  assert.equal(values.command, "./bin/wall-clock");
  assert.equal(values.cwd, "${PLUGIN_ROOT}");
  assert.equal(existsSync(join(pluginRoot, "bin", "wall-clock")), true);
  assert.notEqual(statSync(join(pluginRoot, "bin", "wall-clock")).mode & 0o111, 0);
});

test("the bundled skill matches its directory name", () => {
  const skill = readFileSync(join(pluginRoot, "skills", "wall-clock", "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: wall-clock\ndescription: .+\n/);
  assert.match(skill, /The portable Agent Plugins package can provide tools and instructions\./);
});
