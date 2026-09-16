import test from "node:test";
import assert from "node:assert/strict";
import { ModelRouter } from "../src/router.ts";
import type { RouterConfig, FleetBox, ModelContract, ModelPlacement } from "../src/types.ts";

function createStatsTestConfig(): RouterConfig {
  const boxes: FleetBox[] = [
    {
      id: "spark0",
      name: "DGX Spark 0",
      endpoint: "http://spark0:8000/v1",
      maxConcurrency: 4,
      healthy: true,
    },
  ];

  const models: ModelContract[] = [
    {
      id: "qwen3.8-27b",
      weights: "Qwen/Qwen3.8-27B-Instruct",
      quantization: "fp8",
      contextWindow: 131072,
    },
  ];

  const placements: ModelPlacement[] = [
    { modelId: "qwen3.8-27b", boxId: "spark0", priority: 1 },
  ];

  return {
    host: "127.0.0.1",
    port: 8080,
    boxes,
    models,
    placements,
  };
}

test("Pi-grain telemetry records stage timings and placement provenance", async () => {
  const router = new ModelRouter(createStatsTestConfig());

  const mockResponse = {
    id: "chatcmpl-test-1",
    object: "chat.completion",
    created: 123456789,
    model: "qwen3.8-27b",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "The capital of France is Paris." },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 14,
      completion_tokens: 7,
      total_tokens: 21,
    },
  };

  const fakeFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const response = await router.forwardChatCompletion(
    {
      model: "qwen3.8-27b",
      messages: [{ role: "user", content: "What is the capital of France?" }],
    },
    {
      sessionId: "session-xyz",
      clientIp: "100.64.0.5",
      callerIdentity: "agent@tailnet",
      fetchFn: fakeFetch,
    },
  );

  // 1. Verify caller response is standard and does NOT leak internal box identity (PRD R3)
  assert.equal(response.status, 200);
  const responseBody = await response.text();
  assert.ok(!responseBody.includes("spark0"), "Caller response must not contain internal box ID");
  assert.ok(!responseBody.includes("http://spark0:8000"), "Caller response must not contain internal backend endpoint");

  // 2. Verify operator telemetry captures Pi-grain breakdown and placement provenance (PRD R6)
  const stats = router.getRecentStats(10);
  assert.equal(stats.length, 1);
  const entry = stats[0];

  assert.equal(entry.modelId, "qwen3.8-27b");
  assert.equal(entry.servingBoxId, "spark0");
  assert.equal(entry.servingEndpoint, "http://spark0:8000/v1");
  assert.equal(entry.sessionId, "session-xyz");
  assert.equal(entry.callerIdentity, "agent@tailnet");
  assert.equal(entry.promptTokens, 14);
  assert.equal(entry.completionTokens, 7);
  assert.ok(entry.totalDurationMs >= 0);
  assert.equal(entry.status, "completed");
});
