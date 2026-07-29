---
name: context-steering
description: "Run an isolated, read-only reflection checkpoint that checks a long-running agent's root context for goal drift, missing constraints, compaction damage, and verification gaps, then returns at most one concise steering prompt. Use before major mutations, after context resets or repeated retries, when a phase changes, or whenever a delegated worker may be solving the wrong problem."
argument-hint: "[checkpoint or run context]"
---

# Context Steering

Use this as a small control loop around long-running agent work. The root agent owns the task, tools, side effects, and final decision. Reflectors are read-only sensors; they do not implement, edit, broaden scope, or declare completion.

## Quick start

1. Build a compact root-context packet from the user goal, source-of-truth requirements, standing constraints, done/proof conditions, current plan, current evidence, open decisions, and the next mutation. Do not paste the full transcript or secrets.
2. Fork one isolated `context-reflector` subagent with the packet. It answers only: **does the root context need a steering prompt before the next mutation?** Native fork/delegation hosts can use the contract directly. If the host resolves agent files from a shared directory, run `scripts/install-agents.sh` once from the installed skill directory (`--copy` freezes the prompt; the default symlink tracks updates).
3. Require the JSON contract in [references/reflector-contract.md](references/reflector-contract.md).
4. Validate the result before consuming it:

   ```sh
   python3 scripts/validate-reflection.py < reflection.json
   ```

5. Apply exactly one result:
   - `continue`: proceed; do not manufacture a prompt.
   - `steer`: inject the returned prompt into the next root/worker turn, then continue the planned work.
   - `block`: stop mutation and gather the named missing evidence or ask the human a focused question.

## When to checkpoint

Use a checkpoint at a meaningful boundary, not on every turn:

- after reconnaissance and before the first consequential edit;
- after compaction, `/clear`, a fresh-context handoff, or a lost-context warning;
- after two failed retries or repeated work on the same symptom;
- when the user corrects scope, priorities, constraints, or the definition of done;
- before a high-impact phase transition or irreversible/external action;
- every 3–5 iterations in a long loop when no other trigger fires.

Skip it for a tiny, deterministic one-command task. After applying a steering prompt, perform one material work step before running another checkpoint unless new contradictory evidence appears.

## Fork and safety policy

- One reflector is the default. Use two independent reflectors for high-risk work (alignment and proof), and three only when their evidence sources are genuinely different.
- Give reflectors read-only access. They may inspect packet-named files, diffs, or logs, but must not edit files, run external side effects, contact the user, or dispatch more agents.
- A reflector may recommend a prompt, not silently change the plan. The root agent checks it against direct user instructions, source-of-truth documents, and safety rules before applying it.
- If reflectors disagree about a material constraint, return `block`; do not average contradictory requirements into mush.
- If the host cannot provide an isolated fork, use a fresh context for the reflector. For high-risk work, do not substitute an unmarked same-context self-review and call it independent.

## What a good steering prompt contains

A useful prompt is short, evidence-backed, and corrective: name the observed drift or missing constraint, state the priority to restore, and name the next verification. It must not invent requirements, reopen settled decisions without evidence, or include a second plan disguised as a correction. Keep it to 2–6 sentences.

## Durable receipt

For long-running or unattended work, save a small checkpoint receipt outside the agent's prose: run/checkpoint ID, root-context reference or hash, reflector count, decision, evidence inspected, prompt applied (if any), and the next verification. Do not persist raw transcript content or secrets. A `block` receipt needs an owner for resolving the missing input.

## Related boundary

`lc-project-state` preserves durable project orientation across fresh contexts. `fresh-eyes` cold-reads prose artifacts before they ship. `context-steering` checks whether the *current* root is still aligned before work continues. It is a complement, not a replacement, for project state, cold-reader validation, tests, or external verification.

## References

- [Reflector contract and host adapters](references/reflector-contract.md)
- [Source notes and adoption boundary](references/source-notes.md)
- [Bundled read-only agent](agents/context-reflector.agent.md)
- [Optional agent installation bridge](scripts/install-agents.sh)
