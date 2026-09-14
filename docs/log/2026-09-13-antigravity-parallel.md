# Parallel Gemini without model fallback

## Scope and corrections

The user requested many parallel Gemini subagents without fallback. This change keeps native OMP task execution and stock Cloud Code Assist transport; it does not serialize workers, change thinking levels, introduce a proxy, or modify installed OMP source.

Earlier conversation claims of a Google 1–2-stream account limit, a 9.6-second gateway queue, tighter 3.7 quotas, and Google's harness serializing subagents were unsupported and are withdrawn. Request duration alone cannot establish the server's scheduling. The installed native transport can itself spend seven seconds in exponential retry sleeps (1 + 2 + 4 seconds). Generic `RESOURCE_EXHAUSTED` does not identify the underlying cause or establish a quota reset time; OMP's 30-minute backoff can be a heuristic, not a provider promise. Prior assertions that all these errors were fixed by a single successful smoke were too broad.

## Changes

- `plugins/antigravity-prompt/` v0.2.0 retains the exact system-prompt rewrite and original tools, OAuth handling and stock model metadata.
- Removed the process-wide initialization guard. Real `ModelRegistry.syncExtensionSources([])` removes the provider registration before a child starts; an independent source ID alone does not preserve it. Each `session_start` must restore registration and select the wrapped current model. Already-wrapped models do not replace cached stock originals.
- Added a per-stream fetch wrapper for native Gemini generation POSTs on the existing daily/sandbox endpoints. It adds at most three retries, with jittered waits of 2–4, 4–8 and 8–16 seconds, shared across that stream's stock transport attempts. There is no shared queue or concurrency limit.
- Only the exact unspecified HTTP 429 JSON body qualifies. Explicit retry/reset headers, structured details, quota messages, non-generation calls, non-replayable request bodies and non-429 errors pass through unchanged. Successful SSE bodies are not consumed; streamed errors are not replayed. Cancellation and the caller's retry-delay ceiling remain effective.
- Added empty fallback chains for `google-antigravity/gemini-3.7-flash` and `google-antigravity/gemini-3.8-flash` in the normal local OMP config. Native fallback resolution verified no candidates for either model across parent/worker roles. A parsed comparison with the pre-change config confirmed all other settings unchanged, including the existing 32-task ceiling. The same two-key overlay ships as `gemini-no-fallback.yml` for explicit use elsewhere.

The package remains globally linked from this worktree using OMP's user-scope plugin mechanism. Existing processes must be restarted to load the new source and configuration. No other machine was changed or verified.

## Verification

Development dependencies remain pinned to OMP 18.1.16; live CLI checks used OMP 18.1.20. No formatter, linter or repository-wide test suite ran.

Commands from `plugins/antigravity-prompt/`:

```sh
npm run check
bun test ./tests/prompt-fix.test.ts ./tests/retry-fetch.test.ts ./tests/native-retry.test.ts ./tests/registration.test.ts
```

Final result: typecheck passed; 12 tests passed. The native transport regression returns six synthetic generic rejections: stock transport exhausts after five HTTP attempts, while the wrapped transport succeeds on attempt seven and emits exactly one native tool call on the same Gemini model. The registry regression exercises three child cleanup/start cycles. Other tests cover retry exhaustion with original error preservation, explicit quota/timing signals, cancellation, independent eight-way requests, and successful stream pass-through.

Live traces use UTC timestamps on September 14 (local session date September 13):

| Scenario | Observed result | Durable evidence |
| --- | --- | --- |
| Pre-change 3.8 baseline, eight native mixed scout/task workers, fallback disabled | Eight successful workers, two reads and yield each; peak eight overlapping assistant request intervals | `~/.omp/agent/sessions/-.herdr-worktrees-skills-omp-antigravity-native-subagents/2026-09-14T06-22-11-529Z_01a09e94-9049-70d9-a9fa-832635ffb55e/ParallelBaseline38*.jsonl` |
| Pre-change 3.7 baseline, same shape | Eight successful workers; peak eight overlapping intervals | Same session root, `2026-09-14T06-23-31-411Z_01a09e95-c853-71b3-b77b-43eab53a171c/ParallelBaseline37*.jsonl` |
| Current-source injected-fault run, eight mixed 3.7 scouts/3.8 tasks | All eight completed two reads and yield; no parent/child fallback; 37 distinct injected 429s across the process were followed by HTTP 200; peak eight worker request intervals | Same session root, `2026-09-14T06-37-58-521Z_01a09ea3-0379-73a2-b7f9-59594f6f268e/ParallelRecovery*.jsonl`; `~/.local/state/omp-antigravity-prompt/injected-429-v2-events.jsonl` |
| Current-source global smoke in a separate directory, normal global roles/settings, no `--extension`, `--config` or `--system-prompt` | Single native task call spawned sixteen workers: eight 3.7 scouts, eight 3.8 tasks. All 32 reads and 16 yields succeeded, with sixteen overlapping worker request intervals and no parent/child errors or fallback | `~/.omp/agent/sessions/-.local-state-omp-antigravity-prompt-parallel-check/2026-09-14T06-39-32-633Z_01a09ea4-7319-76e7-862f-2b5654b3ca53.jsonl` and child directory; `~/.local/state/omp-antigravity-prompt/parallel-verified-summary.json` |

The injected run used a temporary additional extension confined to its fresh test process; it was not globally installed. Its log contains only request hashes, wire-model names, status codes and timestamps, not prompts or credentials.

## Actual failures and boundaries

- A separate native task in the pre-existing implementation session failed with the exact generic 429. The successful baselines did not disprove the intermittent report.
- The first injected run failed: the test extension reinstalled its global fetch wrapper for each child, stacking synthetic failures. That test was corrected to install once per process; its failure is not Google capacity evidence. Investigation also exposed the production registration guard described above, which is independently reproduced by the real-registry regression.
- Initial focused typecheck failures (fetch `preconnect` typing and `bun:test` typings) were fixed. The deliberate native-backoff test initially exceeded Bun's five-second default; it now has an explicit 30-second test timeout and passes in approximately ten seconds.
- Finite retries cannot guarantee service under genuine quota exhaustion or persistent rejection. Such failures still surface honestly, rather than switching these configured Gemini models to another model. The plugin does not manufacture short retry hints, alter quota state or claim to bypass account limits.
- Sixteen-way success and injected recovery are evidence for these scenarios, not a claim of unlimited provider capacity or a guarantee that every future generic 429 is transient. Explicitly configured alternative accounts and OMP's existing account-selection policy are unchanged.
