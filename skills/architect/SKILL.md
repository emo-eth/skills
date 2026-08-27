---
name: architect
description: "Sketch types, signatures, and module structure before code, then stay in the loop while implementation fills in. Use for /architect, 'architect this', 'design this', or non-trivial work where jumping to code would lock in the wrong shape."
disable-model-invocation: true
---

# Architect

Read `pstack-runtime` before the first host-specific operation.

Design before implementing. Sketch types, function signatures, class shapes, and module boundaries with `not implemented` bodies and pseudocode. Synthesize independent agent attempts, then fill in code against the chosen sketch. If implementation proves the sketch wrong, throw it out and redesign.

## Start

Open the current host's `todo` list with one entry per phase before starting. The list shows phase position and keeps phases from silently disappearing.

1. Ground
2. Sketch
3. Agree
4. Implement
5. Scrap

## Phase A: Ground the problem

Build a real mental model of every system the new code touches. Run the **how** skill over the relevant subsystems. Critique mode if existing structure is the constraint or the design must push back on it.

Naming a file isn't grounding. Produce the traced model `how` prescribes. If the design redefines ownership or layering, also run the **why** skill on the existing shape so the rationale becomes a constraint, not a guess.

Skip Phase A only when the work is genuinely greenfield with no surrounding system to integrate.

## Phase B: Sketch

Run the **arena** skill with the design-sketch task and the Phase A grounding artifacts. Pass `references/runner-prompt.md` as each runner's prompt. Each candidate produces a design package shaped per `references/rationale-template.md`: the caller's usage written first, then the type sketch, function signatures, module map, and prose rationale derived from it.

Use `architect-runners` from `~/.config/pstack/omp-agents.json` when present. Otherwise use three `default` arena runners. OMP does not guarantee different model families, so require structural diversity in the briefs and judge the outputs, not their agent labels.

Design it twice. Require at least two structurally distinct candidates before synthesis, even when the first looks sufficient. This is the **exhaust-the-design-space** principle skill made concrete. Whole-shape alternatives, not point fixes inside one shape.

Screen every candidate against [`references/design-red-flags.md`](references/design-red-flags.md) before synthesis. Reject or revise shallow modules, information leakage, temporal decomposition, and pass-through methods.

Compare viable candidates on interface depth. Prefer the design that hides more complexity behind a smaller, simpler public surface. A rich interface can keep call chains short by concentrating capability instead of scattering it across layers.

Arena returns one synthesized design package. The synthesis decision populates the rationale's "Synthesis decision" section.

## Phase C: Agree

Any data shape or interface that other code will build on needs explicit user sign-off before implementation. Present one page per shape with fields, one concrete example, and a state diagram when lifecycle matters. Stop at that checkpoint.

For a local implementation detail with no downstream contract, proceed directly unless the user asked to review first. For adversarial pressure, run **interrogate** on the sketch before the checkpoint.

If the human pushes back on the shape (in a checkpoint or after the fact), treat that as Phase A evidence. Re-ground and re-run Phase B before writing more code.

## Phase D: Implement against the sketch

Replace `not implemented` bodies with code, pseudocode with logic. The synthesized sketch is the contract.

Treat deviations as evidence that the sketch or requirement is wrong. Re-ground and return to Phase B. Ask the user only when the correction changes a signed product or shared data contract.

## Phase E: Scrap when the architecture is wrong

If implementation keeps producing friction the sketch can't absorb, throw the sketch out. Don't bolt fixes onto a wrong design, per the **redesign-from-first-principles** and **fix-root-causes** principle skills.

The signal is a *pattern*, not single instances. Tells:

- The same shape of workaround appearing repeatedly across unrelated code.
- Multiple unrelated edge cases that all need special-case branches.
- Types that need escape hatches (`any`, casts, optional fields always set in practice) to compile.
- The "we need a lock" reflex when the sketch said the state wasn't shared.
- Callers having to know the abstraction's internal rules to use it.
- Two or more independent Phase D deviations of the same shape across the implementation. Surfacing deviations is Phase D's job; a repeated pattern of them is Phase E's trigger.

Use judgment. A few edge cases don't condemn an architecture. Some problems are legitimately complex; complexity in the data is not complexity in the design. The rewrite signal is repeated friction of the same shape, not single hard cases.

When you scrap:

1. Re-run the **how** skill over what's been built. The implementation lessons enter the new design as inputs, not vibes.
2. Redesign as if the new constraints had been day-one assumptions, per redesign-from-first-principles.
3. Subtract before adding, per the **subtract-before-you-add** principle skill. The new sketch should be smaller than the old one before it grows.
4. Return to Phase B and re-run arena.

## Outputs

The caller's usage is written first and the type sketch derived from it. One file with new types and signatures for small changes; module map plus type definitions for larger work. The rationale ships alongside, shaped per `references/rationale-template.md`, including the usage sketch and the synthesis decision.
