import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROMPT_BOUNDS,
  PI_BOTS_EXTENSION_PATH,
  boundItems,
  boundText,
  buildRuntimeAgentDefinition,
  renderBotSystemPrompt,
  renderParentPrompt,
} from "../src/runtime.ts";
import type { BotDefinition, BotRoster } from "../src/types.ts";

function makeBot(overrides: Partial<BotDefinition> = {}): BotDefinition {
  return {
    name: "alpha",
    runtimeName: "bot.alpha",
    title: "Alpha Bot",
    description: "Owns the alpha domain end to end.",
    domains: ["alpha"],
    instructions: "Stay inside your domains.",
    model: "zai/glm-5.3-flash",
    fallbackModels: ["zai/glm-5.3-air"],
    thinking: "high",
    tools: ["read", "grep"],
    skills: ["linear-client"],
    delegates: ["beta"],
    memory: "project",
    context: "fork",
    timeoutMs: 600_000,
    maxSubagentDepth: 2,
    enabled: true,
    scope: "project",
    configPath: "/repo/.pi/BOTS.yml",
    ...overrides,
  };
}

function makeRoster(bots: BotDefinition[], overrides: Partial<BotRoster> = {}): BotRoster {
  return {
    version: 1,
    bots,
    domainOwners: { alpha: "alpha", beta: "beta" },
    sharedInstructions: "Be concise. Preserve domain records.",
    sources: ["/repo/.pi/BOTS.yml"],
    projectRoot: "/repo",
    agentDir: "/home/u/.pi/agent",
    ...overrides,
  };
}

function peerAt(index: number): BotDefinition {
  return makeBot({
    name: `peer-${index}`,
    runtimeName: `bot.peer-${index}`,
    title: `Peer ${index}`,
    description: `Owns domain-${index}.`,
    domains: [`domain-${index}`],
    delegates: [],
  });
}

describe("buildRuntimeAgentDefinition", () => {
  it("maps every runtime field from the bot definition", () => {
    const alpha = makeBot();
    const roster = makeRoster([alpha, makeBot({ name: "beta", runtimeName: "bot.beta", title: "Beta Bot" })]);
    const definition = buildRuntimeAgentDefinition(alpha, roster);
    assert.equal(definition.model, "zai/glm-5.3-flash");
    assert.deepEqual(definition.fallbackModels, ["zai/glm-5.3-air"]);
    assert.equal(definition.thinking, "high");
    assert.deepEqual(definition.tools, ["read", "grep", "bots", "subagent"]);
    assert.deepEqual(definition.skills, ["linear-client"]);
    assert.equal(definition.defaultContext, "fork");
    assert.equal(definition.defaultTimeoutMs, 600_000);
    assert.equal(definition.maxSubagentDepth, 2);
    assert.equal(definition.acceptanceRole, "writer");
    assert.deepEqual(definition.mutationTools, ["bots"]);
    assert.deepEqual(definition.subagentOnlyExtensions, [PI_BOTS_EXTENSION_PATH]);
    assert.equal(definition.systemPrompt, renderBotSystemPrompt(alpha, roster));
    assert.ok(definition.description.includes("Alpha Bot"));
  });

  it("pins fixed runtime behavior", () => {
    const alpha = makeBot();
    const definition = buildRuntimeAgentDefinition(alpha, makeRoster([alpha]));
    assert.equal(definition.defaultAsync, false);
    assert.equal(definition.allowNestedSubagents, true);
    assert.equal(definition.systemPromptMode, "replace");
    assert.equal(definition.inheritProjectContext, true);
    assert.equal(definition.inheritGlobalContext, false);
    assert.equal(definition.completionGuard, true);
  });
  it("preserves zero as an explicit nested-delegation boundary", () => {
    const leaf = makeBot({ maxSubagentDepth: 0, delegates: [] });
    assert.equal(buildRuntimeAgentDefinition(leaf, makeRoster([leaf])).maxSubagentDepth, 0);
  });


  it("omits unset optional fields for minimal bots", () => {
    const alpha = makeBot({
      model: undefined,
      fallbackModels: [],
      thinking: undefined,
      tools: undefined,
      skills: undefined,
      instructions: undefined,
    });
    const definition = buildRuntimeAgentDefinition(alpha, makeRoster([alpha]));
    for (const field of ["model", "fallbackModels", "thinking", "tools", "skills"] as const) {
      assert.equal(Object.hasOwn(definition, field), false, field);
    }
    assert.equal(definition.acceptanceRole, "writer");
    assert.ok(definition.systemPrompt.length > 0);
    assert.equal(definition.description.trim(), definition.description);
    assert.equal(definition.systemPrompt.trim(), definition.systemPrompt);
  });

  it("augments explicit tool lists with bots and subagent without duplicates", () => {
    const alpha = makeBot({ tools: ["grep", "bash", "grep", "   "] });
    assert.deepEqual(buildRuntimeAgentDefinition(alpha, makeRoster([alpha])).tools, [
      "grep",
      "bash",
      "bots",
      "subagent",
    ]);
    const preexisting = makeBot({ tools: ["read", "subagent"] });
    assert.deepEqual(buildRuntimeAgentDefinition(preexisting, makeRoster([preexisting])).tools, [
      "read",
      "subagent",
      "bots",
    ]);
    const empty = makeBot({ tools: [] });
    assert.deepEqual(buildRuntimeAgentDefinition(empty, makeRoster([empty])).tools, ["bots", "subagent"]);
  });

  it("marks the mixed bots state tool as mutation capable", () => {
    const cases = [
      ["read", "grep"],
      ["bash"],
      ["write"],
      ["edit"],
      ["ast_edit"],
      ["BASH"],
    ];
    for (const tools of cases) {
      const alpha = makeBot({ tools });
      const definition = buildRuntimeAgentDefinition(alpha, makeRoster([alpha]));
      assert.equal(definition.acceptanceRole, "writer", tools.join(","));
      assert.deepEqual(definition.mutationTools, ["bots"]);
    }
  });

  it("bounds the description deterministically", () => {
    const alpha = makeBot({ title: `T${"x".repeat(5_000)}`, description: "d".repeat(10_000) });
    const roster = makeRoster([alpha]);
    const first = buildRuntimeAgentDefinition(alpha, roster);
    const second = buildRuntimeAgentDefinition(alpha, roster);
    assert.ok(first.description.length <= PROMPT_BOUNDS.descriptionChars);
    assert.ok(first.description.includes("chars]"));
    assert.equal(first.description, second.description);
  });
});

describe("renderBotSystemPrompt", () => {
  it("states identity, title, domains, and charter", () => {
    const alpha = makeBot();
    const prompt = renderBotSystemPrompt(alpha, makeRoster([alpha]));
    assert.ok(prompt.includes("You are alpha (`bot.alpha`), the Alpha Bot."));
    assert.ok(prompt.includes("Domains you own: alpha."));
    assert.ok(prompt.includes("Owns the alpha domain end to end."));
    assert.ok(prompt.includes("Stay inside your domains."));
  });

  it("lists roster peers and only allowed delegates", () => {
    const alpha = makeBot();
    const beta = makeBot({ name: "beta", runtimeName: "bot.beta", title: "Beta Bot", domains: ["beta"] });
    const gamma = makeBot({ name: "gamma", runtimeName: "bot.gamma", title: "Gamma Bot", domains: ["gamma"] });
    const delta = makeBot({
      name: "delta",
      runtimeName: "bot.delta",
      title: "Delta Bot",
      domains: ["delta"],
      enabled: false,
    });
    const prompt = renderBotSystemPrompt(alpha, makeRoster([alpha, beta, gamma, delta]));
    assert.ok(prompt.includes("Peer bots:"));
    assert.ok(prompt.includes("- `bot.beta` — Beta Bot; domains: beta"));
    assert.ok(prompt.includes("- `bot.gamma` — Gamma Bot; domains: gamma"));
    assert.ok(prompt.includes("Allowed delegates: `bot.beta` via the `subagent` tool."));
    assert.ok(!prompt.includes("bot.delta"));
  });

  it("accepts delegate entries written as runtime names", () => {
    const alpha = makeBot({ delegates: ["bot.gamma"] });
    const gamma = makeBot({ name: "gamma", runtimeName: "bot.gamma", title: "Gamma Bot", domains: ["gamma"] });
    const prompt = renderBotSystemPrompt(alpha, makeRoster([alpha, gamma]));
    assert.ok(prompt.includes("Allowed delegates: `bot.gamma` via the `subagent` tool."));
  });

  it("uses exact runtime names for peer calls", () => {
    const alpha = makeBot({ name: "code_rev", runtimeName: "bot.code-review" });
    const beta = makeBot({ name: "beta", runtimeName: "bot.code-beta", title: "Beta Bot", domains: ["beta"] });
    const prompt = renderBotSystemPrompt(alpha, makeRoster([alpha, beta]));
    assert.ok(prompt.includes("You are code_rev (`bot.code-review`)"));
    assert.ok(prompt.includes('agent: "bot.code-beta"'));
    assert.ok(!prompt.includes("bot.beta` —") && !prompt.includes("`bot.beta`"));
  });

  it("describes the live-state protocol", () => {
    const alpha = makeBot();
    const prompt = renderBotSystemPrompt(alpha, makeRoster([alpha]));
    assert.ok(prompt.includes("`bots context`"));
    assert.ok(prompt.includes("`bots record`"));
    assert.ok(prompt.includes("`bots remember`"));
    assert.ok(prompt.includes("observation | inference | verified"));
    assert.ok(prompt.includes("requires evidence"));
  });

  it("drops remember when private memory is off", () => {
    const alpha = makeBot({ memory: "off" });
    const prompt = renderBotSystemPrompt(alpha, makeRoster([alpha]));
    assert.ok(!prompt.includes("`bots remember`"));
    assert.ok(prompt.includes("Private memory is disabled"));
    assert.ok(prompt.includes("`bots context`"));
    assert.ok(prompt.includes("`bots record`"));
  });

  it("instructs synchronous foreground peer delegation, owner handoff, and no recursion", () => {
    const alpha = makeBot();
    const beta = makeBot({ name: "beta", runtimeName: "bot.beta", title: "Beta Bot", domains: ["beta"] });
    const roster = makeRoster([alpha, beta]);
    const prompt = renderBotSystemPrompt(alpha, roster);
    assert.ok(prompt.includes("synchronously in the foreground"));
    assert.ok(prompt.includes("`subagent`"));
    assert.ok(prompt.includes("Owner handoff"));
    assert.ok(prompt.includes("No recursion"));
    assert.ok(prompt.includes("never invoke your own runtime name (`bot.alpha`)"));
    assert.ok(prompt.includes("Verification"));
    assert.equal(buildRuntimeAgentDefinition(alpha, roster).defaultAsync, false);
  });

  it("appends shared instructions", () => {
    const alpha = makeBot();
    assert.ok(renderBotSystemPrompt(alpha, makeRoster([alpha])).includes("Shared instructions:\nBe concise."));
    const bare = makeRoster([alpha], { sharedInstructions: undefined });
    assert.ok(!renderBotSystemPrompt(alpha, bare).includes("Shared instructions"));
  });

  it("bounds oversized prompts deterministically", () => {
    const alpha = makeBot({
      instructions: "x".repeat(200_000),
      description: "d".repeat(50_000),
    });
    const peers = Array.from({ length: 60 }, (_, index) => peerAt(index));
    const roster = makeRoster([alpha, ...peers], { sharedInstructions: "y".repeat(300_000) });
    const first = renderBotSystemPrompt(alpha, roster);
    const second = renderBotSystemPrompt(alpha, roster);
    assert.ok(first.length <= PROMPT_BOUNDS.botPromptChars);
    assert.ok(first.includes("chars]"));
    assert.ok(first.includes("(+36 more peers)"));
    assert.equal(first, second);
  });
});

describe("renderParentPrompt", () => {
  it("lists enabled bots and bots tool routines", () => {
    const alpha = makeBot();
    const beta = makeBot({ name: "beta", runtimeName: "bot.beta", title: "Beta Bot", domains: ["beta"] });
    const delta = makeBot({
      name: "delta",
      runtimeName: "bot.delta",
      title: "Delta Bot",
      domains: ["delta"],
      enabled: false,
    });
    const prompt = renderParentPrompt(makeRoster([alpha, beta, delta]));
    assert.ok(prompt.includes("Domain bots (call with the native `subagent` tool"));
    assert.ok(prompt.includes("- `bot.alpha` (project)"));
    assert.ok(prompt.includes("Alpha Bot"));
    assert.ok(prompt.includes("- `bot.beta` (project)"));
    assert.ok(!prompt.includes("bot.delta"));
    assert.ok(prompt.includes("`bots context`"));
    assert.ok(prompt.includes("`bots record`"));
    assert.ok(prompt.includes("`bots remember`"));
    assert.ok(prompt.includes("`schedule.create`"));
    assert.ok(prompt.includes("Route each domain task to its owning bot"));
    assert.ok(prompt.includes("never embedded"));
  });

  it("never embeds charter instructions or state paths", () => {
    const alpha = makeBot({ instructions: "CLASSIFIED_ALPHA_CHARTER" });
    const prompt = renderParentPrompt(makeRoster([alpha]));
    assert.ok(!prompt.includes("CLASSIFIED_ALPHA_CHARTER"));
    assert.ok(!prompt.includes("/repo/.pi/BOTS.yml"));
    assert.ok(!prompt.includes("MEMORY.md"));
    assert.ok(renderBotSystemPrompt(alpha, makeRoster([alpha])).includes("CLASSIFIED_ALPHA_CHARTER"));
  });

  it("bounds oversized rosters deterministically", () => {
    const bots = Array.from({ length: 60 }, (_, index) => peerAt(index));
    const first = renderParentPrompt(makeRoster(bots, { sharedInstructions: undefined }));
    const second = renderParentPrompt(makeRoster(bots, { sharedInstructions: undefined }));
    assert.ok(first.length <= PROMPT_BOUNDS.parentPromptChars);
    assert.ok(first.includes("(+12 more bots)"));
    assert.equal(first, second);
    const empty = renderParentPrompt(makeRoster([]));
    assert.ok(empty.includes("(none)"));
  });
});

describe("bounds helpers", () => {
  it("boundText truncates with a deterministic marker", () => {
    const text = "z".repeat(5_000);
    const bounded = boundText(text, 100);
    assert.ok(bounded.length <= 100);
    assert.ok(bounded.startsWith("z"));
    assert.ok(bounded.includes("[+4900 chars]"));
    assert.equal(bounded, boundText(text, 100));
    assert.equal(boundText("short", 100), "short");
  });

  it("boundItems caps lists with a deterministic marker", () => {
    const items = ["a", "b", "c", "d", "e"];
    assert.deepEqual(boundItems(items, 3), ["a", "b", "c", "… (+2 more)"]);
    assert.deepEqual(boundItems(items, 5), items);
    assert.deepEqual(boundItems(items, 3), boundItems(items, 3));
  });
});
