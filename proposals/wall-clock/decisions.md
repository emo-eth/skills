# Wall Clock Plugin Decisions

## Glossary

- **Decision**: A rule that changes future implementation behavior.
- **Load-bearing**: A decision that is expensive to reverse or affects several modules.

## D1 - 2026-08-05 - Store design outside skills

Decision: Keep wall-clock design, research, and experimental implementation outside `skills/` until the plugin is ready for skill distribution.
Why: The user asked to keep design and future-work documents separate and ensure they are not installed with skills.
Consequences: `npx skills` will not discover the proposal or plugin directories. Native OMP and Pi distribution will be added later.
Status: active
Scope: v0
Load-bearing: yes

## D2 - 2026-08-05 - Budgets are ceilings

Decision: An assignment budget is a maximum guardrail, not a target. A child should finish as soon as its acceptance target is met.
Why: "sessions should not strive to fill the allotted time; short tasks should not take longer; they should finish early whenever possible" - Plannotator annotation.
Consequences: The controller records completion explicitly and never creates extra work to consume unused time.
Status: active
Scope: v0
Load-bearing: yes

## D3 - 2026-08-05 - Host proof is required

Decision: Every enforcement claim must name a host mechanism, failure mode, and test evidence. Model instructions are not enforcement.
Why: "how do we enforce that it does?" - Plannotator annotation.
Consequences: The implementation blocks new tool calls at the host pre-tool seam and labels unsupported child stopping as guidance.
Status: active
Scope: v0
Load-bearing: yes
