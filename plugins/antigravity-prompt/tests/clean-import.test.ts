import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("retry-fetch imports without @oh-my-pi/pi-utils in an isolated source tree", async () => {
	const root = await mkdtemp(join(tmpdir(), "antigravity-clean-import-"));
	const src = join(root, "src");
	await cp(join(import.meta.dirname, "..", "src"), src, { recursive: true });
	try {
		const modulePath = join(src, "retry-fetch.ts");
		const child = spawn(
			process.execPath,
			[
				"--experimental-strip-types",
				"--input-type=module",
				"-e",
				`const plugin = await import(${JSON.stringify(modulePath)});
if (typeof plugin.createGeminiRetryFetch !== "function") throw new Error("missing export");
console.log("ok");`,
			],
			{ cwd: root, env: { ...process.env, NODE_OPTIONS: "" } },
		);
		const [stdout, stderr, code] = await new Promise<[string, string, number | null]>((resolve, reject) => {
			let out = "";
			let err = "";
			child.stdout.on("data", chunk => { out += String(chunk); });
			child.stderr.on("data", chunk => { err += String(chunk); });
			child.on("error", reject);
			child.on("close", exitCode => resolve([out, err, exitCode]));
		});
		assert.equal(code, 0, stderr || stdout);
		assert.match(stdout, /ok/);
		assert.doesNotMatch(stderr, /pi-utils/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
