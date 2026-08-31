---
name: herdr-voice
description: "Delegate Herdr control from a Codex realtime voice task to one OMP delegate that manages Herdr agents. The voice task only delegates and never controls Herdr directly."
---

# Herdr voice control

The voice task never controls Herdr itself and never manages task subagents. It only delegates: spin up one OMP session, hand it the whole Herdr request, and relay its result. Do not patch Herdr, Codex, Pi, or OMP to establish this path.

## Delegate handoff

1. Keep the user's Herdr request verbatim. The explicit user request is the delegate's only authorization; do not add Herdr work the user did not ask for.
2. Spin up one OMP delegate and hand it the entire job, including any subagent management it needs:

   ```bash
   omp -p "Use the installed herdr skill for this explicit user request: <request verbatim>. Read the skill completely before any control and preserve its authorization and safety boundaries. Manage any subagents you need yourself. Report the final result."
   ```

3. Read the delegate's printed final output and relay it to the user. That output is the authoritative result.
4. Send follow-up Herdr work and answers to the delegate's questions to the same session instead of spawning another:

   ```bash
   omp -p -c "<follow-up request or answer verbatim>"
   ```

## Voice boundaries

- Never run `herdr` commands from the voice task, never set or fake `HERDR_ENV`, and never claim the voice task is inside Herdr.
- Never split the Herdr work, track subtask state, or spawn, supervise, or tear down subagents from the voice task. The OMP delegate owns all of that.
- Hand the whole request to one delegate. Spawning parallel Herdr managers is the delegate's decision, never the voice task's.
- If `omp` cannot start or the delegate fails, report that to the user. Direct Herdr control from the voice task is not a fallback.

## Verification

- Accept the delegate's printed final output as the result and relay it without re-deriving or re-checking it through Herdr commands.
- When the delegate reports a blocked approval or question, relay it to the user and send the user's answer back to the same delegate.
- If the delegate's report is stale or contradicts the user's observation, send the discrepancy to the same delegate rather than inspecting Herdr directly.
