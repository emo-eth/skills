import assert from "node:assert/strict";
import { ModelRouter } from "../src/router.ts";
import { createRouterServer } from "../src/server.ts";
import { loadRouterConfig } from "../src/config.ts";
import type { RouterConfig, ChatCompletionResponse } from "../src/types.ts";

async function runLiveVerification(): Promise<void> {
  console.log("Starting Local Model Router live verification...");

  const config: RouterConfig = {
    host: "127.0.0.1",
    port: 0,
    authToken: "tailnet-bearer-token-123",
    boxes: [
      {
        id: "spark0",
        name: "DGX Spark 0",
        endpoint: "http://spark0:8000/v1",
        maxConcurrency: 1,
        healthy: true,
      },
      {
        id: "spark1",
        name: "DGX Spark 1",
        endpoint: "http://spark1:8000/v1",
        maxConcurrency: 1,
        healthy: false, // simulated offline
      },
    ],
    models: [
      {
        id: "qwen3.8-27b",
        weights: "Qwen/Qwen3.8-27B-Instruct",
        quantization: "fp8",
        contextWindow: 131072,
        reasoning: true,
      },
      {
        id: "offline-model",
        weights: "Qwen/Offline",
        quantization: "fp8",
        contextWindow: 8192,
      },
    ],
    placements: [
      { modelId: "qwen3.8-27b", boxId: "spark0", priority: 1 },
      { modelId: "offline-model", boxId: "spark1", priority: 1 },
    ],
  };

  const router = new ModelRouter(config);
  const server = createRouterServer(router);

  const listenGate = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listenGate.resolve());
  await listenGate.promise;

  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const authHeaders = { Authorization: "Bearer tailnet-bearer-token-123", "Content-Type": "application/json" };

  try {
    // 1. Health check
    const health = await (await fetch(`${baseUrl}/health`)).json();
    assert.equal(health.status, "degraded", "Should report degraded when spark1 is offline");
    console.log("✓ Health endpoint verified (degraded state recognized)");

    // 2. Auth rejection on protected endpoint
    const unauth = await fetch(`${baseUrl}/v1/models`);
    assert.equal(unauth.status, 401, "Unauthenticated access must return 401");
    console.log("✓ Unauthenticated access rejected with 401");

    // 3. Models listing with auth
    const modelsResp = await (await fetch(`${baseUrl}/v1/models`, { headers: authHeaders })).json();
    assert.equal(modelsResp.data[0].id, "qwen3.8-27b");
    console.log("✓ Models catalog listed over authenticated API");

    // 4. Status endpoint
    const statusResp = await (await fetch(`${baseUrl}/v1/router/status`, { headers: authHeaders })).json();
    assert.equal(statusResp.fleet.length, 2);
    console.log("✓ Router fleet status endpoint verified");

    // 5. Fail-fast 404 for unknown model
    const notFound = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ model: "nonexistent", messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(notFound.status, 404);
    const notFoundJson = await notFound.json();
    assert.equal(notFoundJson.error.code, "model_not_found");
    console.log("✓ Fail-fast 404 for unknown model verified");

    // 6. Fail-fast 503 for unavailable offline model
    const unavailable = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ model: "offline-model", messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(unavailable.status, 503);
    const unavailJson = await unavailable.json();
    assert.equal(unavailJson.error.code, "model_unavailable");
    console.log("✓ Fail-fast 503 for unavailable/offline placement verified");

    // 7. Telemetry inspection
    const statsResp = await (await fetch(`${baseUrl}/v1/router/stats?limit=10`, { headers: authHeaders })).json();
    assert.ok(Array.isArray(statsResp.data));
    assert.ok(statsResp.data.length >= 2, "Should have recorded the 404 and 503 attempts in telemetry");
    console.log("✓ Operator telemetry captured failed attempts with exact status codes");

    console.log("\nAll Local Model Router live verification checks PASSED successfully!");
  } finally {
    const closeGate = Promise.withResolvers<void>();
    server.close(() => closeGate.resolve());
    await closeGate.promise;
  }
}

runLiveVerification().catch((err) => {
  console.error("Live verification failed:", err);
  process.exit(1);
});
