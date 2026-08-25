import assert from "node:assert/strict";
import test from "node:test";
import { installNoCodeComments, NO_CODE_COMMENTS_PROMPT } from "../src/host.ts";

test("registers prompt and tool-call enforcement on Pi and OMP-shaped hosts", async () => {
  for (const runtime of ["pi", "omp"]) {
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    let command = "";
    installNoCodeComments({
      on: (event: string, handler: (event: any, context: any) => unknown) => handlers.set(event, handler),
      registerCommand: (name: string) => { command = name; },
      runtime,
    });
    assert.equal(command, "no-code-comments");
    const prompt = await handlers.get("before_agent_start")?.({ systemPrompt: ["base"] }, {});
    assert.deepEqual(prompt, { systemPrompt: ["base", NO_CODE_COMMENTS_PROMPT] });
    const call = await handlers.get("tool_call")?.({
      toolName: "write",
      input: { path: "a.js", content: "const a = 1; // remove\n" },
    }, {});
    assert.deepEqual(call, { input: { path: "a.js", content: "const a = 1;\n" } });
  }
});
