---
date: 2026-09-16
topic: local-model-router
status: draft
source_vibe: docs/prds/2026-09-02-local-model-router/vibe.md
---

# Local Model Router PRD

## Glossary

- **Caller**: An authenticated agent, tool, or user requesting model inference over the network.
- **Model id**: The exact model identifier specified in the request (e.g., `qwen3.8-27b`, `qwen3.8-next-flash`). The sole routing choice the caller makes.
- **Box**: An individual physical machine or server in the local/tailnet fleet capable of hosting model execution backends (e.g., `spark0`, `spark1`, `emo-win`). Callers never name or select boxes.
- **Fleet**: The set of local and tailnet machines hosting inference engines behind the router, with differing memory, GPU architecture, context limits, and concurrency capabilities.
- **Exact model contract**: The invariant guarantee that a given model id delivers identical weights, quantization, context limit, and generation semantics regardless of which box serves the request.
- **Pi-grain stats**: Detailed operational metrics covering wall-clock duration, prefill time, generation time, reasoning tokens, tool overhead, compaction, prompt/completion token counts, and queue/placement timing.
- **Fail-fast capacity error**: An immediate, retryable HTTP 429 error returned when all suitable boxes are at concurrent capacity, avoiding unbounded queueing.
- **Fail-fast unavailable error**: An immediate HTTP 503 error returned when a requested model is recognized but not currently loaded or reachable on any box in the fleet.
- **Fair responsiveness**: Routing discipline that prevents any single caller, session, or long-context burst from monopolizing fleet resources, ensuring all active callers receive timely turns.

## North Star

Any authenticated tailnet agent or tool can use local hardware across the user's home fleet through an ordinary OpenAI-compatible inference API. The caller specifies only the model id, which represents an exact, dependable model contract with identical weights, quantization, context capacity, and generation semantics regardless of placement. Placement across boxes remains completely invisible to callers. The router manages cache locality, concurrency limits, and fair responsiveness. When the fleet is saturated or a model is not loaded, it fails fast with standard provider-shaped error codes rather than hanging or truncating output. For the operator, every request preserves full placement provenance and Pi-grain execution metrics, inspectable in the harness session view and linked fleet diagnostics.

## Source Vibe Summary

- **Ideal reality**: A normal inference provider API over the tailnet backed by the user's home fleet (2× DGX Sparks, Windows 5090, Windows 4090), balancing throughput and cache locality while providing fair responsiveness, zero caller-side box awareness, and transparent Pi-grain operator diagnostics.
- **Feel promises**: Normal provider surface (V1), exact model id contract with invisible placement (V2), honest fail-fast capacity without silent truncation (V3), fair responsiveness as the system's problem (V4), Pi-grain stats and placement provenance for operators (V5), and open access for all authenticated tailnet identities (V6).
- **Anti-vibes**: Fleet console APIs, box-pinning request parameters, silent model substitution, silent context truncation, infinite request queueing, unloaded models pretending readiness, agent-side load balancing, caller starvation, caller-visible placement leaks, and disconnected diagnostics.

## Users And Jobs

- **Authenticated Tailnet Agent / Tool**: Issue standard chat completions and embedding calls without learning fleet topology, configuring machine-specific endpoints, or adapting to proprietary routing protocols.
- **Human Operator / Developer**: Monitor multi-hour autonomous sessions with Pi-grain stage breakdowns (prefill, generation, reasoning, tools, compaction), diagnose throughput bottlenecks, trace exact placement provenance, and manage model deployments across machines.

## Product Shape

- **Entry points**: Standard HTTP OpenAI-compatible endpoint (e.g., `POST /v1/chat/completions`, `GET /v1/models`) exposed over the tailnet and localhost.
- **Core flow**: Authenticated caller sends standard completion request with a model id -> Router verifies tailnet identity -> Router matches model id to active box backends satisfying the exact contract -> Router checks concurrency slots and cache affinity -> Forwards request or fails fast with 429/503 -> Streams response tokens to caller -> Emits Pi-grain stage timings and placement provenance to operator telemetry.
- **Required surfaces**:
  1. Headless router service executable on the local network / tailnet.
  2. Fleet configuration defining known boxes, backends (e.g., vLLM, SGLang, Ollama, llama.cpp), and served model contracts.
  3. Operator CLI and diagnostic inspection endpoints (`/v1/router/status`, `/v1/router/stats`).
  4. Client configuration presets for native Pi and OMP harness profiles.
- **Data visibility expectations**: Callers observe strictly standard OpenAI-compatible response payloads and error bodies. Server hostnames, GPU device IDs, internal IPs, and cluster queue mechanics are completely omitted from caller responses and surfaced exclusively in operator diagnostics.

## Requirements

### R1. Normal provider API over tailnet

- Requirement: The router must expose standard OpenAI-compatible endpoints (`/v1/chat/completions`, `/v1/models`) over the tailnet, accepting standard headers, parameters, and streaming formats.
- Rationale: Agents and tools should integrate with zero specialized client code, treating the local fleet like any cloud provider.
- Acceptance: Pointing an unmodified OpenAI SDK or harness provider client (Pi, OMP, Codex, Claude) to the router base URL allows listing models and completing streaming chat requests without custom headers or request wrappers.
- Not acceptable: Custom request schemas, proprietary RPC formats, or requiring client-side routing libraries.

### R2. Exact model id contract

- Requirement: The model id requested by the caller represents an exact contract specifying weights, quantization, maximum context window, and generation semantics. The router must guarantee that every placement serving that model id satisfies this exact contract.
- Rationale: Silent substitution of smaller quantizations or shorter context windows damages agent reasoning unpredictably.
- Acceptance: Dispatching the same model id across different boxes in the fleet yields identical model architecture, quantization precision, and advertised context length.
- Not acceptable: Silently falling back to a lower-bit quantization, smaller parameter size, or reduced context window to force a request to fit on an available box.

### R3. Invisible placement for callers

- Requirement: Placement of requests across boxes and GPUs must remain completely invisible to callers. Callers must never be required or permitted to specify a box, hostname, or device in request bodies or headers.
- Rationale: Callers should focus on task execution rather than infrastructure topology or device management.
- Acceptance: Requests contain only standard provider parameters (`model`, `messages`, `temperature`, etc.). Responses, response headers, and caller-visible error messages contain no hostname, IP address, or device identifier.
- Not acceptable: Exposing `x-box-id` headers, machine-pinning parameters, or error messages revealing internal cluster layout to callers.

### R4. Honest fail-fast capacity and availability

- Requirement: When all backend slots capable of serving a requested model are saturated, the router must immediately return an HTTP 429 error with a standard retryable capacity payload. When a requested model is valid in the catalog but not currently loaded on any reachable box, the router must immediately return an HTTP 503 unavailable error.
- Rationale: Long uncommunicated queueing stalls agent workflows, and silent truncation damages reasoning output.
- Acceptance: Subjecting a single-slot backend to concurrent requests results in immediate 429 for excess calls; requesting an offline/unloaded model results in immediate 503. Output is never silently truncated.
- Not acceptable: Queuing requests indefinitely without client consent, returning truncated text as a successful completion, or reporting a capacity exhaustion as a 200 OK.

### R5. Fair responsiveness and capacity management

- Requirement: The router must balance requests across suitable boxes to maximize throughput and prompt cache hits, while enforcing fair responsiveness among active callers so no single session or agent starves others.
- Rationale: Multiple agents running parallel tasks must not lose responsiveness because one agent launched a massive prompt burst.
- Acceptance: When multiple callers generate tokens concurrently, request scheduling ensures all callers make forward progress without starvation.
- Not acceptable: FIFO queueing that lets a single batch job monopolize all GPU slots while interactive callers hang.

### R6. Operator diagnostics with Pi-grain stats and placement provenance

- Requirement: The router must record Pi-grain execution metrics (wall-clock, prefill duration, generation duration, reasoning tokens, token counts, queue wait, and cache hit state) alongside exact placement provenance for every request. These metrics must be accessible to operators via diagnostic endpoints and harness session links.
- Rationale: Operators need to identify bottlenecks across multi-hour autonomous sessions without exposing internal fleet details to agent callers.
- Acceptance: Querying the operator diagnostics endpoint returns per-request records detailing the serving box, prefill/decode timing, token speeds, and cache status, correlated with the harness session ID.
- Not acceptable: Coarse single-number latency metrics, missing placement provenance in diagnostics, or mixing operator telemetry into caller-facing responses.

### R7. Tailnet access follows authentication, not caller category

- Requirement: Any authenticated identity on the tailnet must be permitted to invoke the router. Access must not depend on belonging to a special agent class, tool allowlist, or human-only roster.
- Rationale: All authorized tools and agents operating on the tailnet should have equal access to fleet inference.
- Acceptance: Requests originating from any authenticated tailnet node (via Tailscale identity verification or bearer token) are accepted without caller-type restrictions.
- Not acceptable: Requiring per-agent identity registration, agent-type filtering, or anonymous unauthenticated access.

### R8. Local harness provider configuration

- Requirement: The package must provide ready-to-use configuration templates and presets for Pi and OMP harnesses, mapping local fleet models into standard provider configurations.
- Rationale: Setting up local inference on a workstation should be a single configuration step.
- Acceptance: Adding the provided configuration to `~/.omp/agent/models.yml` or Pi settings enables immediate invocation of local fleet models.
- Not acceptable: Requiring manual URL assembly or proprietary proxy bridges in each harness.

## Undesirable Outcomes

| Outcome | Decision | Requirement |
| --- | --- | --- |
| Caller must select or name a physical machine | Forbidden | R1, R3 |
| Model ID silently serves lower quantization or smaller context | Forbidden | R2 |
| Saturated fleet queues requests indefinitely | Forbidden | R4 |
| Router truncates prompt or completion to fit available VRAM | Forbidden | R4 |
| Valid but unloaded model claims readiness or hangs | Forbidden | R4 |
| Single agent monopolizes fleet, starving other callers | Forbidden | R5 |
| Caller responses leak internal machine names or IP addresses | Forbidden | R3, R6 |
| Telemetry lacks Pi-grain breakdown or placement provenance | Forbidden | R6 |
| Unauthenticated callers can issue inference | Forbidden | R7 |
| Non-standard client library required for callers | Forbidden | R1 |

## Scope Boundaries

### In Scope

- Unified OpenAI-compatible chat completions proxy (`/v1/chat/completions`) and model catalog (`/v1/models`).
- Multi-box fleet routing across DGX Sparks (`spark0`, `spark1`), Windows GPUs (`emo-win`), and local workstations.
- Exact model ID matching and placement engine with concurrency slot tracking.
- Fail-fast HTTP 429 (capacity) and 503 (unavailable) error emission.
- Prompt cache affinity and fair responsiveness scheduling.
- Operator telemetry endpoint and Pi-grain execution metrics logging.
- Client configurations for OMP and Pi.

### Out Of Scope

- Managing raw GPU driver installations, CUDA updates, or OS provisioning on fleet nodes.
- Training or fine-tuning models.
- Commercial billing, metering, or tenant credit balances.
- Proprietary non-OpenAI protocols (Anthropic messages API translation is deferred to a companion adapter).

### Explicitly Deferred

- Automatic remote model spinning / cold-start orchestration (starting vLLM on demand via SSH/API). Current behavior expects target backends to be running or report unavailable.
- Streaming audio / speech / multi-modal generation pipelines beyond standard image input for vision models.

## Success Criteria

- An unmodified agent using standard OpenAI client configuration points to `http://<router-host>:port/v1` and successfully generates completions from local fleet models.
- Requesting an active model ID delivers identical generation precision and context capacity across different serving nodes.
- Inducing fleet saturation returns immediate 429 capacity errors rather than unbounded hanging.
- Requesting an offline model returns immediate 503 unavailable.
- Operator diagnostics display complete Pi-grain stage timings (prefill, decode, tokens/sec) and serving box identity for every completed request.
- Caller response payloads contain no box names, IP addresses, or internal routing artifacts.

## Technical Questions Deferred To Spec

- Exact load balancing strategy (e.g., least-connections with prefix-cache hash routing vs. weighted round-robin).
- Tailscale identity extraction mechanism (e.g., `tailscale whois` on socket connection vs. shared tailnet pre-shared key / token).
- Backend engine protocol support (vLLM native API vs. generic OpenAI-compatible backends).
- Pi-grain telemetry storage format (SQLite local event store vs. memory-ring buffer with JSON export).

## Approval

- Approved by: Pending user review
- Approved on:
- Amendment rule: This PRD changes only by explicit user request or direct user edit.
