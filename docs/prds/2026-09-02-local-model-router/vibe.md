---
date: 2026-09-02
topic: local-model-router
status: draft
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

The local model router should feel like a normal inference provider that happens to be backed by the user's own fleet. Callers send ordinary requests with a model id; something fast and correct comes back. Which box ran the work stays invisible. Capacity, cache, and parallelism are the system's problem. When things are slow or stuck, bottlenecks are namable in Pi-grain detail across a whole session — not a single opaque "it's slow."

## Ideal Reality Dump

- Wishlist: "local model router. N devices, one API that balances requests + optimizes cache hits and throughput."
- Fleet today: 2 DGX Sparks, a Windows 5090, a Windows 4090 — different speeds, context windows, parallel connection limits.
- "blind api models hit."
- "it should work like a normal inference provider api. normal. truncation is not normal."
- Callers never pin a machine — "that's not how llm provider apis work."
- Model ids are real and distinct (qwen3.8-27b, qwen3.8-next-flash, etc.).
- Intelligent routing should avoid capacity disasters; do not put weirdly specific box sermons in the vibe.
- Wants Pi-grain stats especially for local models, inspectable over the course of a session (multiple look-ins), to monitor performance and bottlenecks. Unsettled whether that is recorded at inference, aggregator, or harness level.

## Use Circumstances

- An agent on the tailnet needs local inference and should not care which box is free.
- Several agents call at once; some boxes can take parallel generation and some cannot.
- A long-horizon run (hours) where the user wants to see where time went: prefill vs generation vs tools vs compaction.
- The user compares model ids for speed or quality without learning fleet topology.
- A request would not fit or would thrash a small box; the system should route so this is not the caller's problem.

## Vibe Clauses

### V1. Normal provider, not a fleet console

- Promise: To the caller, this is an ordinary LLM inference API.
- Example: The caller sends a model id and usual generation params and gets a normal completion stream or response — the same mental model as any hosted provider.
- Does not mean: The router exposes every fleet knob, or that ops dashboards cannot exist for the human.
- Violation: The caller must pick a machine, learn box topology, or use a nonstandard API shape to get local inference.
- Check: An agent configured for a generic OpenAI-compatible (or equivalent) provider works against the router by changing base URL and model ids only.

### V2. Model id is the only placement choice

- Promise: Placement across boxes is invisible; the only name the caller chooses is the model.
- Example: Two callers request the same model id; the router may land them on different boxes without either caller knowing or caring.
- Does not mean: All model ids exist on every box, or that every box offers identical underlying weights forever without the system owning that problem.
- Violation: Request fields, headers, or errors require naming a host, GPU, or device.
- Check: Search the caller-facing API and errors for any required machine identifier. There should be none.

### V3. Correctness over clever truncation

- Promise: Responses should feel like a normal provider: complete within the requested contract, not silently shortened to "make it fit."
- Example: If the fleet cannot serve the request as asked, the failure is honest and actionable rather than a quietly truncated completion presented as success.
- Does not mean: Infinite context, or that the caller never has to pick a smaller model id.
- Violation: The router truncates context or output to hide a capacity miss while returning a success-shaped result.
- Check: Under tight memory or context pressure, observe whether the caller gets a clear failure or a silently damaged success.

### V4. Capacity is the system's problem

- Promise: Balancing load, cache hits, throughput, and parallel slots across unequal boxes is the router's job, not a puzzle for each agent.
- Example: A burst of parallel generations lands on boxes that can take them; a long-context job avoids a box that cannot hold it — without the caller coordinating.
- Does not mean: Magic infinite parallelism, or that the user never looks at fleet health.
- Violation: Agents invent their own shard of the fleet, pin boxes "to be safe," or routinely fail for reasons that are really placement mistakes.
- Check: With multiple concurrent callers and mixed model ids, the human should not need to manually assign boxes for ordinary success.

### V5. Bottlenecks are namable across a session

- Promise: Performance problems can be inspected in Pi-grain detail over the life of a session, not only as one end-of-run blob.
- Example: A timeline that separates prefill, generation, reasoning, tools, and compaction, with token totals, so "slow" becomes a specific stage.
- Does not mean: The caller must consume these stats on every request, or that the recording locus (inference vs aggregator vs harness) is settled in this vibe.
- Violation: The only signal is a single latency number, or stats exist only for cloud providers and not local models.
- Check: During a multi-hour local run, the user can inspect stage-level time and tokens at more than one point in the session.

## Anti-Vibes

| Anti-vibe | Why it violates the contract | Clause |
| --- | --- | --- |
| Fleet console API | Caller has to think in boxes, GPUs, or hosts | V1, V2 |
| Pin-this-box knobs | Breaks "normal provider" and leaks topology | V2 |
| Silent truncation | Looks successful while damaging the answer | V3 |
| Agent-side load balancing | Every agent re-solves placement | V4 |
| Single "latency" number | Cannot find the real bottleneck | V5 |
| Local models are opaque | Cloud gets telemetry; home fleet does not | V5 |

## Success Signals

- Agents point at one base URL and model ids; they never configure per-box endpoints for ordinary work.
- Cache-friendly and throughput-friendly placement happens without caller coordination.
- Capacity misses fail honestly rather than returning truncated successes.
- A long local session can be diagnosed with Pi-grain stage breakdowns at multiple checkpoints.

## Scope Boundaries

- This vibe is the local/tailnet model router feel contract. It is not a voice stack, herdr remote, wiki-brain, or session-history product.
- Exact recording locus for Pi-grain stats (inference vs aggregator vs harness) is intentionally open.
- Exact wait-vs-reject behavior when the fleet is saturated is not fully settled; whatever ships must still feel like a normal provider, not a custom cluster API.
- Specific box hardware limits are fleet facts, not vibe clauses.

## Open Questions

- When the fleet is saturated for a model id, what should the caller feel: wait, queue position, or a normal busy/error — as long as it stays provider-shaped?
- Must same model id mean bit-identical behavior across boxes, or is "same model family, best available placement" enough if quality differences are rare and honest?
- Where are Pi-grain stats recorded and served from?

## Approval

- Approved by: pending
- Approved on: pending
- Amendment rule: This vibe changes only by explicit user request or direct user edit.
