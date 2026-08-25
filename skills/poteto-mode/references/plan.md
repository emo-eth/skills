# Plan

Produce a phased implementation plan grounded in the **Principles** section of the `poteto-mode` skill. The plan is the deliverable. Do not implement.

Open an OMP `todo` list with one item per step below.

## 0. Triage

Skip the plan when the change is one or two files with an obvious approach. Say so and stop.

Plan when the change spans three or more files, introduces architecture, has competing approaches or unclear scope, or the user asked for one.

## 1. Re-read principles

Read the **Principles** section of the `poteto-mode` skill end to end, and the leaf `principle-*` skills it indexes. The principles govern every plan decision; cross-link them.

## 2. Scope and constraints

State scope and constraints in one paragraph. Use OMP `ask` only for genuinely ambiguous product intent; give 2-5 concrete options.

Resolve what is in scope vs explicitly out, technical or platform constraints, patterns to preserve, and the definition of done.

## 3. Explore in subagents

Delegate independent codebase slices in one OMP `task` batch. Use `scout` because this is read-only research. Each scout reads `skill://poteto-mode` first and returns file pointers, conventions, dependencies, test infrastructure, and entry points. Keep raw dumps out of the parent context.

## 4. Write the plan

The user specifies where the plan lives.

Single file `NN-slug.md` for small plans. For three or more phases, a directory with `overview.md` plus phase files:

```
NN-slug/
├── overview.md
├── phase-1-scaffold.md
├── phase-2-...md
└── testing.md
```

### Phase sizing

- One function or type plus tests, or one bug fix. Not "one file".
- Two to three files touched, max.
- Prefer eight to ten small phases over three to four large ones to preserve option value (the **foundational-thinking** principle skill).
- Split if a phase has more than five test cases or three functions.

### Overview file

- **Glossary.** Define every coined or capitalized term. Define invented terms on first use and expand domain shorthand into plain words.
- **Context.** Problem and why now.
- **Scope.** Included; explicitly excluded.
- **Constraints.** Technical, platform, dependency, pattern.
- **Alternatives.** Two or three approaches sketched, choice and rationale (the **exhaust-the-design-space** principle skill). Skip when constraints dictate one.
- **Applicable skills.** Domain skills the implementer should invoke, by name.
- **Phases.** Ordered standard-markdown links to phase files.
- **Verification.** Project-level commands.
- **Implementation guidance.** Per section 6.

### Phase files

- Back-link to overview.
- **Goal.** What the phase accomplishes.
- **Changes.** Files affected and the change at a high level. What and why, not how. No code snippets.
- **Data structures.** Name the key types or schemas. For a shared contract, add a one-page shape with fields, a concrete example, and a state diagram when lifecycle matters. Mark it as a user sign-off gate before implementation.
- **Verification.** Per section 6.

Order phases so infrastructure and shared types land first (the **foundational-thinking** principle skill). Each phase should be independently shippable.

For changes touching existing code, apply the **redesign-from-first-principles** principle skill: if we'd built this with the new requirement on day one, what would it look like? Redesign holistically; deliver incrementally.

If a phase creates or edits a skill, it requires the **Authoring a skill** playbook and work in `~/dev/skills`.

## 5. Verification per phase

Each phase needs both:

**Static.** Run only the focused type, lint, or test checks that defend the changed contract.

**Runtime.** Exercise the actual user surface:

- Web or Electron: OMP `browser`.
- CLI or TUI: the actual program in a PTY or managed process.
- Runtime state: OMP `debug` or the platform profiler.
- Service or API: its real HTTP or protocol interface.
- No reachable control surface: state the gap.

For bug fixes, the loop is reproduce on the surface, fix, verify on the same surface. Unit tests show a branch behaves a certain way; they do not prove the bug is gone (the **prove-it-works** principle skill).

## 6. Implementation guidance

In the overview, name which poteto-mode non-negotiables the implementer must apply, by name:

- the **how** skill over each unfamiliar subsystem before changing it.
- the **interrogate** skill for adversarial review on contested designs before shipping.
- the **unslop** skill over every prose surface.
- the **show-me-your-work** skill when a reviewer needs an audit trail.
- the **Babysit** playbook only when the user asks to drive PR status.

## 7. Hand back

Summarize phases, scope boundaries, applicable skills, and verification. Stop. The user decides when implementation starts.
