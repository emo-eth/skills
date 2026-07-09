---
name: contract-audit
description: "Adversarial contract audit for checking a spec, plan, code diff, branch, implementation, demo, or shipped behavior against an approved PRD and optional vibe.md. Use when the user asks to audit, verify alignment, find discrepancies, loop adversarial reviewers, or ensure downstream work does not violate product requirements or vibe. Use prd-grill instead when grilling the human on whether the PRD/vibe matches their expectations."
---

# NM Contract Audit

Use this skill to find where downstream work violates, narrows, omits, or mutates the product contract.

This is not a generic review. The PRD and `vibe.md` are the source of truth; the target artifact is guilty until it proves traceability. A vibe violation is a contract violation.

## Dependencies (subagents)

This skill dispatches a panel of reviewer subagents (see `references/agent-loop.md`). Those agents are bundled with the skill in `agents/*.agent.md` so they travel with it — `npx skills` copies the whole skill directory, but it does **not** place subagents into the host tool's agents directory. Run the one-time install step so they resolve:

```sh
# from the installed skill directory
bash scripts/install-agents.sh          # symlinks agents into ~/.claude/agents (and other detected tools)
# or: bash scripts/install-agents.sh --copy   # hard-copy instead of symlink
```

Re-run after `npx skills update`. If a referenced reviewer is missing, the audit will note the gap and continue with the reviewers that are available.

## Artifacts

- **PRD:** immutable product intent: requirements, undesirable outcomes, success criteria, scope boundaries, and explicit deferrals.
- **vibe.md:** immutable qualitative contract: how the product must feel, when that feel matters, and what anti-vibes are forbidden.
- **Target:** one of spec, plan, code diff, branch, implementation, demo, or shipped behavior.
- **Intent ledger:** a compact table of every PRD and vibe obligation that the target must satisfy.
- **Audit report:** findings that name the violated contract item, evidence from the target, and the required correction or amendment.

## Workflow

### 1. Locate Source And Target

Find the approved PRD first. Use explicit paths, `source_prd` frontmatter, plan/spec links, recent `docs/prds/`, or ask the user if more than one PRD plausibly applies.

Find `vibe.md` when it exists. Use explicit paths, `source_vibe` frontmatter, a sibling `vibe.md`, a `*-vibe.md` beside a flat PRD, or ask the user if more than one vibe file plausibly applies.

Find the target artifact next. If the target is code, inspect the diff and the relevant current files, not only a summary.

Completion criterion: the PRD, any applicable `vibe.md`, and target are read, and the review scope is clear enough that a finding can cite exact contract text and exact target evidence.

### 2. Build The Intent Ledger

Extract the PRD and `vibe.md` into a checklist before reviewing the target. Include:

- Requirement IDs and acceptance criteria.
- `Not acceptable` clauses and undesirable outcomes.
- Vibe IDs, promises, violations, anti-vibes, use circumstances, and checks.
- Success criteria.
- Scope boundaries and explicit deferrals.
- Platform, permission, data visibility, error, empty, loading, persistence, and performance promises.
- Open questions or amendment rules.

Use [references/audit-passes.md](references/audit-passes.md) for the required pass list and finding schema.

Completion criterion: every review pass can point to the ledger instead of relying on memory or vibes.

### 3. Audit The Target

Run all applicable passes from the reference:

- Coverage: PRD or vibe obligations missing from the target.
- Drift: target behavior that contradicts, narrows, or expands contract intent.
- Counterexample: concrete scenarios that produce a forbidden outcome.
- Verification: tests, demos, monitoring, manual checks, or qualitative reviews that fail to prove contract satisfaction.
- Layering: spec, plan, or implementation changing the PRD or vibe without an approved amendment.

For specs and plans, review document text. For implementation, review code paths, tests, generated behavior, and any runnable verification that is practical for the change.

Completion criterion: every ledger row is classified as satisfied, violated, unproven, intentionally out of scope, or requiring contract amendment.

### 4. Use Adversarial Agents When Allowed

If subagent tools are available and the user asked for adversarial agents, delegation, looping reviewers, or similar, dispatch independent reviewers. Otherwise run the personas inline.

Use [references/agent-loop.md](references/agent-loop.md) for persona selection, prompts, synthesis, and loop rules.

Completion criterion: adversarial findings are synthesized into one deduplicated audit report; no persona finding is ignored without a stated reason.

### 5. Resolve Findings

Classify each finding:

- **Fix downstream:** target contradicts the contract and the contract is still right.
- **Update spec:** implementation discovery changes technical design without changing product intent.
- **Update plan:** sequencing or execution detail changed.
- **Request contract amendment:** satisfying reality requires changing product behavior, scope, success criteria, platform support, data visibility, undesirable outcomes, or vibe.
- **Accept residual risk:** user explicitly accepts the remaining gap.

Do not edit the PRD or `vibe.md` unless the user explicitly asks. Do not treat implementation convenience as a contract amendment.

Completion criterion: every P0/P1/P2 finding has a fix, amendment request, or explicit user acceptance.

### 6. Loop Until Satisfied

When the user wants the loop, apply approved fixes, update the living spec or plan as needed, rerun the audit, and compare the new report to the previous report.

Stop only when:

- No open P0/P1/P2 PRD/vibe violations remain.
- Remaining P3 risks are listed with owner and acceptance status.
- The spec, plan, and implementation no longer disagree about product behavior.
- Any desired PRD or vibe change is represented as an explicit amendment request, not hidden in downstream work.

## Output Shape

Lead with findings. Use this format:

```markdown
## Contract Audit Report

Source PRD: `path`
Source vibe: `path or none`
Target: `path`, diff, branch, or artifact
Result: pass | pass-with-residual-risk | fail

### Findings

[P1] R3 - Mobile completion silently narrowed to desktop-only
- PRD intent: [brief quote or paraphrase]
- Vibe intent: [brief quote or paraphrase, if applicable]
- Target evidence: [file/section/line or behavior]
- Why this violates intent: [concrete discrepancy]
- Required resolution: fix downstream | update spec | update plan | request contract amendment | accept residual risk

### Ledger Summary

| Contract item | Status | Evidence |
| --- | --- | --- |
| R1 | satisfied | ... |
| V1 | violated | ... |

### Residual Risk

- [Risk, owner, acceptance status]
```

Suppress vague concerns. A contract finding needs contract intent, target evidence, and a concrete way the two diverge.

Use `fail` when any unaccepted P0/P1/P2 finding remains. Use `pass-with-residual-risk` only when remaining issues are P3 or explicitly accepted. Use `pass` only when every ledger row is satisfied or deliberately out of scope.
