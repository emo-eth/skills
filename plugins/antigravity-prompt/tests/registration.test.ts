import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthStorage, getCustomApi, type Model } from "@oh-my-pi/pi-ai";
import { ModelRegistry, type ExtensionAPI, type ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import install, { CUSTOM_API, DURABLE_SOURCE_ID, TARGET_PROVIDER } from "../src/omp.ts";

function session(registry: ModelRegistry) {
	let start!: (event: unknown, context: ExtensionContext) => Promise<void>;
	let selected = registry.find(TARGET_PROVIDER, "gemini-3.8-flash");
	install({
		on: (event: string, handler: typeof start) => { assert.equal(event, "session_start"); start = handler; },
		setModel: async (model: Model) => { selected = model; return true; },
	} as unknown as ExtensionAPI);
	return {
		start: () => start({}, { modelRegistry: registry, model: selected } as ExtensionContext),
		model: () => selected,
	};
}

test("each native child restores the custom provider after SDK extension-source cleanup", async () => {
	const root = await mkdtemp(join(tmpdir(), "antigravity-registry-"));
	const auth = await AuthStorage.create(join(root, "auth.db"));
	const registry = new ModelRegistry(auth, join(root, "models.yml"), { ignoreLocalModelConfig: true });
	try {
		const parent = session(registry);
		await parent.start();
		assert.equal(parent.model()?.api, CUSTOM_API);
		assert.ok(getCustomApi(CUSTOM_API));

		for (let child = 0; child < 3; child++) {
			const worker = session(registry);
			registry.syncExtensionSources([]);
			assert.equal(registry.find(TARGET_PROVIDER, "gemini-3.8-flash")?.api, "google-gemini-cli");
			assert.equal(getCustomApi(CUSTOM_API), undefined);
			await worker.start();
			assert.equal(registry.find(TARGET_PROVIDER, "gemini-3.8-flash")?.api, CUSTOM_API);
			assert.equal(worker.model()?.api, CUSTOM_API);
			assert.ok(getCustomApi(CUSTOM_API));
		}
	} finally {
		registry.clearSourceRegistrations(DURABLE_SOURCE_ID);
		auth.close();
		await rm(root, { recursive: true, force: true });
	}
});
