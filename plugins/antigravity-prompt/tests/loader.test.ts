import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createAgentSession, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { TARGET_PROVIDER } from "../src/omp.ts";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("production-style plugin loader resolves extension without local node_modules", async () => {
	const root = await mkdtemp(join(tmpdir(), "antigravity-loader-smoke-"));
	const sessionManager = SessionManager.create(pluginRoot, join(root, "sessions"));
	const { session } = await createAgentSession({
		cwd: pluginRoot,
		agentDir: join(root, "agent"),
		additionalExtensionPaths: [join(pluginRoot, "src", "omp.ts")],
		disableExtensionDiscovery: true,
		enableLsp: false,
		enableMCP: false,
		contextFiles: [],
		sessionManager,
		skills: [],
		rules: [],
	});
	try {
		const runner = session.extensionRunner;
		assert.ok(runner, "extensionRunner must be created");
		const models = session.modelRegistry.getAll().filter(m => m.provider === TARGET_PROVIDER);
		assert.ok(models.length > 0, "target provider models must be registered");
	} finally {
		await session.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
