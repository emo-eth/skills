---
name: maintain-verification-skill
description: "Keep an installed OMP or Pi verification skill and feature map aligned with source and live behavior. Use for /maintain-verification-skill or \"audit the verify skill\"."
disable-model-invocation: true
---

# Maintain a verification skill

Read `pstack-runtime` before the first host-specific operation.

A feature map rots when the app changes. This workflow maintains a `verify-*` skill whose source lives under `~/dev/skills/skills/`. Cover every feature file from source and exercise every feature on its real user surface.

## Outcomes

Pick one, and say which:

- **clean**: every feature has source and live coverage; no source change.
- **changed**: one committed and pushed skill update contains proven corrections.
- **blocked**: coverage could not finish or a correction could not ship safely. Name the blocker.

## Edit scope

Only edit the verification skill's own directory (its SKILL.md, features/, and any harness scripts it owns). Never edit product code during a run: a behavior the map describes that the app no longer does is either doc drift (fix the map) or a product regression (report it, don't paper over it in docs).

## Pass

0. **Locate the target.** Find `~/dev/skills/skills/verify-*/SKILL.md` files with launch, drive, and feature-map sections. If several match the active project and the tools cannot determine which one owns it, use `ask`. If none match, route to `/create-verification-skill`.

1. **Index hygiene.** Read the feature map README and glob its sibling files. Fix missing, extra, duplicate, or dead entries. Lightweight; no generated inventory.

2. **Source wave.** Launch one read-only `scout` per feature file in one OMP `task` batch. Each explains how the user-facing feature works from source, cites likely doc drift, and returns one concise live-verification recipe. Scouts never drive the app or edit files.

3. **Reconcile.** Every feature file has a returned summary. Merge overlapping recipes into as few app states as practical. Spot-check cited drift; don't re-prove clean claims. Sweep recent churn for user-facing surfaces missing from the map — require a concrete source path before calling one missing.

4. **Live pass.** Required even when source looks clean. The coordinator drives the real surface. Use OMP `browser` for web UI, the actual program in a PTY or managed process for CLI/TUI, and the verification skill's launch contract for other surfaces. Exercise every mapped feature. Run doctor before the first drive, after a failed drive, and for every fresh short-lived session. Reset or relaunch any instance whose visible state is wedged even when its process is healthy. Preserve evidence after cleanup.

5. **Triage.** Wrong user description is doc drift. An undrivable working feature is a harness gap. Fix only the verification skill. Broken product behavior is a product gap; report it without changing product code in this run.

6. **Ship or stop.** For changed, follow `~/dev/skills/AGENTS.md`: re-read changed files, commit, push `main`, and run `npx skills update`. For clean or blocked, make no commit and report coverage honestly.

Keep concise run notes (features covered, unreachable prerequisites, confirmed drift, outcome) in a scratch location; don't commit them.
