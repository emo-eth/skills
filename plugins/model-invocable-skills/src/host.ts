import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Skill,
} from "@earendil-works/pi-coding-agent";

export const COMMAND_NAME = "model-invocable-skills";
export const WIDGET_KEY = "model-invocable-skills";

type Inventory = {
  modelInvocable: Skill[];
  userOnly: Skill[];
};

type SkillWidgetTheme = {
  fg(color: "mdHeading" | "dim", text: string): string;
};

export function inventorySkills(skills: readonly Skill[]): Inventory {
  const byName = (a: Skill, b: Skill) => a.name.localeCompare(b.name);
  return {
    modelInvocable: skills.filter((skill) => !skill.disableModelInvocation).sort(byName),
    userOnly: skills.filter((skill) => skill.disableModelInvocation).sort(byName),
  };
}

export function renderWidgetLines(skills: readonly Skill[], theme: SkillWidgetTheme): string[] {
  const names = inventorySkills(skills).modelInvocable.map((skill) => skill.name).join(", ") || "none";
  return [
    `${theme.fg("mdHeading", "[Model-invocable skills]")} ${theme.fg("dim", names)}`,
  ];
}

function setWidget(ctx: ExtensionContext, skills: readonly Skill[]): void {
  if (ctx.mode !== "tui") return;
  ctx.ui.setWidget(WIDGET_KEY, renderWidgetLines(skills, ctx.ui.theme), { placement: "aboveEditor" });
}

function commandSkills(ctx: ExtensionCommandContext): Skill[] {
  return ctx.getSystemPromptOptions().skills ?? [];
}

export function installModelInvocableSkills(pi: ExtensionAPI): void {
  pi.registerCommand(COMMAND_NAME, {
    description: "Show which loaded skills are model-invocable.",
    handler: async (_args, ctx) => {
      setWidget(ctx, commandSkills(ctx));
    },
  });

  pi.on("before_agent_start", (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
    setWidget(ctx, event.systemPromptOptions.skills ?? []);
  });
}
