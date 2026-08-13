---
date: 2026-08-11
topic: wall-clock-plugin-capabilities
status: verified
source_material: Agent Plugins 1.0.0 specification, Agent Skills specification, Model Context Protocol specification, and wall-clock design
---

# Glossary

- **Agent Plugins**: The portable package format for Agent Skills and Model Context Protocol servers.
- **Plugin**: A self-contained directory with a root manifest and optional portable components.
- **Agent Skill**: A directory containing `SKILL.md` instructions and optional supporting files.
- **MCP**: Model Context Protocol, the protocol used to connect a client to tools or services.
- **Client**: An agent product that discovers and loads plugins.
- **Portable core**: The package behavior defined by the shared Agent Plugins specification.
- **Client extension**: Namespaced files or manifest data owned by one client and ignored by other clients.
- **Native adapter**: Client-specific code that connects a plugin to session, context, tool, or child lifecycle events.
- **Host enforcement**: A runtime mechanism that blocks or stops work.
- **Model guidance**: Instructions or tool results that the model may follow but the host does not enforce.
- **Pre-action boundary**: The host event immediately before a tool or other action is admitted for execution.
- **In-flight work**: An action that has already been admitted and is currently running.
- **Remote action**: Work performed by a provider or service outside the local agent process.
- **Assignment**: A bounded unit of work with an objective, scope, acceptance target, and time ceiling.
- **Hard deadline**: The point after which new work must not start.
- **Wrap-up**: The period before the hard deadline when new delegation and destructive work stop.
- **Expiry policy**: The selected rule for work admitted when the deadline arrives: block new work or abort running wall-clock-owned work.
- **Vertical slice**: The smallest working end-to-end result that remains useful when full scope is not complete.
- **Abort signal**: A host signal sent to an owned running action that its executor accepts and obeys to stop the action.

# Plugin capability boundaries

## One-sentence answer

Agent Plugins standardizes packaging and discovery for reusable Agent Skills and optional Model Context Protocol (MCP) servers. It does not provide runtime hooks for deadlines, tool admission, child creation, or remote cancellation, so wall-clock activates only through a tested native adapter; package discovery alone never activates a limit.

## What the Agent Plugins standard provides

Agent Plugins 1.0.0 defines a small portable floor:

1. A plugin is a directory with a root `plugin.json` manifest.
2. The manifest identifies the specification version and plugin name and may carry ordinary metadata.
3. Clients discover Agent Skills under the fixed `skills/` directory.
4. Clients discover MCP servers from the fixed root `mcp.json` file.
5. MCP configuration can describe standard input/output, Streamable HTTP, or legacy HTTP plus Server-Sent Events transports.
6. Package paths must remain inside the plugin root.
7. Clients that launch standard input/output servers provide `PLUGIN_ROOT` and a persistent writable `PLUGIN_DATA` directory.
8. Client-specific behavior can live under a reverse-domain extension namespace.
9. Invalid components fail independently where the specification defines an isolated component boundary.
10. A client can support skills, MCP servers, or both.

This is a packaging and discovery contract. It is not an agent execution contract.

## What the standard does not provide

| Need | Agent Plugins provides it? | Meaning for wall-clock |
| --- | --- | --- |
| Root package identity | Yes | Give wall-clock a portable manifest and keep its paths contained. |
| Reusable instructions | Yes, through Agent Skills | Put activation rules, phase meanings, elapsed-time context, and reporting contracts in the skill. |
| Tool access | Yes, through optional MCP configuration | Expose time state, assignments, decisions, completion, and reports when the client supports MCP. MCP is not an enforcement mechanism. |
| Stable conversation or session identity | No | Require the client or caller to provide a session key; do not activate without a stable key. |
| Before-tool interception | No | A tested native pre-action boundary is required before wall-clock can activate. |
| Blocking a tool after expiry | No | Claim enforcement only for a tested native adapter; otherwise reject activation. |
| Automatic child-session creation | No | Let the host create children; wall-clock records assignments and associates children where the host exposes identifiers. |
| Passing a hard child budget into a native executor | No | Refuse activation for a policy that needs hard child enforcement unless the host exposes a tested setting or abort signal. |
| Stopping an in-flight local tool | No | Use the selected abort policy only when the executor accepts and obeys an abort signal. |
| Cancelling a remote action | No | Require provider-specific cancellation and evidence; otherwise report running or unknown. |
| User interface, status display, and notifications | No | Use the client's supported surfaces without treating any one user interface as portable. |
| Installation, marketplace, permissions, or authentication policy | No | Leave these to the client. Do not present a Codex marketplace entry as part of the portable standard. |
| A universal command or hook format | No | Keep commands and hooks in native adapters or client namespaces. |

## What wall-clock should do

Wall-clock uses the portable package for shared data and instructions, and uses native adapters for every active enforcement claim.

### Portable package

The portable package should:

- define the activation request, which includes a duration or local-time deadline and a required expiry policy;
- provide status, elapsed-time context, assignments, completion, and structured report shapes;
- expose optional MCP operations for clients that support MCP;
- persist state by an explicit session key in client-managed plugin data;
- remain installed-but-inactive when no tested native enforcement adapter is available;
- reject activation instead of falling back to a guidance-only wall-clock limit.

Portable Agent Skill instructions and MCP results can explain the contract, but they cannot start or enforce an active limit. A client that only loads the skill or `mcp.json` must not be treated as a supported wall-clock host.

### Native adapters

A native adapter should add only behavior the host can prove:

- restore the host's stable session state;
- inject measured elapsed-time context before every model turn: current clock time, total elapsed time, elapsed time since the latest inference, elapsed time since the latest tool call, remaining time, current phase, and actual assignment elapsed time;
- classify every proposed tool or child action because the pre-action boundary is the last host-controlled point before execution;
- intercept the action at that boundary and reject it when the current phase or selected expiry policy disallows it;
- observe tool results and child lifecycle events;
- pass assignment context to a child when the host exposes a supported child hook;
- send and observe an abort signal only when the selected `abort-running` policy has an executor that accepts and obeys it.

For this product, Pi and OMP are the first native enforcement targets. Codex and Claude are package targets only until an open, tested enforcement seam exists; Claude proprietary systems are out of scope.

## Wall-clock behavior by phase

| Phase | Package without a tested native adapter | Native enforcement when supported |
| --- | --- | --- |
| Inactive | The package remains dormant. No active limit exists. | No pre-action blocking. |
| Active | Activation is rejected; there is no guidance-only active phase. | Inject measured elapsed-time context and admit only actions allowed by the host policy. |
| Wrap-up | Activation is rejected; there is no guidance-only active phase. | Block new delegation and destructive work at the pre-action boundary. |
| Expired | Activation is rejected; there is no guidance-only active phase. | Block every new work action. Under `block-new`, admitted work may finish; under `abort-running`, the host aborts each owned running action and records the observed result. |
| Complete | The package can be discovered but cannot claim active completion behavior. | Record completion and return control to the parent. Stop a host-owned child only through a confirmed executor path. |

## Claims wall-clock may make

Wall-clock may say:

- "The agent received current time, total elapsed time, latest inference elapsed time, latest tool-call elapsed time, and remaining time."
- "This session has 12 minutes remaining."
- "This assignment is in wrap-up, so new delegation and destructive work are not allowed."
- "The host blocked this new tool call at its pre-action boundary."
- "The selected `block-new` policy blocks new work while an already-admitted action may continue."
- "The selected `abort-running` policy sent and observed an abort signal for this wall-clock-owned action."
- "The child reported a vertical slice with these skipped checks, shortcuts, risks, and unknowns."
- "The local deadline blocked new work, but an already-running remote action may continue."
- "Activation was rejected because this client does not expose the required enforcement seam."

## Claims wall-clock must not make

Wall-clock must not say:

- "The portable package itself stops every client tool after expiry."
- "A prompt or timer alone makes a child stop." A prompt or timer can trigger a host abort, but only the host executor's observed abort enforces it.
- "A recorded assignment is the same as a host-created child session."
- "A child budget is hard-enforced without a tested executor setting or abort signal."
- "An in-flight tool was cancelled because the local deadline passed" without an observed abort result.
- "A remote action stopped without provider confirmation."
- "Codex or Claude can activate wall-clock before an open, tested enforcement seam exists."

## Recommended product boundary

The product should ship as one package with three deliberately separate layers:

1. **Portable instructions**: The Agent Skill explains the required activation inputs, measured context, time contraction, acceptance targets, safe wrap-up, selected expiry policy, and truthful reporting. It does not activate a limit.
2. **Portable operations**: Optional MCP tools store and return session state, assignments, decisions, completions, and reports. The Agent Plugins standard does not require MCP, and MCP never enforces a deadline.
3. **Native enforcement**: Pi and OMP adapters connect those operations to host events and enforce only the boundaries supported by each host. They reject activation when the requested policy cannot be enforced.

The native adapter is the enforcement boundary, not an optional guidance upgrade. A package that lacks a tested native adapter remains discoverable but cannot run an active wall-clock session.

## Verification rules

Every activation or enforcement claim needs three facts:

- the host mechanism that performs it;
- the failure mode when the mechanism is absent or the executor ignores it;
- a test or live host result that demonstrates the claimed behavior.

The minimum evidence set is:

- inactive-session isolation;
- independent state for two sessions;
- restoration after time advances;
- measured per-turn elapsed-time context for parent and child agents;
- wrap-up blocking for delegation and destructive actions where the host supports it;
- hard-expiry blocking for new tools where the host supports it;
- `block-new` behavior showing that admitted work is not falsely reported as cancelled;
- `abort-running` behavior showing an observed abort signal for every owned running action;
- portable package discovery and Agent Skill loading;
- optional MCP initialization, tool discovery, persistence, and report behavior when MCP is enabled.

## Implementation evidence

The v0 package now proves the Pi and OMP boundary with exact local host versions:

- Pi 0.84.1 loads the native adapter, injects measured context, blocks expired shell work, and aborts its actual bash executor under `abort-running`.
- OMP 17.2.15 provides a native pre-action gate, child lifecycle identifiers on the parent event bus, and a session-wide abort function. It creates each task child with a different event-bus object. The adapter binds the real child session path through a process-wide registry, blocks expired shell work, and aborts its actual bash executor.
- The OMP task path validates and creates one bounded assignment for each inline batch item, injects each assignment's measured context into its child, and correlates child lifecycle events by batch index. Nested delegation remains blocked. The child must report before its required native `yield`; a missing child report creates a structured fallback report.
- Agent Plugin discovery loads the bundled skill and optional MCP tools without claiming that those portable components enforce a deadline.
- Unsupported activation, unknown abort-running tools, missing action identifiers, and malformed newest state all fail closed.

The exact mechanisms, failure modes, and test files are listed in `plugins/wall-clock/README.md`. Codex and Claude native activation and provider-specific remote cancellation remain deferred.

## Product decisions implied by this boundary

- The main session must provide or select the session key for portable calls.
- A time budget is always a ceiling, never a work quota; agents do not estimate task duration.
- Every active wall-clock session requires a tested host-enforced expiry policy.
- Every activation request carries `block-new` or `abort-running`; the native `/wallclock` command supplies `abort-running` when the user omits the choice, and the host rejects a policy it cannot enforce.
- Parent and child agents receive measured elapsed-time context at every turn.
- Compressed work preserves a working vertical slice, with evidence and explicit skipped validation, shortcuts, risks, and unknowns.
- Pi and OMP are the first native enforcement targets. Codex and Claude remain package targets until open enforcement seams are tested; Claude proprietary systems are excluded.
- Agent Skills are portable instructions. MCP is optional and is never an enforcement dependency.
- Child creation, child context injection, and remote cancellation remain host- or provider-specific.
- Client-specific marketplace, installation, permission, and authentication policy is not part of the portable contract.

## Sources

- [Agent Plugins specification](https://agent-plugins.org/specification)
- [Agent Plugins manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- [Agent Plugins MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)
- [Agent Plugins canonical repository](https://github.com/agentplugins/agent-plugins-spec)
- [Agent Skills specification](https://agentskills.io/specification)
- [Model Context Protocol standard input/output transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#stdio)
- [Wall-clock implementation research](https://github.com/emo-eth/skills/tree/main/proposals/wall-clock)

## Resolved Review Checkpoints

- The package remains discoverable through Agent Plugins while standalone MCP refuses activation.
- Portable MCP uses an explicit session key. Native Pi and OMP adapters use the stable host session file or identifier.
- Pi and OMP expose enough open lifecycle surface to prove both expiry policies for their tested local executors.
- Pi's tested abort-running tools are `bash`, `read`, `write`, `edit`, `grep`, `find`, and `ls`. OMP's are `bash`, `read`, `write`, `edit`, `grep`, `glob`, and `task`.
- Remote provider cancellation remains deferred until a provider-specific mechanism and confirmation contract are selected.
