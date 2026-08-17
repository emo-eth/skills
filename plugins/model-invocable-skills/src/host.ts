import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Skill,
} from "@earendil-works/pi-coding-agent";

export const COMMAND_NAME = "model-invocable-skills";
export const WIDGET_KEY = "model-invocable-skills";
const PREVIEW_LIMIT = 8;

type Inventory = {
  modelInvocable: Skill[];
  userOnly: Skill[];
};

export function inventorySkills(skills: readonly Skill[]): Inventory {
  const byName = (a: Skill, b: Skill) => a.name.localeCompare(b.name);
  return {
    modelInvocable: skills.filter((skill) => !skill.disableModelInvocation).sort(byName),
    userOnly: skills.filter((skill) => skill.disableModelInvocation).sort(byName),
  };
}

function preview(skills: readonly Skill[]): string {
  if (skills.length === 0) return "none";
  const shown = skills.slice(0, PREVIEW_LIMIT).map((skill) => skill.name);
  const remaining = skills.length - shown.length;
  return `${shown.join(", ")}${remaining > 0 ? `, +${remaining} more` : ""}`;
}

export function renderWidgetLines(skills: readonly Skill[]): string[] {
  const inventory = inventorySkills(skills);
  return [
    `[skills] ${inventory.modelInvocable.length} model-invocable · ${inventory.userOnly.length} user-only`,
    `● model  ${preview(inventory.modelInvocable)}`,
    `○ user   ${preview(inventory.userOnly)}`,
    `/${COMMAND_NAME} list|hide`,
  ];
}

function summary(skills: readonly Skill[]): string {
  const inventory = inventorySkills(skills);
  return `${inventory.modelInvocable.length} model-invocable skill${inventory.modelInvocable.length === 1 ? "" : "s"}; ${inventory.userOnly.length} user-only skill${inventory.userOnly.length === 1 ? "" : "s"}.`;
}

function setWidget(ctx: ExtensionContext, skills: readonly Skill[]): void {
  if (ctx.mode !== "tui") return;
  ctx.ui.setWidget(WIDGET_KEY, renderWidgetLines(skills), { placement: "aboveEditor" });
}

function clearWidget(ctx: ExtensionContext): void {
  ctx.ui.setWidget(WIDGET_KEY, undefined);
}

function commandSkills(ctx: ExtensionCommandContext): Skill[] {
  return ctx.getSystemPromptOptions().skills ?? [];
}

function selectorOptions(skills: readonly Skill[]): string[] {
  const inventory = inventorySkills(skills);
  return [
    ...inventory.modelInvocable.map((skill) => `[model] ${skill.name} — ${skill.description}`),
    ...inventory.userOnly.map((skill) => `[user]  ${skill.name} — ${skill.description}`),
  ];
}

async function showList(ctx: ExtensionCommandContext, skills: readonly Skill[]): Promise<void> {
  const options = selectorOptions(skills);
  if (options.length === 0) {
    ctx.ui.notify("No skills are loaded.", "warning");
    return;
  }
  if (!ctx.hasUI) {
    ctx.ui.notify(summary(skills), "info");
    return;
  }
  await ctx.ui.select("Skill invocation visibility", options);
}

export function installModelInvocableSkills(pi: ExtensionAPI): void {
  let widgetVisible = true;

  pi.registerCommand(COMMAND_NAME, {
    description: "Show which skills the model can invoke and which are user-only.",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "show";
      const skills = commandSkills(ctx);

      if (action === "hide") {
        widgetVisible = false;
        clearWidget(ctx);
        ctx.ui.notify("Skill invocation visibility hidden.", "info");
        return;
      }

      if (action === "list") {
        await showList(ctx, skills);
        return;
      }

      if (action !== "show") {
        ctx.ui.notify(`Usage: /${COMMAND_NAME} [show|list|hide]`, "warning");
        return;
      }

      widgetVisible = true;
      setWidget(ctx, skills);
      ctx.ui.notify(summary(skills), "info");
    },
  });

  pi.on("before_agent_start", (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
    if (!widgetVisible) return;
    setWidget(ctx, event.systemPromptOptions.skills ?? []);
  });
}
