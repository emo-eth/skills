import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAuthArgs,
  buildFetchArgs,
  buildSearchArgs,
  installGrokTools,
  runGrokCli,
} from "../src/host.ts";
import type {
  GrokAuthStatus,
  GrokDeviceAuthorization,
  GrokFetchResult,
  GrokPayload,
  GrokRunner,
  GrokSearchResult,
  GrokToolError,
  RuntimeHost,
} from "../src/host.ts";
import grokSearchOmpExtension from "../src/omp.ts";
import grokSearchPiExtension from "../src/pi.ts";

type ToolApprovalDecision = "read" | "write" | "exec" | {
  tier: "read" | "write" | "exec";
  reason?: string;
  override?: boolean;
  policy?: "allow" | "deny" | "prompt";
};

type ToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  approval?: ToolApprovalDecision | ((input: unknown) => ToolApprovalDecision);
  execute: (...args: unknown[]) => unknown;
};

type RegistryCall = {
  provider: string;
  options?: { baseUrl?: string; modelId?: string; forceRefresh?: boolean; signal?: AbortSignal };
};

class Host implements RuntimeHost {
  readonly tools = new Map<string, ToolDefinition>();

  registerTool(definition: ToolDefinition): void {
    this.tools.set(definition.name, definition);
  }
}

const SEARCH_RESULT: GrokSearchResult = {
  kind: "search",
  model: "grok-4-fast",
  answer: "Two camps disagree about the rollout",
  citations: [{ title: "Post", url: "https://x.com/i/status/1" }],
  degraded: false,
  warnings: [],
};

const FETCH_RESULT: GrokFetchResult = {
  kind: "fetch",
  model: "grok-4-fast",
  citations: [
    { title: "Anchor post", url: "https://x.com/author/status/10" },
    { title: "Quoted post", url: "https://x.com/other/status/11" },
    { title: "Reply", url: "https://x.com/fan/status/12" },
  ],
  degraded: false,
  warnings: ["Discussion is a sampled view, not an exhaustive reply set."],
  retrieval: {
    requestedUrl: "https://x.com/author/status/10",
    content: "anchor",
    available: true,
    contentKind: "post",
    failureReason: "",
    anchor: {
      relation: "anchor",
      url: "https://x.com/author/status/10",
      authorHandle: "@author",
      authorName: "Author",
      timestamp: "2026-09-01T10:00:00Z",
      text: "Anchor text",
      media: [{ type: "photo", url: "https://pbs.twimg.com/media/1", description: "Chart" }],
      links: ["https://example.com/source"],
    },
    authoredContextAvailable: true,
    authoredContext: [],
    relatedContext: [
      {
        relation: "quote",
        url: "https://x.com/other/status/11",
        authorHandle: "@other",
        authorName: "Other",
        timestamp: "2026-09-01T11:00:00Z",
        text: "Quoted reaction",
        media: [],
        links: [],
      },
    ],
    discussion: {
      included: true,
      sampleNotice: "Representative sample of replies and quote reactions",
      viewpoints: [
        {
          theme: "Supportive",
          summary: "Readers agree with the claim",
          examples: [
            {
              relation: "reply",
              url: "https://x.com/fan/status/12",
              authorHandle: "@fan",
              authorName: "Fan",
              timestamp: "2026-09-01T12:00:00Z",
              text: "Agreed",
              media: [],
              links: [],
            },
          ],
        },
      ],
    },
  },
};

const AUTH_STATUS: GrokAuthStatus = {
  kind: "auth_status",
  authenticated: true,
  source: "plugin-oauth",
  refreshable: true,
  state: "ready",
};

const HOST_AUTH_STATUS: GrokAuthStatus = {
  kind: "auth_status",
  authenticated: true,
  source: "host-xai",
  refreshable: true,
  state: "delegated by the host",
};

const DEVICE_AUTHORIZATION: GrokDeviceAuthorization = {
  kind: "device_authorization",
  session: "session-1",
  verificationUrl: "https://auth.x.ai/device",
  userCode: "ABCD-1234",
  expiresAt: "2026-09-02T12:00:00Z",
};

const TOOL_ERROR: GrokToolError = {
  kind: "error",
  code: "auth_required",
  message: "Grok authorization is required",
  source: null,
};

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
};

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
};

const AUTH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["status", "start_device", "complete_device"], description: "Inspect status, start an approved device login, or complete it after browser approval." },
    session: { type: "string", minLength: 1, description: "Non-secret session handle returned by start_device; required for complete_device." },
  },
};

function payloadValue(value: unknown): GrokPayload {
  if (typeof value !== "object" || value === null || !("content" in value) || !Array.isArray(value.content)) {
    throw new Error("tool returned no content");
  }
  const item = value.content[0];
  if (typeof item !== "object" || item === null || !("text" in item) || typeof item.text !== "string") {
    throw new Error("tool returned no text");
  }
  return JSON.parse(item.text) as GrokPayload;
}

for (const [name, adapter] of [
  ["Pi", grokSearchPiExtension],
  ["OMP", grokSearchOmpExtension],
] as const) {
  test(`${name} registers exactly the search, fetch, and auth tools with exact schemas`, () => {
    const host = new Host();
    adapter(host);
    assert.deepEqual([...host.tools.keys()], ["grok_search", "grok_fetch", "grok_auth"]);

    const search = host.tools.get("grok_search");
    const fetch = host.tools.get("grok_fetch");
    const auth = host.tools.get("grok_auth");
    for (const tool of [search, fetch, auth]) {
      assert.ok(tool);
      assert.ok(tool.label.length > 0);
      assert.ok(tool.description.length > 0);
    }
    assert.deepEqual(search?.parameters, SEARCH_SCHEMA);
    assert.deepEqual(fetch?.parameters, FETCH_SCHEMA);
    assert.deepEqual(auth?.parameters, AUTH_SCHEMA);
  });
}

test("host adapters apply the correct approval boundary", () => {
  const pi = new Host();
  const omp = new Host();
  grokSearchPiExtension(pi);
  grokSearchOmpExtension(omp);

  assert.equal(pi.tools.get("grok_search")?.approval, undefined);
  assert.equal(pi.tools.get("grok_fetch")?.approval, undefined);
  assert.equal(pi.tools.get("grok_auth")?.approval, undefined);
  assert.equal(omp.tools.get("grok_search")?.approval, "read");
  assert.equal(omp.tools.get("grok_fetch")?.approval, "read");
  const approval = omp.tools.get("grok_auth")?.approval;
  assert.equal(typeof approval, "function");
  if (typeof approval !== "function") throw new Error("OMP grok_auth approval is not dynamic");
  assert.equal(approval({ action: "status" }), "read");
  assert.deepEqual(approval({ action: "start_device" }), {
    tier: "write",
    reason: "Start Grok device authorization",
    override: true,
    policy: "prompt",
  });
  assert.equal(approval({ action: "complete_device" }), "write");
});

test("installGrokTools requires the native registerTool seam", () => {
  assert.throws(() => installGrokTools({}), /native registerTool seam/);
});

test("grok_search defaults to quick depth and sources mode and forwards filters and cancellation", async () => {
  const calls: Array<{ args: string[]; signal?: AbortSignal; hostCredential?: string }> = [];
  const runner: GrokRunner = async (args, options) => {
    calls.push({ args, signal: options.signal, hostCredential: options.hostCredential });
    return SEARCH_RESULT;
  };
  const host = new Host();
  installGrokTools(host, { runner });
  const controller = new AbortController();

  const value = await host.tools.get("grok_search")?.execute("call-1", {
    query: "Recent posts",
    handles: ["@one", "@two"],
    from: "2026-08-01",
    images: true,
    model: "grok-test",
  }, controller.signal);

  assert.deepEqual(calls, [{
    args: [
      "x",
      "Recent posts",
      "--json",
      "--depth",
      "quick",
      "--brief",
      "--handle",
      "@one",
      "--handle",
      "@two",
      "--from",
      "2026-08-01",
      "--images",
      "--model",
      "grok-test",
    ],
    signal: controller.signal,
    hostCredential: undefined,
  }]);
  assert.deepEqual(payloadValue(value), SEARCH_RESULT);
});

test("grok_search deep answer mode forwards deep depth and drops the brief flag", async () => {
  const calls: string[][] = [];
  const runner: GrokRunner = async (args) => {
    calls.push(args);
    return SEARCH_RESULT;
  };
  const host = new Host();
  installGrokTools(host, { runner });

  await host.tools.get("grok_search")?.execute("call-1", {
    query: "Reactions to the announcement",
    response: "answer",
    depth: "deep",
    excludeHandles: ["@noise"],
    to: "2026-09-01",
    videos: true,
  });

  assert.deepEqual(calls, [[
    "x",
    "Reactions to the announcement",
    "--json",
    "--depth",
    "deep",
    "--exclude-handle",
    "@noise",
    "--to",
    "2026-09-01",
    "--videos",
  ]]);
});

test("search argument construction rejects invalid combinations", () => {
  assert.throws(
    () => buildSearchArgs({ query: "Bad", handles: ["@one"], excludeHandles: ["@two"] }),
    /cannot be combined/,
  );
  assert.throws(() => buildSearchArgs({ query: "Bad", depth: "nope" as never }), /depth must be quick or deep/);
  assert.throws(
    () => buildSearchArgs({ query: "Bad", response: "nope" as never }),
    /response must be sources or answer/,
  );
  assert.throws(() => buildSearchArgs({ query: "  " }), /query must be a non-empty string/);
});

test("grok_fetch defaults to anchor content and forwards authored and discussion options", async () => {
  const calls: string[][] = [];
  const runner: GrokRunner = async (args) => {
    calls.push(args);
    return FETCH_RESULT;
  };
  const host = new Host();
  installGrokTools(host, { runner });

  const anchor = await host.tools.get("grok_fetch")?.execute("call-1", {
    url: "https://x.com/author/status/10",
  });
  assert.deepEqual(calls, [["fetch", "https://x.com/author/status/10", "--json", "--content", "anchor"]]);
  assert.deepEqual(payloadValue(anchor), FETCH_RESULT);

  calls.length = 0;
  const authored = await host.tools.get("grok_fetch")?.execute("call-2", {
    url: "https://x.com/author/status/10",
    content: "authored",
    discussion: true,
    model: "grok-test",
  });
  assert.deepEqual(calls, [[
    "fetch",
    "https://x.com/author/status/10",
    "--json",
    "--content",
    "authored",
    "--discussion",
    "--model",
    "grok-test",
  ]]);
  assert.deepEqual(payloadValue(authored), FETCH_RESULT);
});

test("fetch argument construction accepts only HTTPS X or Twitter content URLs", () => {
  for (const url of [
    "https://x.com/user/status/123",
    "https://www.x.com/user/status/123",
    "https://twitter.com/user/status/123",
    "https://www.twitter.com/user/status/123",
    "https://mobile.twitter.com/user/status/123",
    "https://X.COM/user/status/123",
    "https://x.com/i/status/123",
    "https://x.com/i/article/123",
  ]) {
    assert.deepEqual(buildFetchArgs({ url }), ["fetch", url, "--json", "--content", "anchor"]);
  }

  for (const url of [
    "http://x.com/user/status/123",
    "https://example.com/user/status/123",
    "https://x.com/",
    "https://x.com",
    "x.com/user/status/123",
    "not a url",
    "https://x.com/user",
  ]) {
    assert.throws(() => buildFetchArgs({ url }), /X or Twitter/);
  }
  assert.throws(() => buildFetchArgs({ url: "" }), /url must be a non-empty string/);
  assert.throws(
    () => buildFetchArgs({ url: "https://x.com/user/status/123", content: "nope" as never }),
    /content must be anchor or authored/,
  );
});

test("grok_auth maps staged actions to CLI arguments", () => {
  assert.deepEqual(buildAuthArgs({ action: "status" }), ["auth", "--json"]);
  assert.deepEqual(buildAuthArgs({ action: "start_device" }), ["login", "--device", "--start", "--json"]);
  assert.deepEqual(buildAuthArgs({ action: "complete_device", session: "session-1" }), [
    "login",
    "--device",
    "--complete",
    "session-1",
    "--json",
  ]);
  assert.throws(() => buildAuthArgs({ action: "complete_device" }), /session must be a non-empty string/);
  assert.throws(
    () => buildAuthArgs({ action: "rotate" as never }),
    /action must be status, start_device, or complete_device/,
  );
});

test("grok_auth parses status and device payloads and passes tool errors through", async () => {
  const payloads: unknown[] = [AUTH_STATUS, HOST_AUTH_STATUS, DEVICE_AUTHORIZATION, TOOL_ERROR];
  const runner: GrokRunner = async () => payloads.shift();
  const host = new Host();
  installGrokTools(host, { runner });
  const auth = host.tools.get("grok_auth");

  assert.deepEqual(payloadValue(await auth?.execute("call-1", { action: "status" })), AUTH_STATUS);
  assert.deepEqual(payloadValue(await auth?.execute("call-2", { action: "status" })), HOST_AUTH_STATUS);
  assert.deepEqual(
    payloadValue(await auth?.execute("call-3", { action: "complete_device", session: "session-1" })),
    DEVICE_AUTHORIZATION,
  );
  assert.deepEqual(payloadValue(await auth?.execute("call-4", { action: "status" })), TOOL_ERROR);

  const invalidSource: GrokRunner = async () => ({ ...AUTH_STATUS, source: "unknown" });
  const failing = new Host();
  installGrokTools(failing, { runner: invalidSource });
  await assert.rejects(
    failing.tools.get("grok_auth")?.execute("call-5", { action: "status" }),
    /invalid source/,
  );
});

test("Pi-style device authorization requires host confirmation", async () => {
  let calls = 0;
  const runner: GrokRunner = async () => {
    calls += 1;
    return DEVICE_AUTHORIZATION;
  };
  const host = new Host();
  installGrokTools(host, { runner });
  const auth = host.tools.get("grok_auth");

  assert.deepEqual(payloadValue(await auth?.execute("missing-ui", { action: "start_device" })), {
    kind: "error",
    code: "authorization_cancelled",
    message: "Grok device authorization requires explicit human approval.",
    source: null,
  });
  assert.deepEqual(
    payloadValue(await auth?.execute(
      "denied",
      { action: "start_device" },
      undefined,
      undefined,
      { ui: { confirm: async () => false } },
    )),
    {
      kind: "error",
      code: "authorization_cancelled",
      message: "Grok device authorization requires explicit human approval.",
      source: null,
    },
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    payloadValue(await auth?.execute(
      "approved",
      { action: "start_device" },
      undefined,
      undefined,
      { ui: { confirm: async () => true } },
    )),
    DEVICE_AUTHORIZATION,
  );
  assert.equal(calls, 1);
});

test("content tools parse structured payloads and pass tool errors through unthrown", async () => {
  const payloads: unknown[] = [SEARCH_RESULT, FETCH_RESULT, TOOL_ERROR, { ...SEARCH_RESULT, kind: "fetch" }];
  const runner: GrokRunner = async () => payloads.shift();
  const host = new Host();
  installGrokTools(host, { runner });

  assert.deepEqual(
    payloadValue(await host.tools.get("grok_search")?.execute("call-1", { query: "Q" })),
    SEARCH_RESULT,
  );
  assert.deepEqual(
    payloadValue(await host.tools.get("grok_fetch")?.execute("call-2", { url: "https://x.com/author/status/10" })),
    FETCH_RESULT,
  );
  assert.deepEqual(
    payloadValue(await host.tools.get("grok_search")?.execute("call-3", { query: "Q" })),
    TOOL_ERROR,
  );
  await assert.rejects(
    host.tools.get("grok_search")?.execute("call-4", { query: "Q" }),
    /response kind must be search/,
  );
});

test("fetch payloads reject contradictory or unsupported expansion provenance", async () => {
  const wrongUnavailable = structuredClone(FETCH_RESULT);
  wrongUnavailable.citations = [];
  wrongUnavailable.degraded = true;
  wrongUnavailable.retrieval = {
    requestedUrl: "https://x.com/other/status/99",
    content: "anchor",
    available: false,
    contentKind: "unknown",
    failureReason: "Unavailable",
    anchor: null,
    authoredContextAvailable: false,
    authoredContext: [],
    relatedContext: [],
    discussion: { included: false, sampleNotice: "", viewpoints: [] },
  };
  const wrongAnchor = structuredClone(FETCH_RESULT);
  wrongAnchor.retrieval.requestedUrl = "https://x.com/other/status/99";
  wrongAnchor.retrieval.anchor!.url = "https://x.com/other/status/99";
  wrongAnchor.citations = [{ title: "Wrong anchor", url: "https://x.com/other/status/99" }];
  const misclassified = structuredClone(FETCH_RESULT);
  misclassified.retrieval.authoredContext = [{
    ...misclassified.retrieval.anchor!,
    relation: "reply",
    url: "https://x.com/other/status/13",
    authorHandle: "@other",
  }];
  misclassified.citations.push({ title: "Other reply", url: "https://x.com/other/status/13" });
  const uncited = structuredClone(FETCH_RESULT);
  uncited.citations = [uncited.citations[0]!];
  const selfDiscussion = structuredClone(FETCH_RESULT);
  selfDiscussion.retrieval.discussion.viewpoints[0]!.examples[0]!.authorHandle = "@author";
  const repeatedAnchor = structuredClone(FETCH_RESULT);
  repeatedAnchor.retrieval.relatedContext[0]!.url = repeatedAnchor.retrieval.anchor!.url;
  const emptyAuthor = structuredClone(FETCH_RESULT);
  emptyAuthor.retrieval.content = "authored";
  emptyAuthor.retrieval.authoredContext = [{
    ...emptyAuthor.retrieval.anchor!,
    relation: "authored",
    url: "https://x.com/author/status/13",
    authorHandle: " ",
  }];
  emptyAuthor.citations.push({ title: "Continuation", url: "https://x.com/author/status/13" });
  const unbounded = structuredClone(FETCH_RESULT);
  unbounded.retrieval.discussion.sampleNotice = " ";
  const payloads = [wrongUnavailable, wrongAnchor, misclassified, uncited, selfDiscussion, repeatedAnchor, emptyAuthor, unbounded];
  const runner: GrokRunner = async () => payloads.shift();
  const host = new Host();
  installGrokTools(host, { runner });
  const fetch = host.tools.get("grok_fetch");

  await assert.rejects(
    fetch?.execute("wrong-unavailable", { url: "https://x.com/author/status/10" }),
    /requested X object/,
  );
  await assert.rejects(
    fetch?.execute("wrong-anchor", { url: "https://x.com/author/status/10" }),
    /requested X object/,
  );
  await assert.rejects(
    fetch?.execute("misclassified", { url: "https://x.com/author/status/10" }),
    /authoredContext/,
  );
  await assert.rejects(
    fetch?.execute("uncited", { url: "https://x.com/author/status/10" }),
    /not cited/,
  );
  await assert.rejects(
    fetch?.execute("self-discussion", { url: "https://x.com/author/status/10" }),
    /discussion.*anchor author/,
  );
  await assert.rejects(
    fetch?.execute("repeated-anchor", { url: "https://x.com/author/status/10" }),
    /relatedContext.*anchor/,
  );
  await assert.rejects(
    fetch?.execute("empty-author", { url: "https://x.com/author/status/10" }),
    /authoredContext.*author/,
  );
  await assert.rejects(
    fetch?.execute("unbounded", { url: "https://x.com/author/status/10" }),
    /sample notice/,
  );
});

test("content tools reject payloads missing required fields", async () => {
  const incomplete = { kind: "search", model: "grok-4-fast", answer: "x", citations: [], degraded: false };
  const runner: GrokRunner = async () => incomplete;
  const host = new Host();
  installGrokTools(host, { runner });
  await assert.rejects(
    host.tools.get("grok_search")?.execute("call-1", { query: "Q" }),
    /warnings must be an array/,
  );
});

test("content tools delegate only typed Pi xAI OAuth from the execution context", async () => {
  const runnerCalls: Array<{ hostCredential?: string }> = [];
  const runner: GrokRunner = async (args, options) => {
    runnerCalls.push({ hostCredential: options.hostCredential });
    if (args[0] === "auth") return AUTH_STATUS;
    if (args.includes("--start")) return DEVICE_AUTHORIZATION;
    return SEARCH_RESULT;
  };
  const model = { provider: "xai", id: "grok-4-fast", baseUrl: "https://api.x.ai/v1" };
  const registryCalls: string[] = [];
  const context = {
    model,
    modelRegistry: {
      getAll: () => [model],
      isUsingOAuth: (candidate: { provider: string }) => candidate.provider === "xai",
      getProviderAuth: async (provider: string) => {
        registryCalls.push(provider);
        return { auth: { apiKey: "host-oauth-token" }, source: "OAuth" };
      },
    },
    ui: { confirm: async () => true },
  };
  const host = new Host();
  installGrokTools(host, { runner });
  await host.tools.get("grok_search")?.execute("call-1", { query: "Q" }, undefined, context);
  assert.deepEqual(runnerCalls, [{ hostCredential: "host-oauth-token" }]);
  assert.deepEqual(registryCalls, ["xai"]);

  registryCalls.length = 0;
  runnerCalls.length = 0;
  await host.tools.get("grok_auth")?.execute("call-2", { action: "status" }, undefined, context);
  assert.deepEqual(runnerCalls, [{ hostCredential: "host-oauth-token" }]);
  assert.deepEqual(registryCalls, ["xai"]);

  registryCalls.length = 0;
  runnerCalls.length = 0;
  await host.tools.get("grok_auth")?.execute("call-3", { action: "start_device" }, undefined, context);
  assert.deepEqual(runnerCalls, [{ hostCredential: undefined }]);
  assert.deepEqual(registryCalls, []);
});

test("host API-key precedence cannot bypass a known Pi subscription", async () => {
  const model = { provider: "xai", id: "grok-4-fast" };
  const runnerCalls: Array<{ hostCredential?: string; blockApiKey?: boolean }> = [];
  const runner: GrokRunner = async (_args, options) => {
    runnerCalls.push({ hostCredential: options.hostCredential, blockApiKey: options.blockApiKey });
    return SEARCH_RESULT;
  };
  const context = {
    model,
    modelRegistry: {
      getAll: () => [model],
      isUsingOAuth: () => true,
      getProviderAuth: async () => ({
        auth: { apiKey: "billed-api-key" },
        source: "XAI_API_KEY",
      }),
    },
  };
  const host = new Host();
  installGrokTools(host, { runner });
  await host.tools.get("grok_search")?.execute("call-1", { query: "Q" }, undefined, context);
  assert.deepEqual(runnerCalls, [{ hostCredential: undefined, blockApiKey: true }]);
});

test("OMP delegates primary xai credentials only when their origin is OAuth", async () => {
  const model = { provider: "xai", id: "grok-4-fast", baseUrl: "https://api.x.ai/v1" };
  const runnerCalls: Array<{ hostCredential?: string }> = [];
  const registryCalls: RegistryCall[] = [];
  const runner: GrokRunner = async (_args, options) => {
    runnerCalls.push({ hostCredential: options.hostCredential });
    return SEARCH_RESULT;
  };
  const context = {
    model,
    modelRegistry: {
      getAll: () => [model],
      isUsingOAuth: () => true,
      authStorage: {
        getCredentialOrigin: (provider: string) => provider === "xai" ? { kind: "oauth" } : undefined,
        hasOAuth: (provider: string) => provider === "xai",
      },
      getApiKeyForProvider: async (
        provider: string,
        _sessionId?: string,
        options?: { baseUrl?: string; modelId?: string; forceRefresh?: boolean; signal?: AbortSignal },
      ) => {
        registryCalls.push({ provider, options });
        return "omp-primary-oauth";
      },
    },
  };
  const host = new Host();
  installGrokTools(host, { runner });
  await host.tools.get("grok_search")?.execute("call-1", { query: "Q" }, undefined, context);
  assert.deepEqual(runnerCalls, [{ hostCredential: "omp-primary-oauth" }]);
  assert.deepEqual(registryCalls, [{
    provider: "xai",
    options: {
      baseUrl: "https://api.x.ai/v1",
      modelId: "grok-4-fast",
      forceRefresh: false,
      signal: undefined,
    },
  }]);
});

test("OMP delegation requires credential origin proven as OAuth", async () => {
  let origin = "oauth";
  const providerCalls: string[] = [];
  const runnerCalls: Array<{ hostCredential?: string; blockApiKey?: boolean }> = [];
  const runner: GrokRunner = async (_args, options) => {
    runnerCalls.push({ hostCredential: options.hostCredential, blockApiKey: options.blockApiKey });
    return SEARCH_RESULT;
  };
  const context = {
    modelRegistry: {
      getAll: () => [],
      authStorage: {
        getCredentialOrigin: () => ({ kind: origin }),
        hasOAuth: () => true,
      },
      getApiKeyForProvider: async (provider: string) => {
        providerCalls.push(provider);
        return "dedicated-oauth-token";
      },
    },
  };
  const host = new Host();
  installGrokTools(host, { runner });
  await host.tools.get("grok_search")?.execute("call-1", { query: "Q" }, undefined, context);
  origin = "api_key";
  await host.tools.get("grok_search")?.execute("call-2", { query: "Q" }, undefined, context);
  assert.deepEqual(providerCalls, ["xai-oauth"]);
  assert.deepEqual(runnerCalls, [
    { hostCredential: "dedicated-oauth-token", blockApiKey: undefined },
    { hostCredential: undefined, blockApiKey: true },
  ]);
});

test("content tools without an execution context run without a host credential", async () => {
  const runnerCalls: Array<{ hostCredential?: string }> = [];
  const runner: GrokRunner = async (args, options) => {
    runnerCalls.push({ hostCredential: options.hostCredential });
    if (args[0] === "fetch") return FETCH_RESULT;
    if (args[0] === "auth") return AUTH_STATUS;
    return SEARCH_RESULT;
  };
  const host = new Host();
  installGrokTools(host, { runner });

  await host.tools.get("grok_search")?.execute("call-1", { query: "Q" });
  await host.tools.get("grok_fetch")?.execute("call-2", { url: "https://x.com/author/status/10" });
  await host.tools.get("grok_auth")?.execute("call-3", { action: "status" });
  assert.deepEqual(runnerCalls, [
    { hostCredential: undefined },
    { hostCredential: undefined },
    { hostCredential: undefined },
  ]);
});

test("content tools retry only after host OAuth rotates", async () => {
  const runnerPayloads: unknown[] = [
    { kind: "error", code: "auth_expired", message: "Host token expired", source: "host-xai" },
    SEARCH_RESULT,
  ];
  const runnerCalls: Array<{ hostCredential?: string; blockApiKey?: boolean }> = [];
  const runner: GrokRunner = async (_args, options) => {
    runnerCalls.push({ hostCredential: options.hostCredential, blockApiKey: options.blockApiKey });
    return runnerPayloads.shift();
  };
  const registryCalls: RegistryCall[] = [];
  let refresh = 0;
  const context = {
    modelRegistry: {
      getAll: () => [],
      authStorage: {
        getCredentialOrigin: () => ({ kind: "oauth" }),
      },
      getApiKeyForProvider: async (
        provider: string,
        _sessionId?: string,
        options?: { forceRefresh?: boolean },
      ) => {
        registryCalls.push({ provider, options });
        refresh += 1;
        return refresh === 1 ? "stale-token" : "fresh-token";
      },
    },
  };

  const host = new Host();
  installGrokTools(host, { runner });
  const value = await host.tools.get("grok_search")?.execute("call-1", { query: "Q" }, undefined, context);

  assert.deepEqual(runnerCalls, [
    { hostCredential: "stale-token", blockApiKey: undefined },
    { hostCredential: "fresh-token", blockApiKey: undefined },
  ]);
  assert.deepEqual(registryCalls, [
    { provider: "xai-oauth", options: { forceRefresh: false, signal: undefined } },
    { provider: "xai-oauth", options: { forceRefresh: true, signal: undefined } },
  ]);
  assert.deepEqual(payloadValue(value), SEARCH_RESULT);
});

test("unchanged failed host OAuth falls through with billed API access blocked", async () => {
  const runnerPayloads: unknown[] = [
    { kind: "error", code: "auth_expired", message: "Host token expired", source: "host-xai" },
    SEARCH_RESULT,
  ];
  const runnerCalls: Array<{ hostCredential?: string; blockApiKey?: boolean }> = [];
  const runner: GrokRunner = async (_args, options) => {
    runnerCalls.push({ hostCredential: options.hostCredential, blockApiKey: options.blockApiKey });
    return runnerPayloads.shift();
  };
  const context = {
    modelRegistry: {
      getAll: () => [],
      authStorage: {
        getCredentialOrigin: () => ({ kind: "oauth" }),
      },
      getApiKeyForProvider: async () => "unchanged-token",
    },
  };
  const host = new Host();
  installGrokTools(host, { runner });
  const value = await host.tools.get("grok_search")?.execute("call-1", { query: "Q" }, undefined, context);
  assert.deepEqual(runnerCalls, [
    { hostCredential: "unchanged-token", blockApiKey: undefined },
    { hostCredential: undefined, blockApiKey: true },
  ]);
  assert.deepEqual(payloadValue(value), SEARCH_RESULT);
});

test("auth_expired from non-host sources passes through without a retry", async () => {
  let calls = 0;
  const runner: GrokRunner = async () => {
    calls += 1;
    return { kind: "error", code: "auth_expired", message: "Expired", source: "env" };
  };
  const host = new Host();
  installGrokTools(host, { runner });

  const value = await host.tools.get("grok_search")?.execute("call-1", { query: "Q" });
  assert.equal(calls, 1);
  assert.deepEqual(payloadValue(value), {
    kind: "error",
    code: "auth_expired",
    message: "Expired",
    source: "env",
  });
});

test("runGrokCli parses structured output and rejects malformed output", async () => {
  const root = mkdtempSync(join(tmpdir(), "grok-tool-runner-"));
  const valid = join(root, "valid.py");
  const invalid = join(root, "invalid.py");
  writeFileSync(valid, `#!/usr/bin/env python3\nprint(${JSON.stringify(JSON.stringify(SEARCH_RESULT))})\n`);
  writeFileSync(invalid, "#!/usr/bin/env python3\nprint('not json')\n");
  chmodSync(valid, 0o755);
  chmodSync(invalid, 0o755);

  try {
    assert.deepEqual(await runGrokCli([], { scriptPath: valid }), SEARCH_RESULT);
    await assert.rejects(runGrokCli([], { scriptPath: invalid }), /invalid result/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runGrokCli controls internal credential environment fields", async () => {
  const root = mkdtempSync(join(tmpdir(), "grok-tool-env-"));
  const env = join(root, "env.py");
  writeFileSync(
    env,
    "#!/usr/bin/env python3\nimport json, os\nprint(json.dumps({'host_token': os.environ.get('GROK_SEARCH_HOST_OAUTH_TOKEN'), 'block_api': os.environ.get('GROK_SEARCH_BLOCK_API_KEY')}))\n",
  );
  chmodSync(env, 0o755);
  const previousHost = process.env.GROK_SEARCH_HOST_OAUTH_TOKEN;
  const previousBlock = process.env.GROK_SEARCH_BLOCK_API_KEY;
  process.env.GROK_SEARCH_HOST_OAUTH_TOKEN = "ambient-host-secret";
  process.env.GROK_SEARCH_BLOCK_API_KEY = "ambient-block";

  try {
    assert.deepEqual(await runGrokCli([], { scriptPath: env, hostCredential: "host-secret" }), {
      host_token: "host-secret",
      block_api: null,
    });
    assert.deepEqual(await runGrokCli([], { scriptPath: env, blockApiKey: true }), {
      host_token: null,
      block_api: "1",
    });
  } finally {
    if (previousHost === undefined) delete process.env.GROK_SEARCH_HOST_OAUTH_TOKEN;
    else process.env.GROK_SEARCH_HOST_OAUTH_TOKEN = previousHost;
    if (previousBlock === undefined) delete process.env.GROK_SEARCH_BLOCK_API_KEY;
    else process.env.GROK_SEARCH_BLOCK_API_KEY = previousBlock;
    rmSync(root, { recursive: true, force: true });
  }
});

test("runGrokCli rejects output containing secret fields", async () => {
  const root = mkdtempSync(join(tmpdir(), "grok-tool-secrets-"));
  const leaky = join(root, "leaky.py");
  const payload = JSON.stringify({
    kind: "auth_status",
    authenticated: true,
    details: { access_token: "a", refresh_token: "b", device_code: "c", apiKey: "d" },
  });
  writeFileSync(leaky, `#!/usr/bin/env python3\nprint(${JSON.stringify(payload)})\n`);
  chmodSync(leaky, 0o755);

  try {
    await assert.rejects(runGrokCli([], { scriptPath: leaky }), /forbidden secret field/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runGrokCli redacts credential shapes from failure details", async () => {
  const root = mkdtempSync(join(tmpdir(), "grok-tool-redact-"));
  const failing = join(root, "failing.py");
  writeFileSync(
    failing,
    "#!/usr/bin/env python3\nimport sys\nprint('boom xai-SUPERSECRET', file=sys.stderr)\nsys.exit(1)\n",
  );
  chmodSync(failing, 0o755);

  try {
    await assert.rejects(runGrokCli([], { scriptPath: failing }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Grok request failed/);
      assert.match(error.message, /\[redacted\]/);
      assert.ok(!error.message.includes("xai-SUPERSECRET"));
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runGrokCli passes arguments verbatim without shell interpolation", async () => {
  const root = mkdtempSync(join(tmpdir(), "grok-tool-argv-"));
  const echo = join(root, "echo.py");
  writeFileSync(echo, "#!/usr/bin/env python3\nimport json, sys\nprint(json.dumps(sys.argv[1:]))\n");
  chmodSync(echo, 0o755);
  const args = [
    "x",
    "what && who | grep $HOME; rm -rf \"~\" 'x y'",
    "--handle",
    "@a b",
    "--from",
    "2026-08-01",
  ];

  try {
    assert.deepEqual(await runGrokCli(args, { scriptPath: echo }), args);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runGrokCli terminates the child process when the host cancels", async () => {
  const root = mkdtempSync(join(tmpdir(), "grok-tool-cancel-"));
  const slow = join(root, "slow.py");
  writeFileSync(slow, "#!/usr/bin/env python3\nimport time\ntime.sleep(10)\n");
  chmodSync(slow, 0o755);
  const controller = new AbortController();
  const pending = runGrokCli([], { scriptPath: slow, signal: controller.signal });
  controller.abort();

  try {
    await assert.rejects(pending, /cancelled/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
