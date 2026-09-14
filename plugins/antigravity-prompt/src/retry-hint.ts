// Local copy of OMP's retry-hint header/body parsing. Plugins must not import
// @oh-my-pi/pi-utils at runtime because OMP does not install it in plugin trees.

const QUOTA_RESET_PATTERN = /reset after (?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s/i;
const PLEASE_RETRY_PATTERN = /Please retry in ([0-9.]+)(ms|s)/i;
const RETRY_DELAY_FIELD_PATTERN = /"retryDelay":\s*"([0-9.]+)(ms|s)"/i;
const TRY_AGAIN_PATTERN = /try again in\s+~?\s*([0-9.]+)\s*(ms|sec|s|minutes?|mins?|m|hours?|hrs?|h)\b/i;
const WILL_RESET_IN_PATTERN = /(?:will\s+)?reset in\s+~?\s*([0-9.]+)\s*(ms|sec|s|minutes?|mins?|m|hours?|hrs?|h)\b/i;
const WILL_RESET_AT_PATTERN =
	/(?:will\s+)?reset at\s+([0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)/i;
const CN_RESET_AT_PATTERN = /将在\s*([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2}:[0-9]{2})\s*重置/;
const RETRY_AFTER_MS_BODY_PATTERN = /\bretry-after-ms\s*[:=]\s*([0-9]+)\b/i;

function unitToMs(unit: string): number | undefined {
	switch (unit.toLowerCase()) {
		case "ms":
			return 1;
		case "s":
		case "sec":
			return 1000;
		case "m":
		case "min":
		case "mins":
		case "minute":
		case "minutes":
			return 60_000;
		case "h":
		case "hr":
		case "hrs":
		case "hour":
		case "hours":
			return 60 * 60_000;
		default:
			return undefined;
	}
}

export function extractRetryHint(source: Response | Headers | null | undefined, body?: string): number | undefined {
	const headers = source instanceof Headers ? source : (source?.headers ?? undefined);
	if (headers) {
		const retryAfterMs = headers.get("retry-after-ms");
		if (retryAfterMs) {
			const ms = Number(retryAfterMs);
			if (Number.isFinite(ms) && ms >= 0) return ms;
		}
		const retryAfter = headers.get("retry-after");
		if (retryAfter) {
			const seconds = Number(retryAfter);
			if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
			const parsedDate = Date.parse(retryAfter);
			if (!Number.isNaN(parsedDate)) return Math.max(0, parsedDate - Date.now());
		}
		const rateLimitResetMs = headers.get("x-ratelimit-reset-ms");
		if (rateLimitResetMs) {
			const value = Number(rateLimitResetMs);
			if (Number.isFinite(value) && value > 0) {
				const targetMs = value > 1e12 ? value : value > 1e9 ? value * 1000 : undefined;
				if (targetMs === undefined) return value;
				const delta = targetMs - Date.now();
				if (delta > 0) return delta;
			}
		}
		const rateLimitReset = headers.get("x-ratelimit-reset");
		if (rateLimitReset) {
			const resetSeconds = Number.parseInt(rateLimitReset, 10);
			if (!Number.isNaN(resetSeconds)) {
				const delta = resetSeconds * 1000 - Date.now();
				if (delta > 0) return delta;
			}
		}
		const rateLimitResetAfter = headers.get("x-ratelimit-reset-after");
		if (rateLimitResetAfter) {
			const seconds = Number(rateLimitResetAfter);
			if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
		}
	}

	if (!body) return undefined;

	let longestMs: number | undefined;
	let retryNow = false;
	const consider = (ms: number | undefined): void => {
		if (ms !== undefined && ms > 0 && (longestMs === undefined || ms > longestMs)) longestMs = ms;
	};
	const considerClamped = (ms: number | undefined): void => {
		if (ms === undefined) return;
		if (ms > 0) consider(ms);
		else retryNow = true;
	};

	const quotaMatch = QUOTA_RESET_PATTERN.exec(body);
	if (quotaMatch) {
		const hours = quotaMatch[1] ? Number.parseInt(quotaMatch[1], 10) : 0;
		const minutes = quotaMatch[2] ? Number.parseInt(quotaMatch[2], 10) : 0;
		const seconds = Number.parseFloat(quotaMatch[3]!);
		if (!Number.isNaN(seconds)) {
			const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000;
			consider(totalMs > 0 ? totalMs : undefined);
		}
	}
	for (const pattern of [WILL_RESET_AT_PATTERN, CN_RESET_AT_PATTERN]) {
		const match = pattern.exec(body);
		if (match?.[1]) {
			const normalized = match[1].replace(" ", "T");
			const hasOffset = /(?:Z|[+-][0-9]{2}:?[0-9]{2})$/i.test(normalized);
			const parsed = Date.parse(hasOffset ? normalized : `${normalized}Z`);
			if (!Number.isNaN(parsed) && parsed > Date.now()) {
				consider(parsed - Date.now());
			}
		}
	}
	const accountResetMatch = WILL_RESET_IN_PATTERN.exec(body);
	if (accountResetMatch?.[1]) {
		const value = Number.parseFloat(accountResetMatch[1]);
		if (Number.isFinite(value) && value > 0) {
			const unitMs = unitToMs(accountResetMatch[2]!);
			if (unitMs !== undefined) consider(value * unitMs);
		}
	}

	const retryAfterMsMatch = RETRY_AFTER_MS_BODY_PATTERN.exec(body);
	if (retryAfterMsMatch?.[1]) {
		const ms = Number(retryAfterMsMatch[1]);
		if (Number.isFinite(ms)) considerClamped(ms);
	}

	for (const pattern of [PLEASE_RETRY_PATTERN, RETRY_DELAY_FIELD_PATTERN, TRY_AGAIN_PATTERN]) {
		const match = pattern.exec(body);
		if (match?.[1]) {
			const value = Number.parseFloat(match[1]);
			if (Number.isFinite(value) && value > 0) {
				const unitMs = unitToMs(match[2]!);
				if (unitMs !== undefined) consider(value * unitMs);
			}
		}
	}

	const retryAfterMatch = /retry-after\s*[:=]\s*([^\s,;]+)/i.exec(body);
	if (retryAfterMatch) {
		const value = retryAfterMatch[1]!;
		const seconds = Number(value);
		if (Number.isFinite(seconds)) {
			considerClamped(seconds * 1000);
		} else {
			const dateMs = Date.parse(value);
			if (!Number.isNaN(dateMs)) considerClamped(dateMs - Date.now());
		}
	}

	const resetMsMatch = /x-ratelimit-reset-ms\s*[:=]\s*(\d+)/i.exec(body);
	if (resetMsMatch) {
		const resetMs = Number(resetMsMatch[1]);
		if (!Number.isNaN(resetMs)) {
			considerClamped(resetMs > 1_000_000_000_000 ? resetMs - Date.now() : resetMs);
		}
	}

	const resetMatch = /x-ratelimit-reset\s*[:=]\s*(\d+)/i.exec(body);
	if (resetMatch) {
		const resetSeconds = Number(resetMatch[1]);
		if (!Number.isNaN(resetSeconds)) {
			considerClamped(resetSeconds > 1_000_000_000 ? resetSeconds * 1000 - Date.now() : resetSeconds * 1000);
		}
	}
	return longestMs ?? (retryNow ? 0 : undefined);
}
