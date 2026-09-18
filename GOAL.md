# Goal: Ranker --project filter

Linear: [EMO-456](https://linear.app/emo-eth/issue/EMO-456/ranker-project-filter)
Herdr: prioritize-project-flag (w46)
Worktree: `/Users/emo/.herdr/worktrees/skills/prioritize-project-flag`

Standing instruction: update Linear only when intention, vibe, done-when, or map actually changes.

## Intention

Allow operator and automation to rank Linear tickets scoped to a specific project (`--project <name|uuid|slug>`) without rewriting ranking UX.

## Vibe

Targeted attention over whole-backlog noise. Filter before ranking, preserve apply to Linear. Clean CLI ergonomics.

## Done-when

1. `tools/linear-client.ts` fetches all open project issues across all assignees when `--project` is specified via `fetchProjectIssues`, supporting project name, UUID, or slug ID.
2. `tools/prioritize-linear-tickets.ts` supports `--project <name|uuid|slug>` (all assignees, not assigned-to-me), combinable with `--team`.
3. CLI `--help` includes updated `--project` usage specifying all assignees, not assigned-to-me.
4. APPLY mode writes back updated priorities/ranks correctly to Linear.
5. Unit tests for linear-client and prioritize-linear-tickets project filtering pass.
6. Ready PR created and shipped/merged to origin/main.

## Map

- Herdr: prioritize-project-flag (w46)
- Worktree: `/Users/emo/.herdr/worktrees/skills/prioritize-project-flag`
- Files: `tools/prioritize-linear-tickets.ts`, `tools/linear-client.ts`, `tools/prioritize-linear-tickets.test.ts`
