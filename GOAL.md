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

1. `tools/linear-client.ts` GraphQL fetches project { id name } and allows filtering by project name, UUID, or slug ID.
2. `tools/prioritize-linear-tickets.ts` supports `--project <name|uuid|slug>`, combinable with `--team`.
3. CLI `--help` includes `--project` usage.
4. APPLY mode writes back updated priorities/ranks correctly to Linear.
5. Unit tests for linear-client and prioritize-linear-tickets project filtering pass.
6. Ready PR created and shipped/merged to origin/main.

## Map

- Herdr: prioritize-project-flag (w46)
- Worktree: `/Users/emo/.herdr/worktrees/skills/prioritize-project-flag`
- Files: `tools/prioritize-linear-tickets.ts`, `tools/linear-client.ts`, `tools/prioritize-linear-tickets.test.ts`
