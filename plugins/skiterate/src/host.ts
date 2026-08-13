import { appendSkiterateNote, extractSkillName, parseCommandArgs } from "./record.ts";

export type RuntimeContext = {
  cwd?: string;
  sessionId?: string;
  sessionManager?: { getSessionFile?: () => string | undefined };
  model?: unknown;
  ui?: { notify?: (message: string, level?: string) => void };
};

export type RuntimeHost = {
  on(event: string, handler: (event: unknown, ctx: RuntimeContext) => unknown): void;
  registerCommand(name: string, options: { description: string; handler: (args: string, ctx: RuntimeContext) => unknown }): void;
};

export function installSkiterateExtension(host: RuntimeHost, agent: string): void {
  const lastSkills = new Map<string, string>();

  const rememberSkill = (event: unknown, context: RuntimeContext): void => {
    const skill = extractSkillName(event);
    if (skill) lastSkills.set(sessionKey(context), skill);
  };

  host.on("before_agent_start", (event, context) => {
    rememberSkill(event, context);
  });
  host.on("message_start", (event, context) => {
    rememberSkill(event, context);
  });

  host.registerCommand("skiterate", {
    description: "Append a one-line note about a skill invocation",
    handler: async (args, context) => {
      const parsed = parseCommandArgs(args);
      const record = await appendSkiterateNote({
        note: parsed.note,
        skill: parsed.skill ?? lastSkills.get(sessionKey(context)),
        cwd: context.cwd,
        agent,
        model: context.model,
      });
      context.ui?.notify?.(`Skiterate note logged${record.skill ? ` for ${record.skill}` : ""}`, "info");
    },
  });
}

function sessionKey(context: RuntimeContext): string {
  const session = context.sessionId ?? context.sessionManager?.getSessionFile?.();
  return session || context.cwd || "default";
}

