#!/usr/bin/env node
import { loadRouterConfig } from "./config.ts";
import { ModelRouter } from "./router.ts";
import { createRouterServer } from "./server.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "status";

  if (command === "start") {
    let configPath: string | undefined;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--config" && args[i + 1]) {
        configPath = args[i + 1];
        i++;
      }
    }

    const config = loadRouterConfig(configPath);
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--port" && args[i + 1]) {
        config.port = parseInt(args[i + 1], 10);
        i++;
      }
      if (args[i] === "--host" && args[i + 1]) {
        config.host = args[i + 1];
        i++;
      }
    }

    const router = new ModelRouter(config);
    const server = createRouterServer(router);

    server.listen(config.port, config.host, () => {
      console.log(`[local-model-router] Listening on http://${config.host}:${config.port}`);
      console.log(`[local-model-router] Available models: ${router.getModels().map((m) => m.id).join(", ")}`);
      console.log(`[local-model-router] Registered fleet boxes: ${config.boxes.map((b) => b.name).join(", ")}`);
    });
    return;
  }

  if (command === "status") {
    const isJson = args.includes("--json");
    let targetUrl = "http://127.0.0.1:8080";
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--url" && args[i + 1]) {
        targetUrl = args[i + 1];
        i++;
      }
    }

    try {
      const resp = await fetch(`${targetUrl.replace(/\/+$/, "")}/v1/router/status`);
      if (!resp.ok) {
        console.error(`Error: Router status check failed with HTTP ${resp.status}`);
        process.exit(1);
      }
      const data = await resp.json();
      if (isJson) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(`=== Local Model Router Status: ${data.status.toUpperCase()} (v${data.version}) ===`);
        console.log(`Active requests: ${data.activeRequests} | Completed: ${data.totalCompletedRequests}`);
        console.log("\nFleet boxes:");
        for (const box of data.fleet) {
          const healthSymbol = box.healthy ? "✓" : "✗";
          console.log(`  ${healthSymbol} ${box.name} (${box.id}): slots ${box.activeSlots}/${box.maxConcurrency}`);
        }
        console.log("\nModels:");
        for (const model of data.models) {
          console.log(`  - ${model.id} (${model.contract.quantization}, ctx: ${model.contract.contextWindow}) -> [${model.availablePlacements.join(", ")}]`);
        }
      }
    } catch (err) {
      console.error(`Failed to connect to router at ${targetUrl}: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  if (command === "stats") {
    const isJson = args.includes("--json");
    let targetUrl = "http://127.0.0.1:8080";
    let limit = 20;
    let sessionId: string | undefined;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--url" && args[i + 1]) {
        targetUrl = args[i + 1];
        i++;
      }
      if (args[i] === "--limit" && args[i + 1]) {
        limit = parseInt(args[i + 1], 10);
        i++;
      }
      if (args[i] === "--session" && args[i + 1]) {
        sessionId = args[i + 1];
        i++;
      }
    }

    try {
      const url = new URL(`${targetUrl.replace(/\/+$/, "")}/v1/router/stats`);
      url.searchParams.set("limit", limit.toString());
      if (sessionId) url.searchParams.set("session_id", sessionId);

      const resp = await fetch(url.toString());
      if (!resp.ok) {
        console.error(`Error: Router stats check failed with HTTP ${resp.status}`);
        process.exit(1);
      }
      const data = await resp.json();
      if (isJson) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(`=== Recent Inference Telemetry (Pi-grain) ===`);
        for (const record of data.data) {
          const statusMark = record.status === "completed" ? "✓" : "✗";
          console.log(
            `[${record.startedAt}] ${statusMark} ${record.modelId} on ${record.servingBoxId} | TTFT: ${record.ttftMs}ms | Decode: ${record.decodeDurationMs}ms | ${record.tokensPerSecond} tok/s | Tokens: ${record.promptTokens}+${record.completionTokens}`,
          );
        }
      }
    } catch (err) {
      console.error(`Failed to connect to router at ${targetUrl}: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  console.log("Usage: local-model-router <start|status|stats> [options]");
  console.log("  start   --port <port> --host <host> --config <path>");
  console.log("  status  --url <url> [--json]");
  console.log("  stats   --url <url> --limit <n> --session <id> [--json]");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
