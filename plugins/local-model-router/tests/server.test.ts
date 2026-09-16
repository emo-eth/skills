import test from "node:test";
import assert from "node:assert/strict";
import { ModelRouter } from "../src/router.ts";
import { createRouterServer } from "../src/server.ts";
import type { RouterConfig, FleetBox, ModelContract, ModelPlacement } from "../src/types.ts";

function createServerTestConfig(): RouterConfig {
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
    port: 0, // OS assigned port
    boxes,
    models,
    placements,
  };
}

test("Server handles /health, /v1/models, /v1/router/status", async () => {
  const router = new ModelRouter(createServerTestConfig());
  const server = createRouterServer(router);

  const listenGate = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listenGate.resolve());
  await listenGate.promise;

  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Health
    const healthResp = await fetch(`${baseUrl}/health`);
    assert.equal(healthResp.status, 200);
    const healthJson = await healthResp.json();
    assert.equal(healthJson.status, "healthy");

    // 2. Models
    const modelsResp = await fetch(`${baseUrl}/v1/models`);
    assert.equal(modelsResp.status, 200);
    const modelsJson = await modelsResp.json();
    assert.equal(modelsJson.object, "list");
    assert.equal(modelsJson.data[0].id, "qwen3.8-27b");

    // 3. Router status
    const statusResp = await fetch(`${baseUrl}/v1/router/status`);
    assert.equal(statusResp.status, 200);
    const statusJson = await statusResp.json();
    assert.equal(statusJson.status, "healthy");
    assert.equal(statusJson.fleet[0].id, "spark0");
  } finally {
    const closeGate = Promise.withResolvers<void>();
    server.close(() => closeGate.resolve());
    await closeGate.promise;
  }
});

test("Server enforces authentication when authToken is set", async () => {
  const config = createServerTestConfig();
  config.authToken = "secret-token";
  const router = new ModelRouter(config);
  const server = createRouterServer(router);

  const listenGate = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listenGate.resolve());
  await listenGate.promise;

  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Missing auth -> 401
    const unauthResp = await fetch(`${baseUrl}/v1/models`);
    assert.equal(unauthResp.status, 401);

    // Wrong auth -> 401
    const wrongAuthResp = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    assert.equal(wrongAuthResp.status, 401);

    // Correct auth -> 200
    const correctAuthResp = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: "Bearer secret-token" },
    });
    assert.equal(correctAuthResp.status, 200);

    // Tailscale identity header -> 200
    const tailscaleResp = await fetch(`${baseUrl}/v1/models`, {
      headers: { "tailscale-user-login": "user@tailnet" },
    });
    assert.equal(tailscaleResp.status, 200);
  } finally {
    const closeGate = Promise.withResolvers<void>();
    server.close(() => closeGate.resolve());
    await closeGate.promise;
  }
});
