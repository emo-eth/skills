---
date: 2026-09-02
topic: local-model-router
status: approved
source_material: user ideal-reality dump and north-star interview (tailnet wishlist; fleet of 2 DGX Sparks + Windows 5090 + Windows 4090; Pi long-horizon stats screenshot as feel reference)
---

# Glossary

- **Caller**: An agent or tool that wants inference. Speaks to the router as it would to any normal LLM inference provider.
- **Model id**: The model name the caller puts on the request (for example `qwen3.8-27b` or `qwen3.8-next-flash`). The only routing-relevant choice the caller makes.
- **Box**: A machine in the local/tailnet fleet that can run models. Callers never name boxes.
- **Fleet**: The set of boxes behind the router (today: two DGX Sparks, a Windows box with a 5090, a Windows box with a 4090), with different speed, context, and parallel capacity.
- **Pi-grain stats**: Fine time and token breakdown of a run — wall clock, prefill, generation, reasoning, tools, compaction, token totals, and an activity timeline across a session.

# Local Model Router Vibe

## Vibe Promise

The local model router should feel like a normal inference provider backed by the user's own fleet. Any authenticated tailnet identity can call it with ordinary provider requests. The model id is an exact model contract — including weights, quantization, context, and generation semantics — while placement stays invisible to the caller. The router makes fair responsiveness, cache use, throughput, and capacity its problem. When a request cannot be served, it fails fast with an ordinary provider-shaped error rather than waiting mysteriously or returning a damaged success. The human operator can still see the whole story: a harness session view with Pi-grain end-to-end stats and links into per-request router and fleet diagnostics.

## Ideal Reality Dump

- Wishlist: "local model router. N devices, one API that balances requests + optimizes cache hits and throughput."
- Fleet today: 2 DGX Sparks, a Windows 5090, a Windows 4090 — different speeds, context windows, parallel connection limits.
- "blind api models hit."
- "it should work like a normal inference provider api. normal. truncation is not normal."
- Callers never pin a machine — "that's not how llm provider apis work."
- Model ids are real and exact contracts (qwen3.8-27b, qwen3.8-next-flash, etc.): the same id means the same weights, quantization, context behavior, and generation semantics wherever it runs.
- Any authenticated tailnet identity can make an ordinary provider call; access does not depend on being a special agent type.
- Intelligent routing should avoid capacity disasters and preserve fair responsiveness across active callers; do not put weirdly specific box sermons in the vibe.
- When the fleet is saturated, the caller gets a fast, ordinary retryable provider capacity error. A valid model that is currently unloaded fails fast as unavailable. There is no mysterious waiting, queue-position protocol, or silent truncation.
- Wants Pi-grain stats especially for local models, inspectable over the course of a session (multiple look-ins), to monitor performance and bottlenecks. The end-to-end view lives in the harness session view and links to router-request and fleet drill-downs, including placement provenance, queue and cache details, timing, tokens, and failures.

## Use Circumstances

- An authenticated agent or tool on the tailnet needs local inference and should not care which box is free.
- Several authenticated tailnet identities call at once; some boxes can take parallel generation and some cannot, but active callers still receive fair responsiveness.
- A long-horizon run (hours) where the user wants to see where time went: prefill vs generation vs tools vs compaction.
- The user compares model ids for speed or quality without learning fleet topology or wondering whether an id silently changed model behavior.
- A request would not fit or would thrash a small box; the system should route so this is not the caller's problem, and honestly report unavailable or retryable capacity when it cannot serve the request.

## Vibe Clauses

### V1. Normal provider, not a fleet console

- Promise: To the caller, this is an ordinary LLM inference API available to any authenticated tailnet identity.
- Example: The caller sends a model id and usual generation params and gets a normal completion stream or response — the same mental model as any hosted provider.
- Does not mean: The router exposes every fleet knob, permits anonymous access, or that ops dashboards cannot exist for the human.
- Violation: The caller must pick a machine, learn box topology, use a nonstandard API shape, or be a specially categorized agent to get local inference.
- Check: An authenticated tailnet identity configured for a generic OpenAI-compatible (or equivalent) provider works against the router by changing base URL and model ids only; no machine choice or agent-category exception is required.

### V2. Model id is an exact contract, not a placement hint

- Promise: Placement across boxes is invisible, and the only model choice the caller makes is the model id. The same model id means the same weights, quantization, context behavior, and generation semantics on every placement that serves it.
- Example: Two callers request the same model id; the router may land them on different boxes without either caller knowing or caring, and neither receives a silently different model contract.
- Does not mean: All model ids exist on every box, or that every box offers every model; the router owns finding a placement that honors the exact contract.
- Violation: Request fields, headers, or errors require naming a host, GPU, or device, or a box serves a different weight, quantization, context behavior, or generation semantics under an existing model id.
- Check: Request the same model id through placements that can serve it and verify the caller-facing contract remains identical, with no required machine identifier and no unannounced model variant.

### V3. Correctness and honest fail-fast capacity

- Promise: Responses should feel like a normal provider: complete within the requested contract, not silently shortened to "make it fit." Saturation fails fast with an ordinary retryable provider capacity error, while a valid model that is currently unloaded fails fast as unavailable.
- Example: A saturated fleet returns a fast retryable capacity error; a valid but unloaded model returns a fast unavailable error. Neither waits indefinitely, exposes a queue-position protocol, or returns a silently truncated completion presented as success.
- Does not mean: Infinite context, that every valid model is always loaded, or that the caller never has to retry a retryable capacity error or pick a smaller model id.
- Violation: The router truncates context or output to hide a capacity miss, leaves the caller hanging behind an opaque queue, or reports a capacity/unloaded condition as a successful completion.
- Check: Under tight memory, context, unloaded-model, and saturation conditions, observe a provider-shaped fail-fast error with the correct unavailable versus retryable-capacity meaning; never observe a silently damaged success.

### V4. Capacity is the system's problem, with fair responsiveness

- Promise: Balancing load, cache hits, throughput, parallel slots, and unequal box capabilities is the router's job. Among active callers, routing favors fair responsiveness rather than allowing one caller or workload to monopolize the fleet.
- Example: A burst of parallel generations lands on boxes that can take them; a long-context job avoids a box that cannot hold it; concurrent active callers continue receiving a fair share of responsive service without coordinating.
- Does not mean: Magic infinite parallelism, identical latency for every request, or that the user never looks at fleet health.
- Violation: Agents invent their own shard of the fleet, pin boxes "to be safe," one active caller routinely starves others, or ordinary failures are really placement mistakes.
- Check: With multiple concurrent authenticated callers and mixed model ids, compare responsiveness across active callers and confirm that no caller must manually assign boxes for ordinary success or repeatedly loses service to a monopolizing workload.

### V5. Bottlenecks are namable across a session, without exposing placement

- Promise: The human operator can inspect full per-request placement provenance and Pi-grain end-to-end performance over the life of a session, while callers never see placement. The harness session view is the end-to-end home for these stats and links to router-request and fleet drill-downs.
- Example: During a multi-hour local run, the harness session view separates prefill, generation, reasoning, tools, and compaction, shows token totals plus queue, cache, timing, and failure details, and lets the operator follow a request to the router and the serving fleet placement.
- Does not mean: The caller must consume these stats on every request, or that diagnostics replace a normal provider response.
- Violation: Callers receive box or host placement as part of ordinary inference, the operator sees only aggregate or end-of-run latency, a request has no placement provenance, or session stats are disconnected from the router request and fleet details.
- Check: At multiple points during a multi-hour local run, open the harness session view, inspect stage-level time and tokens plus queue/cache/failure data, and follow links to the relevant router request and fleet placement for each request; separately inspect ordinary caller responses and confirm they contain no placement identity.

### V6. Tailnet access follows authentication, not a special caller class

- Promise: Any authenticated identity on the tailnet may call the router through the normal provider surface.
- Example: A newly authenticated tailnet agent or tool can issue an ordinary model request without being added to a separate router-specific caller roster.
- Does not mean: Anonymous or unauthenticated callers can use the router.
- Violation: An authenticated tailnet identity is denied solely because it is not a preferred agent, tool, or machine category.
- Check: Exercise the same ordinary provider call from each supported authenticated tailnet identity class and confirm access without per-class exceptions.

## Anti-Vibes

| Anti-vibe | Why it violates the contract | Clause |
| --- | --- | --- |
| Fleet console API | Caller has to think in boxes, GPUs, or hosts | V1, V2 |
| Pin-this-box knobs | Breaks "normal provider" and leaks topology | V2 |
| Silent model substitution | Same id no longer guarantees the same model contract | V2 |
| Silent truncation | Looks successful while damaging the answer | V3 |
| Queue forever or custom overload protocol | Saturation is not a normal fail-fast provider error | V3 |
| Unloaded model pretending to be ready | A valid but unloaded model must fail fast as unavailable | V3 |
| Agent-side load balancing | Every agent re-solves placement | V4 |
| One caller monopolizes the fleet | Active callers lose fair responsiveness | V4 |
| Caller-visible placement | Leaks topology that belongs in operator diagnostics | V5 |
| Single "latency" number | Cannot find the real bottleneck | V5 |
| Disconnected diagnostics | Session, router request, and fleet facts cannot explain one another | V5 |
| Local models are opaque | Cloud gets telemetry; home fleet does not | V5 |
| Agent-type gatekeeping | Authenticated tailnet identities cannot call on equal terms | V6 |

## Success Signals

- Any authenticated tailnet identity points at one base URL and model ids; it never configures per-box endpoints or a special caller roster for ordinary work.
- The same model id preserves weights, quantization, context behavior, and generation semantics across every placement that serves it.
- Saturation produces a fast, ordinary retryable provider capacity error; a valid unloaded model produces a fast unavailable error; neither produces a truncated success or an indefinite wait.
- Cache-friendly and throughput-friendly placement happens without caller coordination, while active callers receive fair responsiveness.
- Callers never see placement, but the human operator can inspect full per-request placement provenance.
- A long local session can be diagnosed from the harness session view with Pi-grain stage breakdowns, queue/cache/timing/token/failure details, and links into router-request and fleet drill-downs at multiple checkpoints.

## Scope Boundaries

- This vibe is the local/tailnet model router feel contract. It is not a voice stack, herdr remote, wiki-brain, or session-history product.
- Specific box hardware limits are fleet facts, not vibe clauses.
- The router must preserve the provider-shaped access, model identity, fail-fast error, fairness, and linked operator-diagnostic behavior defined here; implementation choices for achieving those outcomes do not belong in this vibe.


## Approval

- Approved by: User
- Approved on: 2026-09-03
- Approval evidence: Batched north-star interview selections and explicit approval
- Amendment rule: This vibe changes only by explicit user request or direct user edit.
