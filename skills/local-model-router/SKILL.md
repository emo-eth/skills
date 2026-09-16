---
name: local-model-router
description: "Operate and inspect the local model inference router across home fleet devices (DGX Sparks, Windows 5090/4090, local boxes). Use when configuring local model providers, diagnosing fleet bottlenecks, checking Pi-grain inference latency, or verifying fail-fast routing."
---

# Local Model Router

Operate and inspect the local model router serving the user's home fleet (`spark0`, `spark1`, `emo-win`, `localhost`).

The router exposes a standard OpenAI-compatible inference API over the tailnet. The model ID is an exact contract (weights, quantization, context window, and generation semantics); placement across physical machines is completely invisible to callers.

## Core Guarantees

1. **Exact Model Contract:** Specifying a model ID (e.g. `qwen3.8-27b`, `qwen3.8-next-flash`) guarantees identical model weights, precision, and context capacity on whichever fleet machine serves it.
2. **Invisible Placement:** Callers never choose or see machine names or internal IPs in requests or responses.
3. **Fail-Fast Capacity (429):** Saturated backends immediately return HTTP 429 rather than hanging or queueing indefinitely.
4. **Fail-Fast Unavailability (503):** Models not loaded on any reachable box immediately return HTTP 503.
5. **Pi-Grain Operator Diagnostics:** Stage-level metrics (TTFT, decode duration, tokens/sec, prompt/completion tokens, cache hit) and placement provenance are recorded for operators without leaking to callers.

## CLI Commands

Start the router daemon:
```sh
local-model-router start --port 8080 --host 0.0.0.0
```

Inspect fleet status:
```sh
local-model-router status
# or JSON format
local-model-router status --json
```

Inspect Pi-grain inference telemetry:
```sh
local-model-router stats --limit 20
# filter by session
local-model-router stats --session <session-id>
```

## Tools and Commands

When the plugin is loaded in Pi or OMP:
- **`router_status` tool:** Query active concurrency slots, healthy boxes, and loaded models.
- **`router_stats` tool:** Retrieve recent Pi-grain inference metrics and placement provenance.
- **`/router` slash command:** Quick interactive status check from the harness.

## Harness Configuration

To point OMP to the router, add this provider block in `~/.omp/agent/models.yml`:
```yaml
providers:
  local-fleet:
    baseUrl: http://127.0.0.1:8080/v1
    apiKey: local-fleet-token
    api: openai-completions
    models:
      - id: qwen3.8-27b
        name: Qwen 3.8 27B (FP8)
        contextWindow: 131072
        reasoning: true
      - id: qwen3.8-next-flash
        name: Qwen 3.8 Next Flash (BF16)
        contextWindow: 262144
```
