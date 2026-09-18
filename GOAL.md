# Goal: OMP /linear command: out-of-band issue creation with /btw-style sidecar interaction

Linear parent: [EMO-425](https://linear.app/emo-eth/issue/EMO-425/omp-linear-command-out-of-band-issue-creation-with-btw-style-sidecar)
Herdr: linear-command (w2E)
Worktree: `/Users/emo/.herdr/worktrees/skills/linear-command`

Standing instruction: update Linear only when intention, vibe, done-when, or map actually changes.

## Proposed Done Definition
1. `plugins/linear-command/` package implemented with:
   - `package.json`, `plugin.json`, `tsconfig.json` matching repository conventions.
   - Core triage and command runner in `src/record.ts` / `src/linear.ts`.
   - Host integration in `src/host.ts`, `src/omp.ts`, and `src/pi.ts`.
2. Native `/linear` slash command registered in OMP (and Pi):
   - Accepts prompt arguments or prompts interactively when bare.
   - Out-of-band execution: does not append to the active session conversation journal, adding zero tokens to the primary context.
   - Collects ambient context (cwd, repo name, git branch, session/turn metadata).
   - Classifies/maps taxonomy: Team (`EMO`), Projects (`Creatordex`, `Saddle`, `BMO / Springfield`, `Personal / Ops`), Review Buckets (`01 Personal and life` .. `10 Protocols, security, and effect gates`), Issue types (`Bug`, `Feature`, `Improvement`), Priority (1 Urgent .. 4 Low).
   - Interactive preview/confirmation via `ctx.ui.confirm` / `ctx.ui.input` when interactive UI is available.
   - Creates issue via `linear issue create` CLI execution, notifying the user with the issue identifier and URL.
3. Tests:
   - Unit tests for argument parsing, taxonomy matching, and execution.
   - Host adapter tests for OMP and Pi.
   - Native OMP runner test verifying extension loading and execution under `@oh-my-pi/pi-coding-agent`.
4. Documentation and Project State:
   - `docs/STATE.md` updated with the `linear-command` plugin entry.

## Proposed Acceptance Criteria
- `npm run check` (TypeScript typecheck) in `plugins/linear-command/` passes cleanly.
- `npm test` passes all tests (unit tests + native OMP runner).
- Execution produces correct CLI invocation flags (`--team`, `-t`, `-d`, `-p`, `-l`, `--project`, `--no-interactive`).
- Primary conversation context is never polluted.

## Proposed Validation Plan
- Run `npm test` in `plugins/linear-command/` covering:
  - Argument parsing & flag extraction.
  - Project and review bucket taxonomy classification.
  - Confirmation and execution through mock runner.
  - Native OMP `ExtensionRunner` command invocation.
