# Wall Clock Agent Plugin Research

## Glossary

- **Agent Plugins**: The portable package format for Agent Skills and Model Context Protocol servers.
- **Agent Skill**: A directory with a `SKILL.md` file containing metadata and instructions for an agent.
- **MCP**: Model Context Protocol, the protocol used to connect an agent to tools or services.
- **Portable core**: The part of a plugin that compatible clients can discover using the shared format.
- **Client extension**: Namespaced files or manifest data owned by one client and ignored by other clients.
- **Host enforcement**: A client runtime mechanism that blocks or stops work.
- **Model guidance**: Instructions or tool results that the model may follow but the host does not enforce.

## Finding

There are two related plugin formats:

1. **Agent Plugins 1.0.0** is the open, vendor-neutral standard released on August 6, 2026. It packages Agent Skills and MCP server configuration in a directory with a root `plugin.json` and fixed component locations. OpenAI is on the initial Technical Steering Committee and ChatGPT and Codex are listed as launch clients.
2. **OpenAI Codex Plugins** are OpenAI's client-specific package and marketplace format. The current OpenAI examples use `.codex-plugin/plugin.json`, interface metadata, and marketplace entries. That format is not the portable Agent Plugins manifest.

Wall-clock should target Agent Plugins 1.0.0 as its portable package. Its existing Pi and OMP adapters can remain as native host code, but they are not portable components.

## Primary sources

- [Agent Plugins launch announcement](https://vercel.com/blog/introducing-agent-plugins) - announces Agent Plugins 1.0.0, its August 6, 2026 release, its two portable component types, and the launch clients.
- [Agent Plugins specification](https://agent-plugins.org/specification) - normative package, manifest, discovery, MCP, extension, and versioning rules.
- [Agent Plugins canonical repository](https://github.com/agentplugins/agent-plugins-spec) - identifies 1.0.0 as the current published release and links the versioned specification and schemas.
- [Plugin manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) - machine-readable root manifest schema.
- [MCP configuration schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json) - machine-readable root MCP configuration schema.
- [Agent Skills specification](https://agentskills.io/specification) - required `SKILL.md` format and skill directory rules.
- [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#stdio) - newline-delimited JSON-RPC over standard input and output.
- [OpenAI plugin announcement](https://openai.com/index/codex-for-every-role-tool-workflow/) - announces OpenAI's role-specific Codex plugins on June 2, 2026.
- [OpenAI plugin documentation](https://help.openai.com/en/articles/20001256-plugins-in-codex) - describes plugins as packages of skills, apps, and app templates and records the July 9, 2026 directory migration.
- [OpenAI plugin examples](https://github.com/openai/plugins) - current Codex-specific layout and `.codex-plugin/plugin.json` examples.

## Normative package rules

### Root manifest

Agent Plugins v1 requires `plugin.json` at the plugin root. The manifest:

- MUST be a JSON object.
- MUST contain `$schema` with the exact value `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`.
- MUST contain a valid lowercase `name` between 1 and 64 characters.
- MAY contain only `$schema`, `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, and `extensions`.
- MUST reject schema errors before component discovery.
- MUST keep client-specific manifest data under reverse-domain keys in `extensions`.

The current wall-clock package now has a root `plugin.json` with a valid name, version, description, author, repository, and keywords. It does not put runtime behavior in the manifest.

### Fixed component locations

Clients discover component types from fixed root locations. The manifest cannot replace these locations:

- `skills/`: immediate child directories with a regular `SKILL.md`.
- `mcp.json`: one root MCP configuration file.

Missing locations are valid. A malformed component is isolated from other valid components.

The current package adds `skills/wall-clock/SKILL.md` and keeps its existing source and test files as package support files.

### Skill contract

The skill follows the Agent Skills specification:

- The directory name is `wall-clock`.
- `SKILL.md` frontmatter names the skill `wall-clock`.
- `description` states what the skill does and when to use it.
- The body gives the time-bound planning, assignment, completion, and report procedure.
- The body distinguishes model guidance from host enforcement.

### MCP contract

The root `mcp.json`:

- MUST contain `$schema` with the exact value `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`.
- MUST contain only `$schema` and `mcpServers` at the top level.
- MUST declare each server with an explicit transport type.
- Uses a stdio server with the plugin-relative command `./bin/wall-clock`.
- Uses `${PLUGIN_ROOT}` only in the working-directory field.

The launcher uses Node.js 22.6 or newer with type stripping to run the bundled TypeScript MCP server. The server reads one JSON-RPC message per line from standard input and writes only JSON-RPC messages to standard output. Its state store writes per-session state under the client-provided `${PLUGIN_DATA}` directory.

The exposed tools are:

- `wallclock_start`
- `wallclock_status`
- `wallclock_stop`
- `wallclock_context`
- `wallclock_check`
- `wallclock_assign`
- `wallclock_complete`
- `wallclock_report`

The MCP client must pass the same `sessionId` to calls for one work run. MCP does not provide a portable conversation identifier, so the skill makes the session key explicit instead of guessing one.

## Wall-clock mapping

| Existing behavior | Portable mapping | Enforcement status |
| --- | --- | --- |
| Start a duration or local-time deadline | Agent Skill procedure plus `wallclock_start` | The tool records state; the model must follow the result |
| Show phase and remaining time | `wallclock_status` and `wallclock_context` | Guidance unless the host injects or displays it |
| Check a proposed tool action | `wallclock_check` | A decision is returned; unrelated client tools are not intercepted |
| Bound child work | `wallclock_assign` | Records an assignment; does not create a child session |
| Finish early | `wallclock_complete` | Records the result; does not stop a model or executor |
| Report shortcuts and skipped validation | `wallclock_report` | Durable MCP state records the report |
| Block new tools after expiry | Existing Pi/OMP `tool_call` adapter | Enforceable only when that host loads the native adapter |
| Stop an in-flight action | Host abort signal, where supported | Not portable; no general remote cancellation claim |

Agent Plugins v1 defines only Skills and MCP. It has no portable hook, command, agent, or pre-tool interception component. The existing `src/pi.ts` and `src/omp.ts` entry points therefore remain native host adapters, not portable Agent Plugins behavior.

## Security and containment checks

The package uses only package-contained paths:

- `mcp.json` points to `./bin/wall-clock`.
- The launcher resolves the bundled server from `PLUGIN_ROOT`.
- The configured working directory is `${PLUGIN_ROOT}`.
- The writable state path is derived from `${PLUGIN_DATA}` inside the MCP server, not from a package path in the manifest.
- No credentials or fixed HTTP headers are included.

A compatible client remains responsible for process isolation, permissions, installation policy, and authentication. The Agent Plugins format does not sandbox a stdio subprocess.

## Verification plan and result

The package tests cover:

- root manifest fields and schema identifier;
- fixed `skills/` and `mcp.json` locations;
- plugin-relative stdio command and `${PLUGIN_ROOT}` working directory;
- skill directory and frontmatter name matching;
- MCP initialization, tool discovery, start, status, check, assignment, expiry, and session isolation;
- state restoration through a new MCP server instance using `PLUGIN_DATA`-style storage.

The native test suite and the added package tests pass with `npm test` from `plugins/wall-clock/`.

A separate stdio smoke test must send `initialize`, `notifications/initialized`, and a `tools/list` request through `bin/wall-clock` before release. A real compatible client still needs to be tested for plugin discovery and MCP process launch.

## Open limits

- Agent Plugins does not standardize a pre-tool hook, so the portable package cannot promise global tool blocking.
- MCP does not create or identify a child agent session. The host must supply child creation and child context injection.
- The standard does not define a universal cancellation mechanism.
- The current launcher depends on Node.js 22.6 or newer and a POSIX shell. A release that targets clients without those runtimes needs a bundled executable or a separate client extension.
- Codex marketplace installation remains client-specific. This package has the portable root manifest but no marketplace entry because Agent Plugins does not define a marketplace format.
