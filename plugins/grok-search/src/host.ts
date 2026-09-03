import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export type GrokCitation = {
  title: string;
  url: string;
};

export type GrokSearchResult = {
  kind: "search";
  model: string;
  answer: string;
  citations: GrokCitation[];
  degraded: boolean;
  warnings: string[];
};

export type XMedia = {
  type: string;
  url: string;
  description: string;
};

export type XItem = {
  relation: "anchor" | "authored" | "parent" | "quote" | "reply" | "quote_reaction";
  url: string;
  authorHandle: string;
  authorName: string;
  timestamp: string;
  text: string;
  media: XMedia[];
  links: string[];
};

export type XDiscussion = {
  included: boolean;
  sampleNotice: string;
  viewpoints: Array<{
    theme: string;
    summary: string;
    examples: XItem[];
  }>;
};

export type XRetrieval = {
  requestedUrl: string;
  content: "anchor" | "authored";
  available: boolean;
  contentKind: "post" | "article" | "unknown";
  failureReason: string;
  anchor: XItem | null;
  authoredContextAvailable: boolean;
  authoredContext: XItem[];
  relatedContext: XItem[];
  discussion: XDiscussion;
};

export type GrokFetchResult = {
  kind: "fetch";
  model: string;
  citations: GrokCitation[];
  degraded: boolean;
  warnings: string[];
  retrieval: XRetrieval;
};

export type GrokAuthStatus = {
  kind: "auth_status";
  authenticated: boolean;
  source: "host-xai" | "grok-cli" | "plugin-oauth" | "env" | null;
  refreshable: boolean;
  state: string;
};

export type GrokDeviceAuthorization = {
  kind: "device_authorization";
  session: string;
  verificationUrl: string;
  userCode: string;
  expiresAt: string;
};

export type GrokToolError = {
  kind: "error";
  code: string;
  message: string;
  source: string | null;
};

export type GrokResult = GrokSearchResult | GrokFetchResult;
export type GrokPayload = GrokResult | GrokAuthStatus | GrokDeviceAuthorization | GrokToolError;

export type GrokRunner = (
  args: string[],
  options: { signal?: AbortSignal; hostCredential?: string; blockApiKey?: boolean },
) => Promise<unknown>;

export type RuntimeHost = {
  registerTool?: (definition: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute: (...args: unknown[]) => unknown;
  }) => void;
};

type HostModel = {
  provider: string;
  id: string;
  baseUrl?: string;
};

type HostModelRegistry = {
  getAll?: () => HostModel[];
  getProviderAuth?: (provider: string) => Promise<{
    auth?: { apiKey?: string };
    source?: string;
  } | undefined>;
  getApiKeyForProvider?: (
    provider: string,
    sessionId?: string,
    options?: {
      baseUrl?: string;
      modelId?: string;
      forceRefresh?: boolean;
      signal?: AbortSignal;
    },
  ) => Promise<string | undefined>;
  isUsingOAuth?: (model: HostModel) => boolean;
  authStorage?: {
    getCredentialOrigin?: (provider: string) => {
      kind: string;
      envVar?: string;
    } | undefined;
    hasOAuth?: (provider: string) => boolean;
  };
};

type ToolExecutionContext = {
  modelRegistry: HostModelRegistry;
  model?: HostModel;
};

type SearchInput = {
  query: string;
  response?: "sources" | "answer";
  depth?: "quick" | "deep";
  handles?: string[];
  excludeHandles?: string[];
  from?: string;
  to?: string;
  images?: boolean;
  videos?: boolean;
  model?: string;
};

type FetchInput = {
  url: string;
  content?: "anchor" | "authored";
  discussion?: boolean;
  model?: string;
};

type AuthInput = {
  action: "status" | "start_device" | "complete_device";
  session?: string;
};

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/grok-search.py", import.meta.url));
const PROCESS_TIMEOUT_MS = 195_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const X_HOSTS: Record<string, true> = {
  "x.com": true,
  "www.x.com": true,
  "twitter.com": true,
  "www.twitter.com": true,
  "mobile.twitter.com": true,
};

export function installGrokTools(
  host: RuntimeHost,
  options: { runner?: GrokRunner } = {},
): void {
  if (typeof host?.registerTool !== "function") {
    throw new Error("grok-search requires the host's native registerTool seam");
  }

  const runner = options.runner ?? runGrokCli;

  host.registerTool({
    name: "grok_search",
    label: "Search X with Grok",
    description: "Search live X posts, sources, reactions, narratives, and sentiment. Use quick depth for ordinary context and deep depth for broad, high-stakes, or fast-moving questions. Sources mode returns evidence for the calling agent; answer mode asks Grok for bounded X-native synthesis. Never use this tool for the general web.",
    parameters: SEARCH_SCHEMA,
    execute: async (...args: unknown[]) => {
      const input = toolInput<SearchInput>(args);
      return textResult(await runContentTool(runner, buildSearchArgs(input), args, "search"));
    },
  });

  host.registerTool({
    name: "grok_fetch",
    label: "Fetch X content",
    description: "Faithfully retrieve a specific X post, authored thread, or X Article. Anchor content is the default. Request authored content for the complete author-composed unit and discussion for representative replies and quote-post reactions. Parent, quote, link, and media context retain provenance.",
    parameters: FETCH_SCHEMA,
    execute: async (...args: unknown[]) => {
      const input = toolInput<FetchInput>(args);
      return textResult(await runContentTool(runner, buildFetchArgs(input), args, "fetch"));
    },
  });

  host.registerTool({
    name: "grok_auth",
    label: "Connect Grok",
    description: "Inspect Grok authentication or run a consent-gated device login. Call start_device only after the user explicitly approves login. Present its verification URL and code, wait for the user to approve in a browser, call complete_device with the returned session, then retry the original Grok request.",
    parameters: AUTH_SCHEMA,
    execute: async (...args: unknown[]) => {
      const input = toolInput<AuthInput>(args);
      const signal = toolSignal(args);
      const hostAuth = input.action === "status"
        ? await resolveHostOAuth(args, signal)
        : {};
      const value = await runner(buildAuthArgs(input), {
        signal,
        hostCredential: hostAuth.credential,
        blockApiKey: hostAuth.subscriptionPresent === true && hostAuth.credential === undefined ? true : undefined,
      });
      return textResult(parseAuthPayload(value));
    },
  });
}

export async function runGrokCli(
  args: string[],
  options: {
    signal?: AbortSignal;
    hostCredential?: string;
    blockApiKey?: boolean;
    pythonBinary?: string;
    scriptPath?: string;
  } = {},
): Promise<unknown> {
  const pythonBinary = options.pythonBinary ?? process.env.GROK_SEARCH_PYTHON ?? "python3";
  const scriptPath = options.scriptPath ?? SCRIPT_PATH;
  const childEnvironment = { ...process.env };
  delete childEnvironment.GROK_SEARCH_HOST_OAUTH_TOKEN;
  delete childEnvironment.GROK_SEARCH_BLOCK_API_KEY;
  if (options.hostCredential !== undefined) {
    childEnvironment.GROK_SEARCH_HOST_OAUTH_TOKEN = options.hostCredential;
  }
  if (options.blockApiKey === true) {
    childEnvironment.GROK_SEARCH_BLOCK_API_KEY = "1";
  }

  return await new Promise<unknown>((resolve, reject) => {
    execFile(
      pythonBinary,
      [scriptPath, ...args],
      {
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
        signal: options.signal,
        env: childEnvironment,
        timeout: PROCESS_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        if (error) {
          if (options.signal?.aborted) {
            reject(new Error("Grok request cancelled"));
            return;
          }
          const detail = redactProcessDetail(stderr.trim() || error.message);
          reject(new Error(`Grok request failed: ${detail}`));
          return;
        }

        try {
          const parsed: unknown = JSON.parse(stdout);
          assertNoSecretFields(parsed);
          resolve(parsed);
        } catch (parseError) {
          const detail = parseError instanceof Error ? parseError.message : String(parseError);
          reject(new Error(`Grok returned an invalid result: ${detail}`));
        }
      },
    );
  });
}

export function buildSearchArgs(input: SearchInput): string[] {
  const query = requiredText(input.query, "query");
  const response = input.response ?? "sources";
  const depth = input.depth ?? "quick";
  if (response !== "sources" && response !== "answer") {
    throw new Error("response must be sources or answer");
  }
  if (depth !== "quick" && depth !== "deep") {
    throw new Error("depth must be quick or deep");
  }

  const handles = stringList(input.handles, "handles");
  const excludedHandles = stringList(input.excludeHandles, "excludeHandles");
  if (handles.length > 0 && excludedHandles.length > 0) {
    throw new Error("handles and excludeHandles cannot be combined");
  }

  const args = ["x", query, "--json", "--depth", depth];
  if (response === "sources") args.push("--brief");
  for (const handle of handles) args.push("--handle", handle);
  for (const handle of excludedHandles) args.push("--exclude-handle", handle);
  if (input.from !== undefined) args.push("--from", requiredText(input.from, "from"));
  if (input.to !== undefined) args.push("--to", requiredText(input.to, "to"));
  if (input.images === true) args.push("--images");
  if (input.videos === true) args.push("--videos");
  appendModel(args, input.model);
  return args;
}

export function buildFetchArgs(input: FetchInput): string[] {
  const content = input.content ?? "anchor";
  if (content !== "anchor" && content !== "authored") {
    throw new Error("content must be anchor or authored");
  }
  const args = ["fetch", xUrl(input.url), "--json", "--content", content];
  if (input.discussion === true) args.push("--discussion");
  appendModel(args, input.model);
  return args;
}

export function buildAuthArgs(input: AuthInput): string[] {
  if (input.action === "status") return ["auth", "--json"];
  if (input.action === "start_device") return ["login", "--device", "--start", "--json"];
  if (input.action === "complete_device") {
    return ["login", "--device", "--complete", requiredText(input.session, "session"), "--json"];
  }
  throw new Error("action must be status, start_device, or complete_device");
}

async function runContentTool(
  runner: GrokRunner,
  cliArgs: string[],
  toolArgs: unknown[],
  expected: "search" | "fetch",
): Promise<GrokResult | GrokToolError> {
  const signal = toolSignal(toolArgs);
  const hostAuth = await resolveHostOAuth(toolArgs, signal);
  let value = await runner(cliArgs, {
    signal,
    hostCredential: hostAuth.credential,
    blockApiKey: hostAuth.subscriptionPresent === true && hostAuth.credential === undefined ? true : undefined,
  });
  let parsed = parseContentPayload(value, expected);
  if (
    parsed.kind === "error"
    && parsed.code === "auth_expired"
    && parsed.source === "host-xai"
    && hostAuth.credential !== undefined
  ) {
    const refreshed = await resolveHostOAuth(toolArgs, signal, true);
    if (refreshed.credential !== undefined && refreshed.credential !== hostAuth.credential) {
      value = await runner(cliArgs, { signal, hostCredential: refreshed.credential });
      parsed = parseContentPayload(value, expected);
      if (!(parsed.kind === "error" && parsed.code === "auth_expired" && parsed.source === "host-xai")) {
        return parsed;
      }
    }
    value = await runner(cliArgs, { signal, blockApiKey: true });
    parsed = parseContentPayload(value, expected);
  }
  return parsed;
}

async function resolveHostOAuth(
  args: unknown[],
  signal: AbortSignal | undefined,
  forceRefresh = false,
): Promise<{ credential?: string; subscriptionPresent?: boolean }> {
  const context = args.find((candidate) => (
    candidate
    && typeof candidate === "object"
    && "modelRegistry" in candidate
    && candidate.modelRegistry
    && typeof candidate.modelRegistry === "object"
  )) as ToolExecutionContext | undefined;
  const registry = context?.modelRegistry;
  if (registry === undefined) return {};

  const models = typeof registry.getAll === "function" ? [...registry.getAll()] : [];
  const current = context?.model;
  if (current !== undefined && !models.includes(current)) models.unshift(current);
  const xaiModel = models.find((model) => (
    model.provider === "xai"
    && typeof registry.isUsingOAuth === "function"
    && registry.isUsingOAuth(model)
  ));
  let subscriptionPresent = xaiModel !== undefined;
  if (xaiModel !== undefined && typeof registry.getProviderAuth === "function") {
    try {
      const resolved = await registry.getProviderAuth("xai");
      const credential = resolved?.auth?.apiKey;
      if (resolved?.source === "OAuth" && typeof credential === "string" && credential.trim() !== "") {
        return { credential, subscriptionPresent: true };
      }
    } catch {
      return { subscriptionPresent: true };
    }
  }

  subscriptionPresent = subscriptionPresent
    || registry.authStorage?.hasOAuth?.("xai") === true
    || registry.authStorage?.hasOAuth?.("xai-oauth") === true
    || Boolean(process.env.XAI_OAUTH_TOKEN);
  if (typeof registry.getApiKeyForProvider !== "function") return { subscriptionPresent };
  const primaryOrigin = registry.authStorage?.getCredentialOrigin?.("xai");
  if (xaiModel !== undefined && typeof registry.getProviderAuth !== "function" && primaryOrigin?.kind === "oauth") {
    try {
      const credential = await registry.getApiKeyForProvider("xai", undefined, {
        baseUrl: xaiModel.baseUrl,
        modelId: xaiModel.id,
        forceRefresh,
        signal,
      });
      if (typeof credential === "string" && credential.trim() !== "") {
        return { credential, subscriptionPresent: true };
      }
    } catch {
      return { subscriptionPresent };
    }
  }
  const origin = registry.authStorage?.getCredentialOrigin?.("xai-oauth");
  const verifiedOmpOAuth = origin?.kind === "oauth"
    || (origin?.kind === "env" && origin.envVar === "XAI_OAUTH_TOKEN");
  if (!verifiedOmpOAuth) return { subscriptionPresent };
  try {
    const credential = await registry.getApiKeyForProvider("xai-oauth", undefined, {
      forceRefresh,
      signal,
    });
    if (typeof credential === "string" && credential.trim() !== "") {
      return { credential, subscriptionPresent: true };
    }
  } catch {
    return { subscriptionPresent };
  }
  return { subscriptionPresent };
}

function appendModel(args: string[], model: string | undefined): void {
  if (model !== undefined) args.push("--model", requiredText(model, "model"));
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`);
  return value;
}

function xUrl(value: unknown): string {
  const text = requiredText(value, "url");
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("url must be an absolute X or Twitter URL");
  }
  const contentPath = parsed.pathname.includes("/status/") || parsed.pathname.startsWith("/i/article/");
  if (
    parsed.protocol !== "https:"
    || X_HOSTS[parsed.hostname.toLowerCase()] !== true
    || !contentPath
  ) {
    throw new Error("url must be an HTTPS X or Twitter post or Article URL");
  }
  return text;
}

function stringList(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${name} must contain only non-empty strings`);
  }
  return value;
}

function parseContentPayload(value: unknown, expected: "search" | "fetch"): GrokResult | GrokToolError {
  const record = objectValue(value, "response");
  if (record.kind === "error") return parseToolError(record);
  if (record.kind !== expected) throw new Error(`response kind must be ${expected}`);
  return expected === "search" ? parseSearchResult(record) : parseFetchResult(record);
}

function parseSearchResult(record: Record<string, unknown>): GrokSearchResult {
  return {
    kind: "search",
    model: stringValue(record.model, "model"),
    answer: stringValue(record.answer, "answer"),
    citations: citationsValue(record.citations),
    degraded: booleanValue(record.degraded, "degraded"),
    warnings: stringsValue(record.warnings, "warnings"),
  };
}

function parseFetchResult(record: Record<string, unknown>): GrokFetchResult {
  return {
    kind: "fetch",
    model: stringValue(record.model, "model"),
    citations: citationsValue(record.citations),
    degraded: booleanValue(record.degraded, "degraded"),
    warnings: stringsValue(record.warnings, "warnings"),
    retrieval: retrievalValue(record.retrieval),
  };
}

function parseAuthPayload(value: unknown): GrokAuthStatus | GrokDeviceAuthorization | GrokToolError {
  const record = objectValue(value, "response");
  if (record.kind === "error") return parseToolError(record);
  if (record.kind === "auth_status") {
    const source = record.source;
    if (source !== null && source !== "host-xai" && source !== "grok-cli" && source !== "plugin-oauth" && source !== "env") {
      throw new Error("auth status has an invalid source");
    }
    return {
      kind: "auth_status",
      authenticated: booleanValue(record.authenticated, "authenticated"),
      source,
      refreshable: booleanValue(record.refreshable, "refreshable"),
      state: stringValue(record.state, "state"),
    };
  }
  if (record.kind === "device_authorization") {
    return {
      kind: "device_authorization",
      session: stringValue(record.session, "session"),
      verificationUrl: stringValue(record.verificationUrl, "verificationUrl"),
      userCode: stringValue(record.userCode, "userCode"),
      expiresAt: stringValue(record.expiresAt, "expiresAt"),
    };
  }
  throw new Error("auth response has an invalid kind");
}

function parseToolError(record: Record<string, unknown>): GrokToolError {
  const source = record.source;
  if (source !== null && typeof source !== "string") throw new Error("error source must be a string or null");
  return {
    kind: "error",
    code: stringValue(record.code, "code"),
    message: stringValue(record.message, "message"),
    source,
  };
}

function retrievalValue(value: unknown): XRetrieval {
  const record = objectValue(value, "retrieval");
  const content = record.content;
  if (content !== "anchor" && content !== "authored") throw new Error("retrieval content is invalid");
  const contentKind = record.contentKind;
  if (contentKind !== "post" && contentKind !== "article" && contentKind !== "unknown") {
    throw new Error("retrieval contentKind is invalid");
  }
  const anchor = record.anchor === null ? null : itemValue(record.anchor, "anchor");
  return {
    requestedUrl: stringValue(record.requestedUrl, "requestedUrl"),
    content,
    available: booleanValue(record.available, "available"),
    contentKind,
    failureReason: stringValue(record.failureReason, "failureReason"),
    anchor,
    authoredContextAvailable: booleanValue(record.authoredContextAvailable, "authoredContextAvailable"),
    authoredContext: itemsValue(record.authoredContext, "authoredContext"),
    relatedContext: itemsValue(record.relatedContext, "relatedContext"),
    discussion: discussionValue(record.discussion),
  };
}

function itemValue(value: unknown, name: string): XItem {
  const record = objectValue(value, name);
  const relation = record.relation;
  if (relation !== "anchor" && relation !== "authored" && relation !== "parent" && relation !== "quote" && relation !== "reply" && relation !== "quote_reaction") {
    throw new Error(`${name} relation is invalid`);
  }
  const media = arrayValue(record.media, `${name}.media`).map((entry, index) => {
    const item = objectValue(entry, `${name}.media[${index}]`);
    return {
      type: stringValue(item.type, "media type"),
      url: stringValue(item.url, "media url"),
      description: stringValue(item.description, "media description"),
    };
  });
  return {
    relation,
    url: stringValue(record.url, `${name}.url`),
    authorHandle: stringValue(record.authorHandle, `${name}.authorHandle`),
    authorName: stringValue(record.authorName, `${name}.authorName`),
    timestamp: stringValue(record.timestamp, `${name}.timestamp`),
    text: stringValue(record.text, `${name}.text`),
    media,
    links: stringsValue(record.links, `${name}.links`),
  };
}

function discussionValue(value: unknown): XDiscussion {
  const record = objectValue(value, "discussion");
  const viewpoints = arrayValue(record.viewpoints, "discussion.viewpoints").map((entry, index) => {
    const item = objectValue(entry, `discussion.viewpoints[${index}]`);
    return {
      theme: stringValue(item.theme, "viewpoint theme"),
      summary: stringValue(item.summary, "viewpoint summary"),
      examples: itemsValue(item.examples, "viewpoint examples"),
    };
  });
  return {
    included: booleanValue(record.included, "discussion.included"),
    sampleNotice: stringValue(record.sampleNotice, "discussion.sampleNotice"),
    viewpoints,
  };
}

function citationsValue(value: unknown): GrokCitation[] {
  return arrayValue(value, "citations").map((entry, index) => {
    const record = objectValue(entry, `citations[${index}]`);
    return {
      url: stringValue(record.url, "citation url"),
      title: stringValue(record.title, "citation title"),
    };
  });
}

function itemsValue(value: unknown, name: string): XItem[] {
  return arrayValue(value, name).map((entry, index) => itemValue(entry, `${name}[${index}]`));
}

function stringsValue(value: unknown, name: string): string[] {
  return arrayValue(value, name).map((entry) => stringValue(entry, name));
}

function arrayValue(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function toolInput<T>(args: unknown[]): T {
  const candidates = args.length > 1 ? [args[1], args[0]] : [args[0]];
  const input = candidates.find((candidate) => candidate !== null && typeof candidate === "object" && !Array.isArray(candidate));
  if (!input) throw new Error("The host did not provide tool input");
  return input as T;
}

function toolSignal(args: unknown[]): AbortSignal | undefined {
  return args.find((candidate) => (
    candidate
    && typeof candidate === "object"
    && "aborted" in candidate
    && typeof candidate.aborted === "boolean"
    && "addEventListener" in candidate
    && typeof candidate.addEventListener === "function"
  )) as AbortSignal | undefined;
}

function textResult(value: GrokPayload): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function assertNoSecretFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretFields(item);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z]/g, "");
    if (normalized === "accesstoken" || normalized === "refreshtoken" || normalized === "devicecode" || normalized === "apikey") {
      throw new Error(`response contains forbidden secret field ${key}`);
    }
    assertNoSecretFields(child);
  }
}

function redactProcessDetail(value: string): string {
  return value
    .replace(/("(?:access_token|refresh_token|device_code|api_key)"\s*:\s*")[^"]*/gi, "$1[redacted]")
    .replace(/\bxai-[A-Za-z0-9_-]+\b/g, "[redacted]")
    .slice(0, 2000);
}

const SEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 1, description: "Natural-language question about live content on X." },
    response: { type: "string", enum: ["sources", "answer"], default: "sources", description: "sources returns recoverable X evidence for the calling agent; answer requests bounded Grok synthesis." },
    depth: { type: "string", enum: ["quick", "deep"], default: "quick", description: "quick is lightweight everyday context; deep maps representative viewpoints, disagreement, and corrections." },
    handles: { type: "array", maxItems: 10, items: { type: "string", minLength: 1 }, description: "Only X posts from these handles." },
    excludeHandles: { type: "array", maxItems: 10, items: { type: "string", minLength: 1 }, description: "Exclude these X handles." },
    from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Earliest X post date in YYYY-MM-DD." },
    to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Latest X post date in YYYY-MM-DD." },
    images: { type: "boolean", description: "Let Grok inspect images in X posts." },
    videos: { type: "boolean", description: "Let Grok inspect videos in X posts." },
    model: { type: "string", minLength: 1, description: "Optional xAI model override." },
  },
} as const;

const FETCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["url"],
  properties: {
    url: { type: "string", minLength: 1, description: "Specific X or Twitter post, thread, or X Article URL." },
    content: { type: "string", enum: ["anchor", "authored"], default: "anchor", description: "anchor returns the requested object and signals more authored context; authored returns the complete author-composed thread or X Article." },
    discussion: { type: "boolean", default: false, description: "Include a bounded representative view of replies and quote-post reactions." },
    model: { type: "string", minLength: 1, description: "Optional xAI model override." },
  },
} as const;

const AUTH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["status", "start_device", "complete_device"], description: "Inspect status, start an approved device login, or complete it after browser approval." },
    session: { type: "string", minLength: 1, description: "Non-secret session handle returned by start_device; required for complete_device." },
  },
} as const;
