import assert from "node:assert/strict";
import test from "node:test";
import type { SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import { createGeminiRetryFetch } from "../src/retry-fetch.ts";

type Fetch = NonNullable<SimpleStreamOptions["fetch"]>;
const url = "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
const init = { method: "POST", body: JSON.stringify({ model: "gemini-3.8-flash-high" }) };
const exhausted = {
	error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" },
};
const generic429 = () => Response.json(exhausted, { status: 429 });

test("retries unspecified 429s without changing the request or buffering successful SSE", async () => {
	const success = new Response("data: tool-call\n\n", { headers: { "content-type": "text/event-stream" } });
	let calls = 0;
	const waits: number[] = [];
	const fetch: Fetch = async (input, options) => {
		assert.equal(input, url);
		assert.equal(options, init);
		return ++calls < 3 ? generic429() : success;
	};
	const preconnect = () => undefined;
	fetch.preconnect = preconnect;
	const retry = createGeminiRetryFetch({ fetch, providerRetryWait: async ms => { waits.push(ms); } });
	assert.equal(retry.preconnect, preconnect);
	assert.equal(await retry(url, init), success);
	assert.equal(success.bodyUsed, false);
	assert.equal(await success.text(), "data: tool-call\n\n");
	assert.equal(calls, 3);
	assert.equal(waits.length, 2);
	assert.ok(waits[0] >= 2000 && waits[0] < 4000);
	assert.ok(waits[1] >= 4000 && waits[1] < 8000);
});

test("bounds additional retries across stock transport attempts and preserves the final error", async () => {
	const responses: Response[] = [];
	const waits: number[] = [];
	const retry = createGeminiRetryFetch({
		fetch: async () => { const response = generic429(); responses.push(response); return response; },
		providerRetryWait: async ms => { waits.push(ms); },
	});
	const final = await retry(url, init);
	assert.equal(responses.length, 4);
	assert.equal(final, responses[3]);
	assert.deepEqual(await final.json(), exhausted);
	assert.ok(waits[2] >= 8000 && waits[2] < 16000);
	const next = await retry(url, init);
	assert.equal(next, responses[4]);
	assert.equal(waits.length, 3);
	assert.deepEqual(await next.json(), exhausted);
});

test("preserves explicit quota, reset, authentication, and unrecognized responses", async () => {
	const cases = [
		Response.json(exhausted, { status: 429, headers: { "retry-after": "1800" } }),
		Response.json(exhausted, { status: 429, headers: { "retry-after-ms": "0" } }),
		Response.json(exhausted, { status: 429, headers: { "x-ratelimit-reset-after": "60" } }),
		Response.json({ error: { ...exhausted.error, details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "60s" }] } }, { status: 429 }),
		Response.json({ error: { ...exhausted.error, details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED" }] } }, { status: 429 }),
		Response.json({ error: { ...exhausted.error, message: "You have exhausted your capacity on this model." } }, { status: 429 }),
		Response.json({ ...exhausted, resetAt: 123 }, { status: 429 }),
		Response.json(exhausted, { status: 403 }),
		Response.json(exhausted, { status: 503 }),
		new Response("not JSON", { status: 429 }),
		Response.json(null, { status: 429 }),
	];
	for (const response of cases) {
		const expected = await response.clone().text();
		let calls = 0;
		const retry = createGeminiRetryFetch({
			fetch: async () => { calls++; return response; },
			providerRetryWait: async () => { assert.fail("must not add a retry"); },
		});
		assert.equal(await retry(url, init), response);
		assert.equal(await response.text(), expected);
		assert.equal(calls, 1);
	}
});

test("does not retry non-generation operations, foreign endpoints, or non-replayable bodies", async () => {
	const cases: Array<[Parameters<Fetch>[0], RequestInit | undefined]> = [
		[url.replace("daily-cloudcode-pa.googleapis.com", "example.com"), init],
		[url.replace("streamGenerateContent", "loadCodeAssist"), init],
		[url, { method: "GET" }],
		[new Request(url, init), undefined],
		[url, { ...init, body: new Blob(["payload"]) }],
	];
	for (const [input, options] of cases) {
		let calls = 0;
		const response = generic429();
		const retry = createGeminiRetryFetch({ fetch: async () => { calls++; return response; } });
		assert.equal(await retry(input, options), response);
		assert.equal(calls, 1);
	}
});

test("respects a caller retry-delay ceiling and propagates transport exceptions", async () => {
	const response = generic429();
	const retry = createGeminiRetryFetch({ fetch: async () => response, maxRetryDelayMs: 1 });
	assert.equal(await retry(url, init), response);
	const failure = new Error("transport disconnected");
	let calls = 0;
	await assert.rejects(createGeminiRetryFetch({ fetch: async () => { calls++; throw failure; } })(url, init), error => error === failure);
	assert.equal(calls, 1);
});

test("aborts backoff promptly from either caller or request signal without another request", async () => {
	for (const source of ["caller", "request"] as const) {
		const controller = new AbortController();
		let calls = 0;
		let notifyWaiting!: () => void;
		const waiting = new Promise<void>(resolve => { notifyWaiting = resolve; });
		const retry = createGeminiRetryFetch({
			signal: source === "caller" ? controller.signal : undefined,
			fetch: async () => { calls++; return generic429(); },
			providerRetryWait: async (_ms, signal) => {
				notifyWaiting();
				await new Promise<void>((_resolve, reject) => {
					signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
				});
			},
		});
		const pending = retry(url, { ...init, signal: source === "request" ? controller.signal : undefined });
		await waiting;
		controller.abort(new Error("cancelled"));
		await assert.rejects(pending, /cancelled/);
		assert.equal(calls, 1);
		await assert.rejects(retry(url, { ...init, signal: controller.signal }), /cancelled/);
		assert.equal(calls, 1);
	}
});

test("eight workers retry independently and keep eight requests in flight", async () => {
	let inFlight = 0;
	let peak = 0;
	let release!: () => void;
	const allStarted = new Promise<void>(resolve => { release = resolve; });
	const workers = Array.from({ length: 8 }, (_, worker) => {
		let calls = 0;
		const retry = createGeminiRetryFetch({
			fetch: async () => {
				if (++calls === 1) {
					inFlight++;
					peak = Math.max(peak, inFlight);
					if (inFlight === 8) release();
					await allStarted;
					inFlight--;
					return generic429();
				}
				return new Response(String(worker));
			},
			providerRetryWait: async () => undefined,
		});
		return retry(url, init).then(async response => {
			assert.equal(await response.text(), String(worker));
			assert.equal(calls, 2);
		});
	});
	await Promise.all(workers);
	assert.equal(peak, 8);
});
