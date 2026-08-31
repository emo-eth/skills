import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export type GrokCitation = {
  title: string;
  url: string;
};

export type GrokResult = {
  model: string;
  answer: string;
  citations: GrokCitation[];
  degraded: boolean;
};

export type GrokRunner = (
  args: string[],
  options: { signal?: AbortSignal },
) => Promise<GrokResult>;

export type RuntimeHost = {
  registerTool?: (definition: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute: (...args: unknown[]) => unknown;
  }) => void;
};

type SearchInput = {
  query: string;
  response?: "sources" | "answer";
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
  model?: string;
};


const SCRIPT_PATH = fileURLToPath(new URL("../scripts/grok-search.py", import.meta.url));
const PROCESS_TIMEOUT_MS = 195_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

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
    description: "Search X/Twitter posts, profiles, threads, reactions, and trends through xAI. This tool searches X only, never the web. Each call consumes Grok quota. The default sources response returns raw material for the calling model to synthesize.",
    parameters: SEARCH_SCHEMA,
    execute: async (...args: unknown[]) => {
      const input = toolInput<SearchInput>(args);
      return textResult(await runner(buildSearchArgs(input), { signal: toolSignal(args) }));
    },
  });

  host.registerTool({
    name: "grok_fetch",
    label: "Fetch X post",
    description: "Fetch one X post or thread by URL with verbatim text, author, timestamp, quoted posts, and media notes. Each call consumes Grok quota.",
    parameters: FETCH_SCHEMA,
    execute: async (...args: unknown[]) => {
      const input = toolInput<FetchInput>(args);
      return textResult(await runner(buildFetchArgs(input), { signal: toolSignal(args) }));
    },
  });

}

export async function runGrokCli(
  args: string[],
  options: {
    signal?: AbortSignal;
    pythonBinary?: string;
    scriptPath?: string;
  } = {},
): Promise<GrokResult> {
  const pythonBinary = options.pythonBinary ?? process.env.GROK_SEARCH_PYTHON ?? "python3";
  const scriptPath = options.scriptPath ?? SCRIPT_PATH;

  return await new Promise<GrokResult>((resolve, reject) => {
    execFile(
      pythonBinary,
      [scriptPath, ...args],
      {
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
        signal: options.signal,
        timeout: PROCESS_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        if (error) {
          if (options.signal?.aborted) {
            reject(new Error("Grok request cancelled"));
            return;
          }
          const detail = stderr.trim() || error.message;
          reject(new Error(`Grok request failed: ${detail}`));
          return;
        }

        try {
          resolve(parseResult(stdout));
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
  if (response !== "sources" && response !== "answer") {
    throw new Error("response must be sources or answer");
  }

  const handles = stringList(input.handles, "handles");
  const excludedHandles = stringList(input.excludeHandles, "excludeHandles");
  if (handles.length > 0 && excludedHandles.length > 0) {
    throw new Error("handles and excludeHandles cannot be combined");
  }

  const args = ["x", query, "--json"];
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
  const args = ["fetch", requiredText(input.url, "url"), "--json"];
  appendModel(args, input.model);
  return args;
}


function appendModel(args: string[], model: string | undefined): void {
  if (model !== undefined) args.push("--model", requiredText(model, "model"));
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`);
  return value;
}

function stringList(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${name} must contain only non-empty strings`);
  }
  return value;
}

function parseResult(stdout: string): GrokResult {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("response is not an object");
  if (!("model" in parsed) || typeof parsed.model !== "string") throw new Error("response has no model");
  if (!("answer" in parsed) || typeof parsed.answer !== "string") throw new Error("response has no answer");
  if (!("degraded" in parsed) || typeof parsed.degraded !== "boolean") throw new Error("response has no degraded flag");
  if (!("citations" in parsed) || !Array.isArray(parsed.citations)) throw new Error("response has no citations list");

  const citations = parsed.citations.map((citation: unknown) => {
    if (
      typeof citation !== "object"
      || citation === null
      || Array.isArray(citation)
      || !(("url" in citation) && ("title" in citation))
      || typeof citation.url !== "string"
      || typeof citation.title !== "string"
    ) {
      throw new Error("response contains an invalid citation");
    }
    return { url: citation.url, title: citation.title };
  });

  return {
    model: parsed.model,
    answer: parsed.answer,
    citations,
    degraded: parsed.degraded,
  };
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

function textResult(value: GrokResult): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

const SEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 1, description: "Natural-language question about content on X/Twitter." },
    response: { type: "string", enum: ["sources", "answer"], default: "sources", description: "sources returns raw X material for the calling model; answer asks Grok to synthesize from X." },
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
    url: { type: "string", minLength: 1, description: "X or Twitter post URL." },
    model: { type: "string", minLength: 1, description: "Optional xAI model override." },
  },
} as const;

