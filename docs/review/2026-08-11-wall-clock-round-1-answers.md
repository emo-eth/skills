---
date: 2026-08-11
topic: wall-clock
status: applied
source_feedback: .context/review/2026-08-11-wall-clock-round-1.md
---

# Review Answers: Wall Clock Round 1

## Glossary

- **Annotation**: A comment submitted during the human review round.
- **Agent Plugins**: The portable package format for reusable agent instructions and optional Model Context Protocol servers.
- **Native adapter**: Host-specific code that connects wall-clock to session, model-turn, tool, child, and abort events.
- **Pre-action boundary**: The host event immediately before a tool or child action starts.
- **Expiry policy**: The selected rule for work admitted when the deadline arrives: block new work or abort running wall-clock-owned work.
- **Vertical slice**: The smallest working end-to-end result that is useful even when the full scope is not complete.

## Folder feedback

### 1. Measured elapsed-time context

Annotation: total elapsed time - last inference / tool call elapsed time - current time + time remaining,

Applied. The wall-clock vibe now requires the agent to receive current clock time, total elapsed time, elapsed time since the latest inference, elapsed time since the latest tool call, remaining time, current phase, and actual assignment elapsed time at every turn. The PRD records this as R3. The capability document places the same measured fields in the native adapter's model-turn contract.

Landed in: `docs/prds/2026-08-11-wall-clock/vibe.md` V1 and Success Signals; `docs/prds/2026-08-11-wall-clock/prd.md` R3 and Success Criteria; `docs/prds/2026-08-11-wall-clock/plugin-capabilities.md` Native adapters.

### 2. Why intercept at the pre-action boundary?

Annotation: why?

Applied. The pre-action boundary is the last host-controlled point before execution. A prompt, status message, or earlier model instruction cannot guarantee that a tool or child action will not start. Classification is required so wrap-up can block delegation and destructive actions while still allowing safe work, and expiry can block all new work.

Landed in: `docs/prds/2026-08-11-wall-clock/prd.md` R4; `docs/prds/2026-08-11-wall-clock/plugin-capabilities.md` Native adapters and Verification rules.

### 3. Target harnesses

Annotation: only harnesses i am considering: codex, pi, omp, claude (do not target claude's proprietary system). favor pi and omp

Applied. Pi and OMP are the first native enforcement targets. Codex and Claude are package targets only until an open, tested enforcement seam exists. Claude proprietary systems are out of scope.

Landed in: `docs/prds/2026-08-11-wall-clock/prd.md` Product Shape, R9, Scope Boundaries, and Contract Checks; `docs/prds/2026-08-11-wall-clock/plugin-capabilities.md` Native adapters and Product decisions.

### 4. Universal capability warnings

Annotation: i am building this tool for me; i do not care

Applied with a narrow technical distinction. The product documents no broad client support promise and prioritizes Pi and OMP. It still names the portable package boundary because Agent Plugins clients do not automatically provide runtime enforcement hooks; this is needed to avoid activating a limit that cannot work. The distinction is an implementation contract, not a reason to broaden the product scope.

Landed in: `docs/prds/2026-08-11-wall-clock/prd.md` Product Shape and R9; `docs/prds/2026-08-11-wall-clock/plugin-capabilities.md` One-sentence answer, Native adapters, and Recommended product boundary.

### 5. Why not stop every client tool after expiry?

Annotation: why not?

Applied conditionally. A native Pi or OMP adapter may claim that it blocks every new tool action after expiry when its pre-action test proves that behavior. The portable Agent Plugins package cannot make that claim because the standard defines packaging and discovery, not a universal pre-action hook. Wall-clock therefore refuses activation on a client without a tested enforcement seam instead of providing a weaker active limit.

Landed in: `docs/prds/2026-08-11-wall-clock/prd.md` R4, R9, and R10; `docs/prds/2026-08-11-wall-clock/plugin-capabilities.md` phase table and Claims wall-clock may make.

### 6. Prompt or timer stopping a child

Annotation: this is what i want, though

Applied as an enforced abort mode. A timer or prompt can trigger the host's abort path, but it is not the enforcement mechanism by itself. The `abort-running` policy is available only when the host-owned child executor accepts and obeys an abort signal. If the host cannot prove that path, activation for that policy is rejected. `block-new` remains available for a host that can block admission but must not claim to stop admitted work.

Landed in: `docs/prds/2026-08-11-wall-clock/prd.md` R11 and Scope Boundaries; `docs/prds/2026-08-11-wall-clock/plugin-capabilities.md` Native adapters, phase table, and Claims wall-clock must not make.

### 7. Choosing whether running work stops

Annotation: i'd like to be able to decide whether or not this is the case

Applied. Activation now requires an explicit expiry policy. `block-new` rejects new work while admitted work may finish. `abort-running` rejects new work and aborts every wall-clock-owned running action, with an observed abort result required. The selected policy is visible in status and reports.

Landed in: `docs/prds/2026-08-11-wall-clock/vibe.md` Vibe Promise and Ideal Reality Dump; `docs/prds/2026-08-11-wall-clock/prd.md` Product Shape and R11; `docs/prds/2026-08-11-wall-clock/plugin-capabilities.md` Portable package, phase table, and Product decisions.

### 8. Whether MCP is required

Annotation: is mcp required by plugin standard?

Applied. MCP is optional in Agent Plugins. The root manifest and Agent Skill are the portable floor; `mcp.json` is an optional control and inspection surface. Wall-clock includes MCP, but enforcement never depends on MCP and MCP cannot replace a native adapter.

Landed in: `docs/prds/2026-08-11-wall-clock/prd.md` Product Shape and R10; `docs/prds/2026-08-11-wall-clock/plugin-capabilities.md` One-sentence answer, standard boundary table, and Recommended product boundary.

## Linked document feedback: plugin-capabilities.md

These eight annotations repeat the folder feedback above. Each is answered separately here to preserve the reviewer's numbering and to record the exact linked-document landing point.

### 1. Measured elapsed-time context

Annotation: total elapsed time - last inference / tool call elapsed time - current time + time remaining,

Applied in the Native adapters section and Verification rules. The adapter contract lists current time, total elapsed time, latest inference elapsed time, latest tool-call elapsed time, remaining time, current phase, and assignment elapsed time.

### 2. Why intercept at the pre-action boundary?

Annotation: why?

Applied in the Native adapters section. The document now states that this is the last host-controlled point before execution and explains why earlier model guidance cannot guarantee prevention.

### 3. Target harnesses

Annotation: only harnesses i am considering: codex, pi, omp, claude (do not target claude's proprietary system). favor pi and omp

Applied in Native adapters and Product decisions. Pi and OMP are first enforcement targets; Codex and Claude remain package targets until an open, tested seam exists; Claude proprietary systems are excluded.

### 4. Universal capability warnings

Annotation: i am building this tool for me; i do not care

Applied in the product boundary. The document keeps only the technical fact that portable clients do not gain enforcement hooks from the package standard. It does not treat broad client support as a product goal.

### 5. Why not stop every client tool after expiry?

Annotation: why not?

Applied in the phase table and Claims wall-clock may make. A tested native adapter may claim to block every new action after expiry; the portable package must reject activation instead of making that claim without a host seam.

### 6. Prompt or timer stopping a child

Annotation: this is what i want, though

Applied in Native adapters, the phase table, and Claims wall-clock must not make. The selected abort policy can use a timer or prompt as the trigger, but only an observed executor abort is enforcement.

### 7. Choosing whether running work stops

Annotation: i'd like to be able to decide whether or not this is the case

Applied throughout the capability document. It now defines `block-new` and `abort-running`, and requires the host to reject a policy it cannot enforce.

### 8. Whether MCP is required

Annotation: is mcp required by plugin standard?

Applied in the One-sentence answer, standard boundary table, and Recommended product boundary. MCP is optional and never an enforcement dependency.

## Linked document feedback: vibe.md

### 1. The agent should know the time

Annotation: the agent should. the user ~knows how much time remains

Applied. The Vibe Promise and V1 address the agent, not the user, and require measured per-turn context.

### 2. A limit must always be enforcement

Annotation: a limit should always be an enforcement. if we can't do that with a plugin, we shouldn't try

Applied. V4 is now "Enforcement or no activation." Unsupported activation fails closed; there is no guidance-only active phase.

### 3. Use vertical slice

Annotation: "vertical slice"

Applied. The ideal reality, V3, and Success Signals now use "working vertical slice" as the compression target.

### 4. It works and is possible

Annotation: crucially: "it works and is possible"

Applied. The final Success Signal now requires end-to-end Pi and OMP paths that are driven and observed enforcing the promised limits.

## Linked document feedback: prd.md

### 1. Per-turn time and task elapsed time

Annotation: parent and children are also acutely aware at every turn how much time remains and how long each task has taken

Applied. R3 requires measured context for parent and child turns and actual assignment elapsed time. The Product Shape and Success Criteria repeat the contract.

### 2. No agent duration estimates

Annotation: i suspect agents will be very poor at estimating how long a task takes. they should not attempt to estimate

Applied. R3 and R5 remove optional estimates and prohibit agents from estimating task duration. The action gate uses the current phase and policy, not an agent prediction.

### 3. Always host-enforced

Annotation: it must always be host-enforced

Applied. R1, R4, R9, and R10 require host enforcement for activation. The product refuses activation when the selected harness has only package loading, prompts, timers, or MCP.

### 4. Wall-clock must work

Annotation: no. wall-clock *must* work. otherwise it is no different from saying "hurry up"

Applied. The North Star, R9, Scope Boundaries, and Success Criteria now make working enforcement the product boundary. Guidance-only activation is explicitly forbidden.

## Needs owner input

None is required to close this review round. The choice between `block-new` and `abort-running` is now a per-activation input, not an unresolved product decision. Implementation still needs host evidence for Pi and OMP, including which child executors can accept abort signals and whether any provider-specific remote cancellation should be added; those are tracked as implementation checkpoints rather than hidden assumptions.
