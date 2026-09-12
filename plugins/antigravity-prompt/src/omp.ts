import { getProviderDefinition, registerCustomApi, streamSimple, type Context, type Model, type SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import type { OAuthCredentials } from "@oh-my-pi/pi-ai/oauth/types";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

export const CUSTOM_API = "google-gemini-cli-prompt-fix";
export const TARGET_PROVIDER = "google-antigravity";
export const DURABLE_SOURCE_ID = "antigravity-prompt-fix-durable";

let isInitialized = false;
const detachedOriginals: Record<string, Model<"google-gemini-cli">> = {};

export function patchSentence(text: string): string {
	return text.replace(
		/RFC 2119:\s*MUST,\s*REQUIRED,\s*SHOULD,\s*RECOMMENDED,\s*MAY,\s*OPTIONAL\.\s*`NEVER`\s*=\s*`MUST NOT`(?:\s*;\s*`AVOID`\s*=\s*`SHOULD NOT`)?\./g,
		"Guidelines: MUST, REQUIRED, SHOULD, RECOMMENDED, MAY, OPTIONAL. NEVER means MUST NOT; AVOID means SHOULD NOT.",
	);
}

export function patchSystemPrompt<T extends string | string[] | undefined>(prompt: T): T {
	if (typeof prompt === "string") {
		return patchSentence(prompt) as T;
	}
	if (Array.isArray(prompt)) {
		return prompt.map(patchSentence) as T;
	}
	return prompt;
}

export function isAdvisorContext(context: Context): boolean {
	if (context.tools?.some(t => t.name === "advise")) {
		return true;
	}
	const prompt = context.systemPrompt as unknown;
	if (typeof prompt === "string") {
		return prompt.includes("peer-shadow main agent");
	}
	if (Array.isArray(prompt)) {
		return prompt.some(s => typeof s === "string" && s.includes("peer-shadow main agent"));
	}
	return false;
}

export function streamSimpleHandler(model: Model, context: Context, options?: SimpleStreamOptions) {
	const stockModel = detachedOriginals[model.id];
	if (!stockModel) {
		throw new Error(`Detached stock model not found for id: ${model.id}`);
	}

	const fixedContext: Context = {
		...context,
		systemPrompt: patchSystemPrompt(context.systemPrompt),
	};

	let effectiveOptions = options;
	if (isAdvisorContext(context) && effectiveOptions?.acceptEmptyResponse === undefined) {
		effectiveOptions = { ...effectiveOptions, acceptEmptyResponse: true };
	}

	return streamSimple(stockModel, fixedContext, effectiveOptions);
}

export default function (pi: ExtensionAPI): void {
	registerCustomApi(CUSTOM_API, streamSimpleHandler, DURABLE_SOURCE_ID);

	pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
		registerCustomApi(CUSTOM_API, streamSimpleHandler, DURABLE_SOURCE_ID);

		if (isInitialized) return;
		isInitialized = true;

		const catalogModels = ctx.modelRegistry.getAll().filter((m: Model) => m.provider === TARGET_PROVIDER);
		if (catalogModels.length === 0) {
			return;
		}

		for (const m of catalogModels) {
			const resolved = ctx.modelRegistry.find(m.provider, m.id) ?? m;
			detachedOriginals[m.id] = {
				...resolved,
				compat: resolved.compat ? { ...resolved.compat } : undefined,
				thinking: resolved.thinking ? { ...resolved.thinking } : undefined,
				api: "google-gemini-cli",
			} as unknown as Model<"google-gemini-cli">;
		}

		const originalBaseUrl = catalogModels[0]?.baseUrl ?? "https://daily-cloudcode-pa.googleapis.com";
		const stockOAuth = getProviderDefinition(TARGET_PROVIDER);

		type RegisterConfig = Parameters<typeof ctx.modelRegistry.registerProvider>[1];
		type RegisteredModel = NonNullable<RegisterConfig["models"]>[number];

		const registeredModels: RegisteredModel[] = catalogModels.map((m: Model) => {
			const { api: _, ...copy } = m as unknown as Record<string, unknown>;
			return copy as unknown as RegisteredModel;
		});

		ctx.modelRegistry.registerProvider(
			TARGET_PROVIDER,
			{
				baseUrl: originalBaseUrl,
				api: CUSTOM_API as unknown as RegisterConfig["api"],
				streamSimple: streamSimpleHandler,
				models: registeredModels,
				oauth: stockOAuth?.login
					? {
							name: stockOAuth.name,
							login: stockOAuth.login,
							refreshToken: stockOAuth.refreshToken,
							getApiKey(creds: OAuthCredentials): string {
								return JSON.stringify({
									token: creds.access,
									projectId: creds.projectId,
									refreshToken: creds.refresh,
									expiresAt: creds.expires,
									email: creds.email,
									accountId: creds.accountId,
									enterpriseUrl: creds.enterpriseUrl,
									apiEndpoint: creds.apiEndpoint,
								});
							},
						}
					: undefined,
			},
			DURABLE_SOURCE_ID,
		);

		const currentModel = ctx.model;
		if (currentModel && currentModel.provider === TARGET_PROVIDER) {
			const registered = ctx.modelRegistry.find(TARGET_PROVIDER, currentModel.id);
			if (registered) {
				await pi.setModel(registered);
			}
		}
	});
}
