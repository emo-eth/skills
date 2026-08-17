import assert from "node:assert/strict";
import test from "node:test";
import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisteredCommand,
  Skill,
} from "@earendil-works/pi-coding-agent";
import {
  COMMAND_NAME,
  WIDGET_KEY,
  installModelInvocableSkills,
  inventorySkills,
  renderWidgetLines,
} from "../src/host.ts";

type Command = Omit<RegisteredCommand, "name" | "sourceInfo">;
type BeforeAgentStartHandler = (event: BeforeAgentStartEvent, ctx: ExtensionContext) => unknown;

function skill(name: string, disableModelInvocation: boolean): Skill {
  return {
    name,
    description: `${name} description`,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    sourceInfo: {} as Skill["sourceInfo"],
    disableModelInvocation,
  };
}

function harness(skills: Skill[], mode: ExtensionContext["mode"] = "tui") {
  const commands = new Map<string, Command>();
  const handlers = new Map<string, BeforeAgentStartHandler>();
  const widgets = new Map<string, string[] | undefined>();
  const notices: Array<{ message: string; type?: string }> = [];
  const selections: Array<{ title: string; options: string[] }> = [];

  const pi = {
    registerCommand(name: string, options: Command) {
      commands.set(name, options);
    },
    on(event: string, handler: BeforeAgentStartHandler) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;

  const ctx = {
    mode,
    hasUI: true,
    getSystemPromptOptions: () => ({ cwd: "/repo", skills }),
    ui: {
      setWidget(key: string, content: string[] | undefined) {
        widgets.set(key, content);
      },
      notify(message: string, type?: string) {
        notices.push({ message, type });
      },
      async select(title: string, options: string[]) {
        selections.push({ title, options });
        return undefined;
      },
    },
  } as unknown as ExtensionCommandContext;

  installModelInvocableSkills(pi);
  return { commands, ctx, handlers, notices, selections, widgets };
}

test("classifies and sorts skills by model visibility", () => {
  const inventory = inventorySkills([
    skill("z-user", true),
    skill("b-model", false),
    skill("a-model", false),
  ]);

  assert.deepEqual(inventory.modelInvocable.map((item) => item.name), ["a-model", "b-model"]);
  assert.deepEqual(inventory.userOnly.map((item) => item.name), ["z-user"]);
});

test("renders a bounded, explicit widget", () => {
  const skills = Array.from({ length: 10 }, (_, index) => skill(`model-${index}`, false));
  const lines = renderWidgetLines([...skills, skill("manual", true)]);

  assert.equal(lines[0], "[skills] 10 model-invocable · 1 user-only");
  assert.match(lines[1], /\+2 more$/);
  assert.equal(lines[2], "○ user   manual");
  assert.equal(lines[3], `/${COMMAND_NAME} list|hide`);
});

test("show and hide command control the widget", async () => {
  const h = harness([skill("automatic", false), skill("manual", true)]);
  const command = h.commands.get(COMMAND_NAME);
  assert.ok(command);

  await command.handler("show", h.ctx);
  assert.deepEqual(h.widgets.get(WIDGET_KEY), [
    "[skills] 1 model-invocable · 1 user-only",
    "● model  automatic",
    "○ user   manual",
    `/${COMMAND_NAME} list|hide`,
  ]);
  assert.equal(h.notices.at(-1)?.message, "1 model-invocable skill; 1 user-only skill.");

  await command.handler("hide", h.ctx);
  assert.equal(h.widgets.get(WIDGET_KEY), undefined);
});

test("list command presents every skill with its invocation class", async () => {
  const h = harness([skill("automatic", false), skill("manual", true)]);
  const command = h.commands.get(COMMAND_NAME);
  assert.ok(command);

  await command.handler("list", h.ctx);
  assert.deepEqual(h.selections, [{
    title: "Skill invocation visibility",
    options: [
      "[model] automatic — automatic description",
      "[user]  manual — manual description",
    ],
  }]);
});

test("first agent turn refreshes visible skills from Pi's loaded prompt options", () => {
  const h = harness([]);
  const handler = h.handlers.get("before_agent_start");
  assert.ok(handler);

  handler({
    type: "before_agent_start",
    prompt: "hello",
    systemPrompt: "system",
    systemPromptOptions: {
      cwd: "/repo",
      skills: [skill("automatic", false), skill("manual", true)],
    },
  }, h.ctx);

  assert.equal(h.widgets.get(WIDGET_KEY)?.[0], "[skills] 1 model-invocable · 1 user-only");
});
