import test from "node:test";
import assert from "node:assert/strict";
import { ModelRouter, RouterError } from "../src/router.ts";
import type { RouterConfig, FleetBox, ModelContract, ModelPlacement } from "../src/types.ts";

function createTestConfig(): RouterConfig {
  const boxes: FleetBox[] = [
    {
      id: "spark0",
      name: "DGX Spark 0",
      endpoint: "http://spark0:8000/v1",
      maxConcurrency: 2,
      healthy: true,
    },
    {
      id: "spark1",
      name: "DGX Spark 1",
      endpoint: "http://spark1:8000/v1",
      maxConcurrency: 2,
      healthy: true,
    },
    {
      id: "emo-win",
      name: "Windows 5090",
      endpoint: "http://emo-win:8000/v1",
      maxConcurrency: 1,
      healthy: false, // Unhealthy box for testing
    },
  ];

  const models: ModelContract[] = [
    {
      id: "qwen3.8-27b",
      weights: "Qwen/Qwen3.8-27B-Instruct",
      quantization: "fp8",
      contextWindow: 131072,
    },
    {
      id: "unplaced-model",
      weights: "Meta/Llama-Unplaced",
      quantization: "fp8",
      contextWindow: 8192,
    },
    {
      id: "offline-model",
      weights: "Offline/Model",
      quantization: "fp8",
      contextWindow: 8192,
    },
  ];

  const placements: ModelPlacement[] = [
    { modelId: "qwen3.8-27b", boxId: "spark0", priority: 1 },
    { modelId: "qwen3.8-27b", boxId: "spark1", priority: 2 },
    { modelId: "offline-model", boxId: "emo-win", priority: 1 },
  ];

  return {
    host: "127.0.0.1",
    port: 8080,
    boxes,
    models,
    placements,
  };
}

test("Router rejects unrecognized model with 404", () => {
  const router = new ModelRouter(createTestConfig());
  assert.throws(
    () => router.selectPlacement("nonexistent-model"),
    (err: unknown) => {
      assert.ok(err instanceof RouterError);
      assert.equal(err.statusCode, 404);
      assert.equal(err.errorCode, "model_not_found");
      return true;
    },
  );
});

test("Router rejects model with no placements with 503", () => {
  const router = new ModelRouter(createTestConfig());
  assert.throws(
    () => router.selectPlacement("unplaced-model"),
    (err: unknown) => {
      assert.ok(err instanceof RouterError);
      assert.equal(err.statusCode, 503);
      assert.equal(err.errorCode, "model_unavailable");
      return true;
    },
  );
});

test("Router rejects model whose placements are all unhealthy with 503", () => {
  const router = new ModelRouter(createTestConfig());
  assert.throws(
    () => router.selectPlacement("offline-model"),
    (err: unknown) => {
      assert.ok(err instanceof RouterError);
      assert.equal(err.statusCode, 503);
      assert.equal(err.errorCode, "model_unavailable");
      return true;
    },
  );
});

test("Router selects highest priority placement when slots are free", () => {
  const router = new ModelRouter(createTestConfig());
  const selected = router.selectPlacement("qwen3.8-27b");
  assert.equal(selected.box.id, "spark0");
  assert.equal(selected.placement.modelId, "qwen3.8-27b");
});

test("Router balances load across placements as slots fill", async () => {
  const router = new ModelRouter(createTestConfig());

  const fakeFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        id: "mock-1",
        object: "chat.completion",
        created: 123456,
        model: "qwen3.8-27b",
        choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  await router.forwardChatCompletion(
    { model: "qwen3.8-27b", messages: [{ role: "user", content: "hi 1" }] },
    { fetchFn: fakeFetch },
  );

  assert.equal(router.getActiveSlots("spark0"), 0);
  assert.equal(router.getActiveSlots("spark1"), 0);
});

test("Router fails fast with 429 when all candidate boxes are at capacity", async () => {
  const config = createTestConfig();
  // Set concurrency to 1 on each box so total capacity is 2
  config.boxes[0].maxConcurrency = 1;
  config.boxes[1].maxConcurrency = 1;
  const router = new ModelRouter(config);

  const gate = Promise.withResolvers<void>();
  const delayedFetch = async (): Promise<Response> => {
    await gate.promise;
    return new Response(
      JSON.stringify({
        id: "mock-1",
        object: "chat.completion",
        created: 123456,
        model: "qwen3.8-27b",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  // Occupy both slots
  const req1 = router.forwardChatCompletion(
    { model: "qwen3.8-27b", messages: [{ role: "user", content: "msg1" }] },
    { fetchFn: delayedFetch },
  );
  const req2 = router.forwardChatCompletion(
    { model: "qwen3.8-27b", messages: [{ role: "user", content: "msg2" }] },
    { fetchFn: delayedFetch },
  );

  // 3rd concurrent request must fail immediately with 429
  await assert.rejects(
    () =>
      router.forwardChatCompletion(
        { model: "qwen3.8-27b", messages: [{ role: "user", content: "msg3" }] },
        { fetchFn: delayedFetch },
      ),
    (err: unknown) => {
      assert.ok(err instanceof RouterError);
      assert.equal(err.statusCode, 429);
      assert.equal(err.errorCode, "capacity_exhausted");
      return true;
    },
  );

  // Release in-flight requests
  gate.resolve();
  await Promise.all([req1, req2]);
  assert.equal(router.getActiveSlots("spark0"), 0);
  assert.equal(router.getActiveSlots("spark1"), 0);
});
