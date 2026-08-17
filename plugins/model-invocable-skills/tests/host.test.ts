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
    getSystemPromptOptions: () => ({ cwd: "/repo", skills }),
    ui: {
      theme: {
        fg(color: string, text: string) {
          return `<${color}>${text}</${color}>`;
        },
      },
      setWidget(key: string, content: string[] | undefined) {
        widgets.set(key, content);
      },
    },
  } as unknown as ExtensionCommandContext;

  installModelInvocableSkills(pi);
  return { commands, ctx, handlers, widgets };
}

test("classifies and sorts model-invocable and user-only skills", () => {
  const inventory = inventorySkills([
    skill("z-user", true),
    skill("b-model", false),
    skill("a-model", false),
  ]);

  assert.deepEqual(inventory.modelInvocable.map((item) => item.name), ["a-model", "b-model"]);
  assert.deepEqual(inventory.userOnly.map((item) => item.name), ["z-user"]);
});

test("renders the screenshot-matching themed model-invocable line", () => {
  const theme = { fg: (color: "mdHeading" | "dim", text: string) => `<${color}>${text}</${color}>` };
  assert.deepEqual(renderWidgetLines([
    skill("manual", true),
    skill("ctx7-docs", false),
  ], theme), [
    "<mdHeading>[Model-invocable skills]</mdHeading> <dim>ctx7-docs</dim>",
  ]);
  assert.deepEqual(renderWidgetLines([], theme), [
    "<mdHeading>[Model-invocable skills]</mdHeading> <dim>none</dim>",
  ]);
});

test("command renders immediately and before_agent_start refreshes authoritative skills", async () => {
  const h = harness([skill("initial", false), skill("manual", true)]);
  const command = h.commands.get(COMMAND_NAME);
  assert.ok(command);

  await command.handler("", h.ctx);
  assert.deepEqual(h.widgets.get(WIDGET_KEY), [
    "<mdHeading>[Model-invocable skills]</mdHeading> <dim>initial</dim>",
  ]);

  const handler = h.handlers.get("before_agent_start");
  assert.ok(handler);
  handler({
    type: "before_agent_start",
    prompt: "hello",
    systemPrompt: "system",
    systemPromptOptions: {
      cwd: "/repo",
      skills: [skill("fresh", false), skill("initial", true)],
    },
  }, h.ctx);

  assert.deepEqual(h.widgets.get(WIDGET_KEY), [
    "<mdHeading>[Model-invocable skills]</mdHeading> <dim>fresh</dim>",
  ]);
});

test("non-TUI modes do not emit a widget", async () => {
  const h = harness([skill("automatic", false)], "rpc");
  const command = h.commands.get(COMMAND_NAME);
  assert.ok(command);

  await command.handler("", h.ctx);
  assert.equal(h.widgets.has(WIDGET_KEY), false);
});
