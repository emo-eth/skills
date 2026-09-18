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

- `--project Creatordex` fetches ALL open tickets in that project: assigned to anyone, any priority (including Urgent). Then the operator ranks them (L/R/T).
- Do NOT skip already-Urgent when `--project` is set.
- Do NOT use viewer.assignedIssues for `--project`.
- `--team EMO` is a team key. Never pass `--team creatordex`. `--project creatordex` is case-insensitive project name.
- Proof: `./tools/prioritize-linear-tickets.ts -k 5 --project Creatordex --reset` must print TOP 5 of ~40+ tickets, not TOP 0, and must not print Skipping already-Urgent.
- Ticket-scoped tests. Ready PR. Ship/merge origin/main (operator said ship this flag).
- Check in via standup INBOX.md with Linear HTTPS + PR HTTPS. Never prompt w2D:p1.

## Map

- Herdr: prioritize-project-flag (w46)
- Worktree: `/Users/emo/.herdr/worktrees/skills/prioritize-project-flag`
- Files: `tools/prioritize-linear-tickets.ts`, `tools/linear-client.ts`, `tools/prioritize-linear-tickets.test.ts`
