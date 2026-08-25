import { stripCodeComments } from "./strip.ts";

type Host = {
  on(event: string, handler: (event: any, context: any) => unknown): void;
  registerCommand?: (name: string, options: { description: string; handler: (args: string, context: any) => unknown }) => void;
};

type Rewrite = {
  input?: Record<string, unknown>;
  block?: boolean;
  reason?: string;
  removed: number;
};

export const NO_CODE_COMMENTS_PROMPT = "No-code-comments is active. Write self-explanatory code without prose comments. Semantic directives, shebangs, compiler annotations, and source-map directives are allowed. The host strips comments from write and replacement payloads before execution.";

export function installNoCodeComments(host: unknown): void {
  const runtime = requireHost(host);
  runtime.on("before_agent_start", async (event: any) => {
    const systemPrompt = Array.isArray(event?.systemPrompt) ? event.systemPrompt : [];
    return { systemPrompt: [...systemPrompt, NO_CODE_COMMENTS_PROMPT] };
  });
  runtime.on("tool_call", async (event: any) => {
    const rewrite = rewriteToolCall(event);
    if (rewrite.block) return { block: true, reason: rewrite.reason };
    if (rewrite.input) return { input: rewrite.input };
    return undefined;
  });
  runtime.registerCommand?.("no-code-comments", {
    description: "Show the deterministic no-code-comments policy",
    handler: (_args, context) => {
      context?.ui?.notify?.(NO_CODE_COMMENTS_PROMPT, "info");
    },
  });
}

export function rewriteToolCall(event: any): Rewrite {
  const input = isRecord(event?.input) ? event.input : undefined;
  if (!input) return { removed: 0 };
  if (event.toolName === "write") return rewriteWrite(input);
  if (event.toolName === "edit") return rewriteEdit(input);
  if (event.toolName === "ast_edit") return rewriteAstEdit(input);
  return { removed: 0 };
}

function rewriteWrite(input: Record<string, unknown>): Rewrite {
  if (typeof input.path !== "string" || typeof input.content !== "string") return { removed: 0 };
  const result = stripCodeComments(input.content, input.path);
  if (!result.supported && hasLikelyComment(input.content)) return unsupported(input.path);
  if (result.content === input.content) return { removed: 0 };
  return { input: { ...input, content: result.content }, removed: result.removed };
}

function rewriteEdit(input: Record<string, unknown>): Rewrite {
  if (typeof input.path === "string" && typeof input.new_string === "string") {
    const result = stripCodeComments(input.new_string, input.path);
    if (!result.supported && hasLikelyComment(input.new_string)) return unsupported(input.path);
    if (result.content === input.new_string) return { removed: 0 };
    return { input: { ...input, new_string: result.content }, removed: result.removed };
  }
  if (typeof input.path === "string" && Array.isArray(input.edits)) {
    const path = input.path;
    let removed = 0;
    let blocked: Rewrite | undefined;
    const edits = input.edits.map(edit => {
      if (!isRecord(edit) || typeof edit.diff !== "string") return edit;
      const result = stripMarkedAdditions(edit.diff, path);
      if (result.block) blocked = result;
      removed += result.removed;
      return result.input ? { ...edit, diff: result.input.input } : edit;
    });
    if (blocked) return blocked;
    return removed > 0 ? { input: { ...input, edits }, removed } : { removed: 0 };
  }
  if (typeof input.input === "string") {
    const result = stripPatchInput(input.input);
    if (result.block) return result;
    return result.input ? { input: { ...input, input: result.input.input }, removed: result.removed } : result;
  }
  return { removed: 0 };
}

function rewriteAstEdit(input: Record<string, unknown>): Rewrite {
  if (!Array.isArray(input.ops) || !Array.isArray(input.paths)) return { removed: 0 };
  const paths = input.paths.filter((value): value is string => typeof value === "string");
  if (paths.length === 0) return { removed: 0 };
  const samplePath = paths[0]!.replaceAll("*", "x");
  let removed = 0;
  let blocked: Rewrite | undefined;
  const ops = input.ops.map(op => {
    if (!isRecord(op) || typeof op.out !== "string") return op;
    const result = stripCodeComments(op.out, samplePath);
    if (!result.supported && hasLikelyComment(op.out)) blocked = unsupported(paths.join(", "));
    removed += result.removed;
    return result.content === op.out ? op : { ...op, out: result.content };
  });
  if (blocked) return blocked;
  return removed > 0 ? { input: { ...input, ops }, removed } : { removed: 0 };
}

function stripPatchInput(value: string): Rewrite {
  const lines = value.split("\n");
  let currentPath: string | undefined;
  let removed = 0;
  let index = 0;
  while (index < lines.length) {
    const header = lines[index]!.match(/^\[([^#\r\n]+)#[0-9A-F]{4}\]$/u)
      ?? lines[index]!.match(/^\*\*\* (?:Add|Update) File:\s+(.+)$/u);
    if (header) currentPath = header[1]!.trim();
    if (!currentPath || !isAddedLine(lines[index]!)) {
      index += 1;
      continue;
    }
    const start = index;
    const bodies: string[] = [];
    while (index < lines.length && isAddedLine(lines[index]!)) {
      bodies.push(lines[index]!.slice(1));
      index += 1;
    }
    const result = stripCodeComments(bodies.join("\n"), currentPath);
    if (!result.supported && hasLikelyComment(bodies.join("\n"))) return unsupported(currentPath);
    const rewritten = result.content.split("\n");
    if (rewritten.length !== bodies.length) return { block: true, reason: `No-code-comments could not safely preserve patch line structure for ${currentPath}. Retry with comment-free code.`, removed };
    for (let offset = 0; offset < rewritten.length; offset += 1) lines[start + offset] = `+${rewritten[offset]}`;
    removed += result.removed;
  }
  const content = lines.join("\n");
  return content === value ? { removed: 0 } : { input: { input: content }, removed };
}

function stripMarkedAdditions(value: string, path: string): Rewrite {
  const wrapped = `*** Begin Patch\n*** Update File: ${path}\n${value}\n*** End Patch`;
  const result = stripPatchInput(wrapped);
  if (result.block || !result.input) return result;
  const lines = String(result.input.input).split("\n");
  return { input: { input: lines.slice(2, -1).join("\n") }, removed: result.removed };
}

function isAddedLine(line: string): boolean {
  return line.startsWith("+") && !line.startsWith("+++");
}

function unsupported(path: string): Rewrite {
  return {
    block: true,
    reason: `No-code-comments cannot safely classify comments for ${path}. Retry using a supported code extension or write comment-free content.`,
    removed: 0,
  };
}

function hasLikelyComment(content: string): boolean {
  return /(^|\s)(?:\/\/|\/\*|#|--|<!--)/mu.test(content);
}

function requireHost(host: unknown): Host {
  if (!isRecord(host) || typeof host.on !== "function") throw new Error("No-code-comments requires the Pi/OMP on hook");
  return host as unknown as Host;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
