---
name: local-model-router
description: "Operate and inspect the local model inference router across home fleet devices (DGX Sparks, Windows 5090/4090, local boxes). Use when configuring local model providers, diagnosing fleet bottlenecks, checking Pi-grain inference latency, or verifying fail-fast routing."
---

# Local Model Router

Operate and inspect the local model router serving the user's home fleet (`spark0`, `spark1`, `emo-win`).

The router exposes a standard OpenAI-compatible inference API over the tailnet. The model ID is an exact contract (weights, quantization, context window, and generation semantics); placement across physical machines is completely invisible to callers.

## Core Guarantees

1. **Exact Model Contract:** Specifying a model ID (e.g. `qwen3.8-27b`, `qwen3.8-next-flash`) guarantees identical model weights, precision, and context capacity on whichever fleet machine serves it.
2. **Invisible Placement:** Callers never choose or see machine names or internal IPs in requests or responses.
3. **Bounded Capacity Wait (429):** Each Spark admits at most four active requests. A request waits up to 30 seconds when all slots are busy, then returns HTTP 429. The router accepts only one generation per request (`n=1`).
4. **Unavailable Models (503):** Models not loaded on any reachable box return HTTP 503. Startup and five-second health probes check each backend model list. Cancellation holds a slot until the upstream stream has stopped.
5. **Pi-Grain Operator Diagnostics:** Stage-level metrics (TTFT, decode duration, tokens/sec, prompt/completion tokens, cache hit) and placement provenance are recorded for operators without leaking to callers.

## Source and Service

Author runtime changes in `~/dev/agent-plugins/plugins/local-model-router/`.
The old `~/dev/skills/plugins/local-model-router/` runtime path was removed.
Author this skill in `~/dev/skills/skills/local-model-router/SKILL.md`; the
plugin skill file is its distribution copy.

Studio runs the router with the `com.herdr.local-model-router` launch agent.
Chezmoi owns its launch-agent template and `~/.config/local-model-router/config.json`.
The `ornith` model uses the same NVFP4 weights and 262144-token context on both
Sparks. Missing or malformed explicit config files stop startup.

## CLI Commands

Start the router daemon:
```sh
bun "$HOME/dev/agent-plugins/plugins/local-model-router/src/cli.ts" start --config "$HOME/.config/local-model-router/config.json" --port 8080 --host 0.0.0.0
```

Inspect fleet status:
```sh
bun "$HOME/dev/agent-plugins/plugins/local-model-router/src/cli.ts" status
# or JSON format
bun "$HOME/dev/agent-plugins/plugins/local-model-router/src/cli.ts" status --json
```

Inspect Pi-grain inference telemetry:
```sh
bun "$HOME/dev/agent-plugins/plugins/local-model-router/src/cli.ts" stats --limit 20
# filter by session
bun "$HOME/dev/agent-plugins/plugins/local-model-router/src/cli.ts" stats --session <session-id>
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
  local-model-router:
    baseUrl: http://studio:8080/v1
    api: openai-completions
    auth: none
    discovery:
      type: openai-models-list
    modelOverrides:
      ornith:
        name: Ornith 1.5 35B A3B (NVFP4)
        reasoning: true
        thinking:
          mode: effort
          efforts: [high]
          defaultLevel: high
        input: [text]
        supportsTools: true
        contextWindow: 262144
        maxTokens: 32768
        compat:
          maxTokensField: max_tokens
          supportsStore: false
          supportsDeveloperRole: false
          supportsReasoningEffort: false
          thinkingFormat: qwen-chat-template
          requiresReasoningContentForToolCalls: true
```
