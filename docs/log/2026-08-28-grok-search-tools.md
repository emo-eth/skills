# Grok Search Native Tools

## Glossary

- **Tool extension**: a native Pi or OMP package that registers model-callable tools.
- **Host seam**: the native `registerTool` callback used by both adapters.
- **Runner**: the shared TypeScript implementation that executes the bundled Python CLI without a shell.
- **Source mode**: a search response containing raw source material for the calling model to synthesize.
- **Degraded result**: a narrowed search that returned no citations and may reflect model memory instead of live sources.

## Contract

`skills/grok-search/` is both a model-invoked skill and an installable Pi/OMP Agent Plugin. It registers three tools:

- `grok_search`: X, web, or combined search. `response: "sources"` is the default; `response: "answer"` requests Grok synthesis. X and web filters remain source-specific.
- `grok_fetch`: one X post or thread by URL.
- `grok_prompt`: plain Grok inference without search.

Every tool returns the CLI's structured `{ model, answer, citations, degraded }` result. Authentication, login, logout, and model listing remain CLI-only administration.

## Implementation

`src/host.ts` owns registration, argument validation, CLI argument construction, process execution, cancellation, error translation, and response validation. `src/pi.ts` and `src/omp.ts` are thin native adapters. The runner uses `execFile("python3", [scriptPath, ...args])`; user input never crosses a shell parser. The package is self-contained: adapters resolve `scripts/grok-search.py` relative to their installed directory.

Credentials stay in the existing CLI stores or `XAI_API_KEY`; tool inputs and results never contain bearer or refresh tokens. Each invocation still consumes the user's xAI API credits or Grok subscription quota.

## Focused proof

- `npm run check`: TypeScript passed.
- `npm run test:node`: 7 tests passed, covering both adapters, all three tool mappings, source-specific validation, structured output parsing, and host cancellation.
- `npm run test:pi-runner`: Pi 0.84.1 loaded the native adapter, registered all three tools, and executed `grok_prompt` through a deterministic fake executable.
- `npm run test:omp-runner`: OMP 17.2.15 loaded the native adapter, registered all three tools, and executed `grok_prompt` through a deterministic fake executable.

## Live host proof

OMP 18.0.5 started a clean non-interactive process with only `src/omp.ts` and `grok_prompt` enabled. The calling model invoked the tool, the tool made a real xAI request through the bundled CLI and existing Grok OAuth, and the process returned `OMP_GROK_TOOL_OK`.

Commit `6ee3449` was pushed to `origin/main`. The default OMP profile linked the package from that pushed checkout, and Pi added the same checkout as a user package. A fresh OMP 18.0.5 process discovered the installed extension without an explicit extension path and returned `OMP_INSTALLED_GROK_OK` through a real `grok_prompt` call. The already-running OMP process still requires a full restart before its tool list changes.

GAP: global Pi 0.84.3 reached provider selection before a tool turn but had no authenticated calling model, so a live end-to-end Pi model invocation could not run. The pinned Pi 0.84.1 native-runner proof covers real extension loading and execution without claiming provider-level behavior.

## OMP code mode

OMP's `eval` runtime exposes registered session tools through `tool.<name>(args)`, so the installed Grok tools require no code-mode-specific adapter. A fresh OMP 18.0.5 process used JavaScript eval to call `await tool.grok_prompt(...)`; the nested tool made the real xAI request and returned `GROK_CODE_MODE_OK`. Tool schemas, approval policy, quota use, cancellation, and errors remain active across the eval bridge.
