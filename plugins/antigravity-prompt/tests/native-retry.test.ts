import assert from "node:assert/strict";
import test from "node:test";
import { streamSimple, type SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { createGeminiRetryFetch } from "../src/retry-fetch.ts";

const model = getBundledModel("google-antigravity", "gemini-3.8-flash");
const context = { messages: [{ role: "user" as const, content: "Read the package.", timestamp: 1 }] };
const apiKey = JSON.stringify({ token: "test-access", projectId: "test-project", expiresAt: Date.now() + 3_600_000 });

function transport() {
	let calls = 0;
	const models: string[] = [];
	const fetch: NonNullable<SimpleStreamOptions["fetch"]> = async (_input, init) => {
		models.push(JSON.parse(String(init?.body)).model);
		if (++calls <= 6) {
			return Response.json({ error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" } }, { status: 429 });
		}
		return new Response(`data: ${JSON.stringify({ response: {
			candidates: [{ content: { parts: [{ functionCall: { name: "read", args: { path: "package.json" } } }] }, finishReason: "STOP" }],
			usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1, totalTokenCount: 11 },
		} })}\n\n`, { headers: { "content-type": "text/event-stream" } });
	};
	return { fetch, models, calls: () => calls };
}

test("stock transport exhausts on six rejections; wrapped transport emits one native tool call on the same model", { timeout: 30_000 }, async () => {
	const original = transport();
	const failed = await streamSimple(model, context, { apiKey, fetch: original.fetch }).result();
	assert.equal(failed.stopReason, "error");
	assert.equal(failed.errorStatus, 429);
	assert.equal(original.calls(), 5);

	const recovering = transport();
	const waits: number[] = [];
	const fetch = createGeminiRetryFetch({
		fetch: recovering.fetch,
		providerRetryWait: async ms => { waits.push(ms); },
	});
	const stream = streamSimple(model, context, { apiKey, fetch });
	const events = [];
	for await (const event of stream) events.push(event);
	const result = await stream.result();
	assert.equal(result.provider, "google-antigravity");
	assert.equal(result.model, "gemini-3.8-flash");
	assert.equal(result.stopReason, "toolUse");
	assert.equal(result.content.filter(part => part.type === "toolCall").length, 1);
	assert.equal(events.filter(event => event.type === "toolcall_end").length, 1);
	assert.equal(events.filter(event => event.type === "error").length, 0);
	assert.equal(recovering.calls(), 7);
	assert.equal(waits.length, 3);
	assert.equal(new Set(recovering.models).size, 1);
	assert.ok(recovering.models[0].startsWith("gemini-3.8-flash"));
});
