import assert from "node:assert/strict";
import test from "node:test";
import { installNoCodeComments, NO_CODE_COMMENTS_PROMPT } from "../src/host.ts";

type Handler = (event: unknown, context: unknown) => unknown;

function install(runtime: string): { handlers: Map<string, Handler>; command: string; description: string } {
  const handlers = new Map<string, Handler>();
  let command = "";
  let description = "";
  installNoCodeComments({
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerCommand: (name: string, options: { description: string }) => {
      command = name;
      description = options.description;
    },
    runtime,
  });
  return { handlers, command, description };
}

test("Pi: string systemPrompt is retained with the advisory policy appended", async () => {
  const { handlers } = install("pi");
  const result = (await handlers.get("before_agent_start")?.(
    { prompt: "probe", systemPrompt: "BASE_SENTINEL" },
    {},
  )) as { systemPrompt?: unknown } | undefined;
  const systemPrompt = result?.systemPrompt;
  assert.equal(typeof systemPrompt, "string");
  assert.match(String(systemPrompt), /BASE_SENTINEL/u);
  assert.ok(String(systemPrompt).includes(NO_CODE_COMMENTS_PROMPT));
});

test("OMP: array systemPrompt gains the advisory policy", async () => {
  const { handlers } = install("omp");
  const result = (await handlers.get("before_agent_start")?.({ systemPrompt: ["base"] }, {})) as { systemPrompt?: string[] } | undefined;
  assert.deepEqual(result, { systemPrompt: ["base", NO_CODE_COMMENTS_PROMPT] });
});

test("missing systemPrompt still receives the advisory policy", async () => {
  const { handlers } = install("pi");
  const result = (await handlers.get("before_agent_start")?.({}, {})) as { systemPrompt?: string[] } | undefined;
  assert.deepEqual(result, { systemPrompt: [NO_CODE_COMMENTS_PROMPT] });
});


test("/no-code-comments reports the advisory policy through the ui", () => {
  const hostHandlers = new Map<string, (args: string, context: unknown) => unknown>();
  installNoCodeComments({
    on: () => undefined,
    registerCommand: (name, options) => { hostHandlers.set(name, options.handler); },
  });
  const commandHandler = hostHandlers.get("no-code-comments");
  assert.ok(commandHandler);
  let notified: { message: string; level: string } | undefined;
  commandHandler("", { ui: { notify: (message: string, level: string) => { notified = { message, level }; } } });
  assert.deepEqual(notified, { message: NO_CODE_COMMENTS_PROMPT, level: "info" });
});
