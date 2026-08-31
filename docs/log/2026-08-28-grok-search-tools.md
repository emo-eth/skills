# Grok Search Native Tools

## Glossary

- **Tool extension**: a native Pi or OMP package that registers model-callable tools.
- **Host seam**: the native `registerTool` callback used by both adapters.
- **Runner**: the shared TypeScript implementation that executes the bundled Python CLI without a shell.
- **Source mode**: a search response containing raw source material for the calling model to synthesize.
- **Degraded result**: a narrowed search that returned no citations and may reflect model memory instead of live sources.

## Contract

`skills/grok-search/` is both a model-invoked skill and an installable Pi/OMP Agent Plugin. Its agent-facing interface is X-only and registers two tools:

- `grok_search`: X/Twitter search. `response: "sources"` is the default; `response: "answer"` requests Grok synthesis from X results. The interface has no source selector or web-domain filters.
- `grok_fetch`: one X post or thread by URL.

No native web-search or plain-inference tool is registered. Agents use the native tools rather than invoking the bundled Python implementation directly. Authentication, login, logout, and model listing remain CLI-only administration.

Both tools return the implementation's structured `{ model, answer, citations, degraded }` result.

## Implementation

`src/host.ts` owns registration, argument validation, CLI argument construction, process execution, cancellation, error translation, and response validation. `src/pi.ts` and `src/omp.ts` are thin native adapters. The runner uses `execFile("python3", [scriptPath, ...args])`; user input never crosses a shell parser. The package is self-contained: adapters resolve `scripts/grok-search.py` relative to their installed directory.

Credentials stay in the existing CLI stores or `XAI_API_KEY`; tool inputs and results never contain bearer or refresh tokens. Each invocation still consumes the user's xAI API credits or Grok subscription quota.

## Focused proof

- `npm run check`: TypeScript passed.
- `npm run test:node`: 7 tests passed, covering both adapters, the exact two-tool registry, absence of `grok_prompt`, the X-only search schema and CLI mapping, fetch mapping, structured output parsing, and host cancellation.
- `npm run test:pi-runner`: Pi 0.84.1 loaded the native adapter, exposed only `grok_search` and `grok_fetch`, rejected lookup of `grok_prompt`, and executed `grok_search` through a deterministic fake executable.
- `npm run test:omp-runner`: OMP 17.2.15 loaded the native adapter, exposed only `grok_search` and `grok_fetch`, rejected lookup of `grok_prompt`, and executed `grok_search` through a deterministic fake executable.

## Live host proof

OMP 18.0.5 started a clean non-interactive process with only the changed `src/omp.ts`, `grok_search`, and `grok_fetch` enabled. A real X-only `grok_search` call through the bundled implementation and existing Grok OAuth returned five `x.com/i/status/...` citations with `degraded: false`.

OMP code mode used JavaScript eval to call `await tool.grok_fetch(...)` for one of those X posts. The nested fetch completed through the same native tool seam and returned the post's cited media URL. The eval bridge exposes only the two tools registered by this package; it cannot recover removed web-search or plain-inference capabilities.

Commit `5eeaabf` was pushed to `origin/main` and the stable local `main` checkout was reinstalled into the default OMP profile and Pi user package list. A fresh OMP 18.0.5 process rejected `grok_prompt` as an unknown tool; its runtime-generated valid-tool list contained `grok_search` and `grok_fetch` only.

GAP: global Pi 0.84.3 has no authenticated calling model, so a live provider-level Pi invocation cannot run. The pinned Pi 0.84.1 native-runner proof covers real extension loading, the exact X-only registry, and tool execution without claiming provider-level behavior.

