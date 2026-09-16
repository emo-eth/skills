import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RouterConfig, FleetBox, ModelContract, ModelPlacement } from "./types.ts";

export const DEFAULT_FLEET_BOXES: FleetBox[] = [
  {
    id: "spark0",
    name: "DGX Spark 0",
    endpoint: "http://spark0:8000/v1",
    maxConcurrency: 8,
    healthy: true,
    labels: { host: "spark0", accelerator: "dgx-spark" },
  },
  {
    id: "spark1",
    name: "DGX Spark 1",
    endpoint: "http://spark1:8000/v1",
    maxConcurrency: 8,
    healthy: true,
    labels: { host: "spark1", accelerator: "dgx-spark" },
  },
  {
    id: "emo-win",
    name: "Windows 5090/4090",
    endpoint: "http://emo-win:8000/v1",
    maxConcurrency: 4,
    healthy: true,
    labels: { host: "emo-win", accelerator: "rtx-5090" },
  },
  {
    id: "localhost",
    name: "Local Workstation",
    endpoint: "http://127.0.0.1:8000/v1",
    maxConcurrency: 2,
    healthy: true,
    labels: { host: "localhost", accelerator: "apple-silicon" },
  },
];

export const DEFAULT_MODELS: ModelContract[] = [
  {
    id: "qwen3.8-27b",
    weights: "Qwen/Qwen3.8-27B-Instruct",
    quantization: "fp8",
    contextWindow: 131072,
    maxOutputTokens: 16384,
    reasoning: true,
    capabilities: ["chat", "tools", "reasoning"],
  },
  {
    id: "qwen3.8-next-flash",
    weights: "Qwen/Qwen3.8-Next-Flash",
    quantization: "bf16",
    contextWindow: 262144,
    maxOutputTokens: 32768,
    reasoning: false,
    capabilities: ["chat", "tools"],
  },
  {
    id: "deepseek-r1-distill-qwen-32b",
    weights: "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
    quantization: "awq",
    contextWindow: 65536,
    maxOutputTokens: 16384,
    reasoning: true,
    capabilities: ["chat", "reasoning"],
  },
];

export const DEFAULT_PLACEMENTS: ModelPlacement[] = [
  { modelId: "qwen3.8-27b", boxId: "spark0", priority: 1 },
  { modelId: "qwen3.8-27b", boxId: "spark1", priority: 2 },
  { modelId: "qwen3.8-next-flash", boxId: "emo-win", priority: 1 },
  { modelId: "qwen3.8-next-flash", boxId: "spark0", priority: 2 },
  { modelId: "deepseek-r1-distill-qwen-32b", boxId: "spark1", priority: 1 },
];

export function getDefaultConfig(): RouterConfig {
  const port = process.env.LOCAL_ROUTER_PORT ? parseInt(process.env.LOCAL_ROUTER_PORT, 10) : 8080;
  const host = process.env.LOCAL_ROUTER_HOST ?? "0.0.0.0";
  const authToken = process.env.LOCAL_ROUTER_AUTH_TOKEN;

  return {
    host,
    port,
    authToken,
    tailnetOnly: process.env.LOCAL_ROUTER_TAILNET_ONLY === "true",
    boxes: [...DEFAULT_FLEET_BOXES],
    models: [...DEFAULT_MODELS],
    placements: [...DEFAULT_PLACEMENTS],
    statsMaxEntries: 1000,
  };
}

export function loadRouterConfig(customPath?: string): RouterConfig {
  const configPath = customPath ?? process.env.ROUTER_CONFIG_PATH ?? resolve(process.cwd(), "router.config.json");

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<RouterConfig>;
      const def = getDefaultConfig();
      return {
        host: parsed.host ?? def.host,
        port: parsed.port ?? def.port,
        authToken: parsed.authToken ?? def.authToken,
        tailnetOnly: parsed.tailnetOnly ?? def.tailnetOnly,
        boxes: parsed.boxes && parsed.boxes.length > 0 ? parsed.boxes : def.boxes,
        models: parsed.models && parsed.models.length > 0 ? parsed.models : def.models,
        placements: parsed.placements && parsed.placements.length > 0 ? parsed.placements : def.placements,
        statsMaxEntries: parsed.statsMaxEntries ?? def.statsMaxEntries,
      };
    } catch {
      // Fall back to default config if file cannot be read/parsed
      return getDefaultConfig();
    }
  }

  return getDefaultConfig();
}
