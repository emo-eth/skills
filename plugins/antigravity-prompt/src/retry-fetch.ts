import { setTimeout as sleep } from "node:timers/promises";
import type { SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import { extractRetryHint } from "./retry-hint.ts";

type Fetch = NonNullable<SimpleStreamOptions["fetch"]>;

function isGenerationRequest(input: Parameters<Fetch>[0], init?: RequestInit): boolean {
	if (input instanceof Request || init?.method !== "POST" || typeof init.body !== "string") return false;
	const url = new URL(input);
	return url.protocol === "https:" &&
		(url.hostname === "daily-cloudcode-pa.googleapis.com" ||
			url.hostname === "daily-cloudcode-pa.sandbox.googleapis.com") &&
		url.pathname === "/v1internal:streamGenerateContent";
}

async function isUnspecifiedExhaustion(response: Response): Promise<boolean> {
	if (response.status !== 429 || extractRetryHint(response) !== undefined) return false;
	let body: unknown;
	try {
		body = await response.clone().json();
	} catch {
		return false;
	}
	if (!body || typeof body !== "object" || Object.keys(body).length !== 1 || !("error" in body)) return false;
	const error = body.error;
	return !!error && typeof error === "object" && Object.keys(error).length === 3 &&
		"code" in error && error.code === 429 &&
		"status" in error && error.status === "RESOURCE_EXHAUSTED" &&
		"message" in error && error.message === "Resource has been exhausted (e.g. check quota).";
}

export function createGeminiRetryFetch(options: SimpleStreamOptions = {}): Fetch {
	const fetch: Fetch = options.fetch ?? globalThis.fetch;
	const wait = options.providerRetryWait ?? ((delayMs, signal) => sleep(delayMs, undefined, { signal }));
	const retryFetch: Fetch = async (input, init) => {
		if (!isGenerationRequest(input, init)) return fetch(input, init);
		const signals = [options.signal, init?.signal].filter((signal): signal is AbortSignal => !!signal);
		const signal = signals.length ? AbortSignal.any(signals) : undefined;
		let retries = 0;
		while (true) {
			signal?.throwIfAborted();
			const response = await fetch(input, init);
			if (retries >= 3 || !(await isUnspecifiedExhaustion(response))) return response;
			const delayMs = 2000 * 2 ** retries * (1 + Math.random());
			if (options.maxRetryDelayMs !== undefined && delayMs > options.maxRetryDelayMs) return response;
			retries++;
			await response.body?.cancel();
			await wait(delayMs, signal);
		}
	};
	retryFetch.preconnect = fetch.preconnect;
	return retryFetch;
}
