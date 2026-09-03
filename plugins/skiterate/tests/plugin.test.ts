import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const pluginRoot = join(import.meta.dirname, "..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

test("package is a command-only Agent Plugins package", () => {
  const manifest = readJson(join(pluginRoot, "plugin.json"));
  assert.equal(manifest.name, "skiterate");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(existsSync(join(pluginRoot, "skills")), false);
  assert.equal(existsSync(join(pluginRoot, "mcp.json")), false);
  assert.equal(existsSync(join(pluginRoot, "bin")), false);
});

test("package declares native Pi and OMP adapters", () => {
  const packageJson = readJson(join(pluginRoot, "package.json"));
  assert.deepEqual(packageJson.pi, { extensions: ["./src/pi.ts"] });
  assert.deepEqual(packageJson.omp, { extensions: ["./src/omp.ts"] });
  assert.equal(packageJson.private, true);
});
