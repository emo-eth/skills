# No-code-comments plugin

## Glossary

- **Prose comment**: Explanatory source text carried by a language comment token.
- **Semantic directive**: Comment-shaped syntax consumed by an interpreter, compiler, linter, coverage tool, or source-map loader.
- **Input rewrite**: A `tool_call` hook result that replaces the payload before approval and execution.
- **Fail closed**: Block a write rather than guess how an unsupported language tokenizes comments.

## Contract

`plugins/no-code-comments/` is a native Pi, OMP, and Hermes extension that enforces comment-free generated code at the write boundary. The TypeScript adapter rewrites `write`, replacement-mode `edit`, hashline/apply-patch additions, JSON patch additions, and `ast_edit` replacement outputs before Pi or OMP approves or executes them. The Python adapter under `hermes/` uses Hermes `tool_request` middleware for `write_file` and both `patch` modes, plus a `pre_tool_call` hook that blocks likely comments in unsupported code extensions. A bounded system-prompt section and `/no-code-comments` command expose the same policy without owning enforcement.

The scanner supports C-family languages, JavaScript and TypeScript, CSS-family languages, Python and shell-family hash comments, YAML/TOML, HTML/XML, SQL, Lua, and Haskell. It preserves strings and regular-expression literals. It also preserves semantic directives including shebangs, Python coding/type/checker annotations, TypeScript triple-slash and `@ts-*` annotations, source-map directives, JSX/Flow annotations, Go build/generate/embed directives, Swift tools-version declarations, lint/format/coverage controls, and SQL migration directives. C/C++ preprocessor directives and string directives such as `"use strict"` are never comment tokens and remain untouched.

Unsupported extensions containing likely comment syntax are blocked with a model-visible retry reason. Unsupported content with no likely comment syntax passes unchanged.

## Boundaries

- The hook strips only newly authored tool payloads. It does not erase comments already present outside the replaced span.
- Arbitrary shell commands and third-party tools can mutate files outside the native `write`, `edit`, and `ast_edit` seams. The injected system rule tells the model not to use prose comments, but shell-side generators are not rewritten.
- Hermes `execute_code` writes made through `hermes_tools.write_file` and `hermes_tools.patch` traverse the normal tool handler and are rewritten. Arbitrary Python filesystem writes inside the sandbox still bypass tool middleware, just as arbitrary shell generators do.
- Template-literal bodies are treated as strings. Comment tokens inside `${...}` expressions are not stripped because rewriting a partial template without a parser would be unsafe.
- Removal preserves newline count and inserts whitespace where needed so adjacent tokens do not merge.

## Evidence

- `npm run check`: passed with TypeScript 5.9.3.
- Node suite: 6 tests passed, covering C-family literals/directives, hash directives, write/replace rewrites, hashline patch rewrites, unsupported-language fail-closed behavior, and both host-shaped adapters.
- Native OMP ExtensionRunner: loaded the OMP adapter, registered `/no-code-comments`, rewrote a real `write` proposal from `const a = 1; // remove` to `const a = 1;`, and injected the system rule.
- Installed default OMP profile: `omp plugin list` reported the plugin enabled; a fresh auto-discovery RPC process advertised `/no-code-comments` as an extension command and executed it without invoking a model, emitting the exact policy notice.
- Hermes Plugin Doctor: runtime discovery, manifest parsing, import, and registration passed for `hermes/plugin.yaml` with one declared hook.
- Hermes focused suite: 6 stdlib `unittest` cases passed for scanner behavior, direct `write_file`/`patch` rewrites, V4A structure preservation, fail-closed blocking, and native registration shape.
- Hermes isolated-host smoke: a temporary `HERMES_HOME` discovered and enabled the real plugin, rewrote an actual `write_file` dispatch, blocked an unsupported extension before file creation, and registered `/no-code-comments`.
- Hermes code-mode smoke: an actual `execute_code` child called `hermes_tools.write_file`; the nested dispatch removed the prose comment and wrote the verified final file.
- `npm pack --dry-run --json`: passed with both native adapters, manifest, host implementation, scanner, and tests present.

## GAP

The already-running user OMP process still needs a full restart to load the installed plugin. A separate fresh OMP process has verified the on-disk install and command autoload. The Hermes adapter is source-verified and isolated-host verified but is not yet enabled in the live default Hermes profile.
