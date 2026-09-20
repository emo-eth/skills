# GOAL: Ticket Ranker TUI On-Screen Controls, Delete/Done Triage Actions, and Progress Counter

**Owning Ticket:** [EMO-488](https://linear.app/emo-eth/issue/EMO-488/ticket-ranker-tui-on-screen-controls-deletedone-triage-actions-and-x)
**Worktree:** `/Users/emo/.herdr/worktrees/skills/ranker-triage-controls`

## Done Criteria
1. Persistent command instructions banner rendered on all triage and comparison cards (`[Y] Yes  [N] No  [D] Delete/Cancel  [C] Mark Done  [Q] Pause/Quit`).
2. Immediate triage deletion action implemented on key `D` (or `d`): marks ticket canceled/deleted in Linear via linear API and removes from active triage cards.
3. Immediate triage completion action implemented on key `C` (or `c` / `X`): marks ticket completed/Done in Linear via linear API and removes from active triage cards.
4. Persistent `[Ticket X of Y (Z%)]` progress counter displayed on every card.
5. All tests in `tools/prioritize-linear-tickets.test.ts` pass, plus new tests covering `D`, `C`, and progress rendering.
6. Ready-for-review GitHub PR opened on `emo-eth/skills` (`isDraft: false`).

## Acceptance Criteria
- When running `tools/prioritize-linear-tickets.ts --bin` or `--rebin`, the operator sees clear keyboard commands at the bottom of the screen at all times.
- Pressing `D` removes the ticket from triage and updates Linear to canceled.
- Pressing `C` removes the ticket from triage and updates Linear to Done.
- The progress counter accurately reflects `X of Y` without jumping or vanishing.

## Validation Criteria
- `npm test` or `node --experimental-strip-types --test tools/prioritize-linear-tickets.test.ts` passes with 100% success.
- Interactive dry-run / stdin test verifying key handling for `D`, `C`, and progress strings.
