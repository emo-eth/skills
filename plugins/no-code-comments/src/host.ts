type Host = {
  on(event: string, handler: (event: any, context: any) => unknown): void;
  registerCommand?: (name: string, options: { description: string; handler: (args: string, context: any) => unknown }) => void;
};

export const NO_CODE_COMMENTS_PROMPT = "No-code-comments is active in advisory mode. Prefer self-explanatory code without prose comments. Semantic directives, shebangs, compiler annotations, and source-map directives are unaffected.";

export function installNoCodeComments(host: unknown): void {
  const runtime = requireHost(host);
  runtime.on("before_agent_start", async (event: { systemPrompt?: unknown }) => {
    if (Array.isArray(event?.systemPrompt)) return { systemPrompt: [...event.systemPrompt, NO_CODE_COMMENTS_PROMPT] };
    if (typeof event?.systemPrompt === "string") return { systemPrompt: `${event.systemPrompt}\n\n${NO_CODE_COMMENTS_PROMPT}` };
    return { systemPrompt: [NO_CODE_COMMENTS_PROMPT] };
  });
  runtime.registerCommand?.("no-code-comments", {
    description: "Show the no-code-comments advisory policy",
    handler: (_args: string, context: { ui?: { notify?: (message: string, level: string) => void } }) => {
      context?.ui?.notify?.(NO_CODE_COMMENTS_PROMPT, "info");
    },
  });
}

function requireHost(host: unknown): Host {
  if (!host || typeof host !== "object" || typeof (host as Host).on !== "function") throw new Error("No-code-comments requires the Pi/OMP on hook");
  return host as Host;
}
