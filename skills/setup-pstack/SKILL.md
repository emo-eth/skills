---
name: setup-pstack
description: Configure which OMP agent types pstack uses for each role. Use for /setup-pstack, "configure pstack agents", or changing pstack delegation choices.
---

# Setup pstack for OMP

Write `~/.config/pstack/omp-agents.json`. Pstack reads this optional file when it creates OMP `task` batches. The value `default` means to omit the `agent` field and use OMP's default task agent.

## Steps

### 1. Detect available agent types

Read the current OMP `task` tool roster in the system context. That roster is authoritative for this session. Do not invent a type. `default` is always valid because it omits the optional `agent` field.

### 2. Load current state

If `~/.config/pstack/omp-agents.json` exists, read it and treat its values as the current choices. Otherwise use the defaults in step 5.

### 3. Map roles

Show each role and its current agent type. Mark any type that is not in the current roster. Use OMP roles for their stated purpose:

- `scout` for read-only repository research.
- `reviewer` for code or decision review.
- `security-reviewer` for security review.
- `designer` for user-interface design.
- `librarian` for external library and API research.
- `sonic` for large mechanical work.
- `default` for general implementation or synthesis.

Use the `ask` tool only when the user must choose between materially different role mappings. Otherwise keep valid current values and replace invalid values with the safest matching type.

List-valued panel roles set the number of independent agents. Repeated types are valid. OMP does not promise that two agent types use different model families, so call these independent-agent panels, not multi-model panels.

### 4. Validate

Every value must be `default` or an agent type in the current OMP roster. Remove unsupported types. A bad type breaks every delegation that reads it.

### 5. Write the configuration

Overwrite the file so repeated setup converges on one state. Create its parent directory when needed. Use this shape:

```json
{
  "feature": "default",
  "refactoring": "default",
  "bug-fix": "default",
  "perf-issue": "default",
  "hillclimb": "default",
  "judgment-and-prose": "default",
  "hardest-tasks": "default",
  "how-explorer": "scout",
  "how-explainer": "scout",
  "how-critics": ["reviewer", "reviewer"],
  "why-investigators": "scout",
  "why-synthesizer": "reviewer",
  "reflect-tooling": "reviewer",
  "reflect-judgment": "reviewer",
  "arena-runners": ["default", "default", "default"],
  "arena-cross-judge": "reviewer",
  "swarm-workers": "default",
  "architect-runners": ["default", "default", "default"],
  "interrogate-reviewers": ["reviewer", "reviewer", "security-reviewer"]
}
```

If a listed specialist is unavailable, use a valid type with the closest contract. Preserve panel length unless the user changes it.

### 6. Confirm

Report the written path and any fallback substitutions. New task calls use it immediately because each pstack skill reads the file when invoked.

### 7. Offer a verification skill

Check whether the current project has a real-surface verification harness or an installed `verify-*` skill. If neither exists, offer `/create-verification-skill` once. That skill writes its source under `~/dev/skills/skills/` and installs it through `npx skills`; it does not write into an agent's installed-skill directory.
