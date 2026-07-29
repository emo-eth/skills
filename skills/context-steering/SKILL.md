---
name: context-steering
description: "Run an opt-in, read-only reflection checkpoint for a multi-step agent task when the user requests steering or strong drift signals appear—compaction, repeated retries, scope correction, or a high-risk action—then return at most one concise steering prompt."
---

# Context Steering

Use this as a small control loop around long-running agent work. The root agent owns the task, tools, side effects, and final decision. Reflectors are read-only sensors; they do not implement, edit, broaden scope, or declare completion.

## Quick start

1. Build a compact root-context packet from the user goal, source-of-truth requirements, standing constraints, done/proof conditions, current plan, current evidence, open decisions, and the next mutation. Do not paste the full transcript or secrets.
2. Fork one isolated `context-reflector` subagent with the packet. It answers only: **does the root context need a steering prompt before the next mutation?** Native fork/delegation hosts can use the contract directly. If the host resolves installed agent files, run `scripts/install-agents.sh` once from the installed skill directory; the bridge selects Codex TOML, OpenCode Markdown, or the generic Claude-style adapter (`--copy` freezes the prompt, `--force` replaces a collision with a backup, and the default symlink tracks updates).
3. Require the JSON contract in [references/reflector-contract.md](references/reflector-contract.md).
4. Validate the result before consuming it. Resolve the helper from the installed skill's resource path; do not assume the project working directory is the skill directory:

   ```sh
   python3 /absolute/path/to/context-steering/scripts/validate-reflection.py < reflection.json
   ```

   When already in the installed skill directory, `python3 scripts/validate-reflection.py < reflection.json` is equivalent. If the host cannot expose helper files, enforce the same contract in the root turn; do not silently skip validation.

   If validation fails, never inject the result. Retry once with the same packet and a format reminder; if the retry fails or validation is unavailable, block the next mutation, record the failure, and gather evidence or ask a focused question.

5. Apply exactly one result:
   - `continue`: proceed; do not manufacture a prompt.
   - `steer`: inject the returned prompt into the next root/worker turn, then continue the planned work.
   - `block`: stop mutation and gather the named missing evidence or ask the human a focused question.

## When to checkpoint

Use a checkpoint at a meaningful boundary only when the user requested steering or the controller explicitly enabled this mode:

- after compaction, `/clear`, a fresh-context handoff, or a lost-context warning;
- after two failed retries or repeated work on the same symptom;
- when the user corrects scope, priorities, constraints, or the definition of done;
- before a specifically high-risk, irreversible, or external action;
- before the first consequential edit when the task is high-risk and steering was explicitly enabled;
- every 3–5 iterations only in an explicitly enabled periodic mode.

Do not checkpoint ordinary phase changes or every major mutation by default. Skip it for a tiny, deterministic one-command task. After applying a steering prompt, perform one material work step before running another checkpoint unless new contradictory evidence appears.

## Fork and safety policy

- One reflector is the default. Use two independent reflectors for high-risk work (alignment and proof), and three only when their evidence sources are genuinely different.
- Give reflectors read-only access. They may inspect packet-named files, diffs, or logs, but must not edit files, run external side effects, contact the user, or dispatch more agents.
- Aggregate multiple results deterministically: any `block` wins and unions the evidence/missing context; if all results are `continue`, continue; if any result is `steer`, reduce only compatible steers describing the same bounded correction to one prompt. A material `continue`/`steer` disagreement or incompatible steers becomes `block` with `reconcile reflector disagreement` as missing context. Never choose by majority or confidence alone.
- A reflector may recommend a prompt, not silently change the plan. The root agent checks it against direct user instructions, source-of-truth documents, and safety rules before applying it.
- If the host cannot provide an isolated fork, use a fresh context for the reflector. For high-risk work without either primitive, block and obtain an owner/user decision or an approved independent verifier; resume only after that receipt. Do not substitute an unmarked same-context self-review and call it independent.

## What a good steering prompt contains

A useful prompt is short, evidence-backed, and corrective: name the observed drift or missing constraint, state the priority to restore, and name the next verification. It must not invent requirements, reopen settled decisions without evidence, or include a second plan disguised as a correction. Keep it to one compact paragraph and at most 1200 characters; usually 1–6 sentences.

## Durable receipt

For long-running or unattended work, return a small structured checkpoint receipt to the controller by default: run/checkpoint ID, root-context reference or hash, reflector count, decision, evidence inspected, prompt applied (if any), and the next verification. Persist it only when the caller supplies an existing run/checkpoint store with its own retention and cleanup policy. Never invent a path or write runtime state into the skill or project repository. Do not persist raw transcript content or secrets. A `block` receipt needs an owner for resolving the missing input.

## Related boundary

`lc-project-state` preserves durable project orientation across fresh contexts. `fresh-eyes` cold-reads prose artifacts before they ship. `context-steering` checks whether the *current* root is still aligned before work continues. It is a complement, not a replacement, for project state, cold-reader validation, tests, or external verification.

## References

- [Reflector contract and host adapters](references/reflector-contract.md)
- [Source notes and adoption boundary](references/source-notes.md)
- [Bundled host adapters](agents/context-reflector.agent.md), [Codex TOML](agents/context-reflector.toml), and [OpenCode Markdown](agents/context-reflector.opencode.md)
- [Host-format receipts](references/host-format-receipts.md)
- [Optional native agent installation bridge](scripts/install-agents.sh)
