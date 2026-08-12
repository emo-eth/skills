---
name: standup-fanout
description: "Fork the daily standup's Today outcomes into isolated Herdr worktrees, run each as its own coding agent in parallel, then integrate only verified changes back into the standup and the source of truth. Use when the standup lists three or more Today outcomes that can be worked independently, and the owner wants them done in parallel instead of one after another. Runs after a standup exists."
argument-hint: "[standup date or file]"
---

# Standup Fanout

The standup lists Today outcomes. Each is a candidate for parallel work. A
fanout takes one outcome, assigns it one isolated worktree and one agent, and
collects only the results that survive verification. It turns the standup from
a plan into a done list in one working session.

The failure this defends against: working all of today's outcomes in one
shared tree, so a half-finished change leaks into unrelated work, proof gets
mixed between outcomes, and a broken run has to be unwound all at once.

Boundary: this is the execution half. The standup must already exist. This
skill never writes the standup's plan or proposes tickets; build the standup
and the goal chain with `standup` first. This skill only runs each planned
outcome and reports what actually happened.

You must be inside a Herdr-managed session. Herdr tools are the only safe
place to run and coordinate agents in parallel. Confirm before you start:

```bash
test "${HERDR_ENV:-}" = 1 && echo herdr-ready
```

If that check fails, do not fan out. Say you are not inside Herdr and stop;
do not try to emulate Herdr from outside it.

## Operating contract

- The source of truth is the verified result, not an agent's claim. An agent
  report is a claim. You apply it only after a focused check reproduces or
  matches it. Do not copy an agent's sentence into the standup because the
  agent said so.
- One outcome gets one tree, one agent, one done-when. Do not merge two
  outcomes into one agent to save a workspace. A tree can hold several related
  source changes only if they share one owner, one done-when, and one result.
- Keep evidence states distinct: planned, in progress, merged, deployed,
  measured, and verified-live are different claims. Report the strongest state
  the evidence supports.
- Never mutate an external ticket, merge a branch, or deploy to an
  environment without the owner's explicit approval. The fanout works code in
  isolated trees; it does not publish.
- Do not touch other people's worktrees or agents. You created the fanout
  workspaces; you close or revert only those.
- The standup is the reporting owner's plan. Assign work the owner owns; do
  not reassign other people's outcomes.
- A seed check that fails is the tree's problem, not a reason to skip the
  check. Do not proceed on a tree whose seed did not pass.

## 1. Read the standup and map the fanout

Read today's standup file:
`docs/log/YYYY-MM-DD-standup.md` (the date is the reporting day, not today's
clock date).

From the standup's `Today` section, list every outcome. For each outcome,
write down:

- the outcome (exact result, not a label),
- the done-when (how you prove it),
- the owner,
- the ticket and its link, if the standup names one,
- the evidence state the standup claims for it now.

Combine outcomes with the same owner, done-when, and result into one slice.
Keep the rest separate. Do not exceed the session's concurrency cap; if the
standup lists more independent outcomes than you can run at once, rank them by
owner priority and run the rest after the first wave.

Outcome without a done-when is not fanout-ready: mark it `GAP`, leave it in the
standup, and put it in the follow-up's open questions. Do not invent a
done-when.

Completion: every Today outcome is either assigned a slice with a done-when or
marked `GAP`; the slices fit the concurrency cap.

## 2. Open one isolated worktree per slice

Create one Herdr worktree workspace per slice. A worktree for a fanout uses a
branch with a name that says what this slice will change, so the branch itself
documents the intent:

```bash
herdr worktree create \
  --base <current-shared-ref> \
  --branch <owner>/<slice-slug> \
  --cwd <the-repo> \
  --no-focus
```

Read the new workspace ID and worktree path from the command's JSON response;
do not guess them. The slice slug is short and names the outcome (for example
`prod-observability`, `opus5-baseline`, `reset-check`), not the date.

Record which workspace, branch, and path belong to which slice before you move
on. If a worktree already exists for a slice from an earlier run, open it
instead of creating another; do not stack two checkouts of the same branch.

Completion: every slice has its own open worktree on its own branch, and each
slice maps to one workspace ID and one path.

## 3. Seed each tree and verify the seed

Give each agent the prerequisites it needs before it can work. In each tree,
run the seed in the tree's directory: install dependencies, generate code the
build needs (for example Prisma), and compile if the slice will edit code.
Confirm the seed actually passes where the fanout runs; do not assume the
parent tree's state carries over.

Then dispatch one agent per slice with a prompt that carries the full
contract, because an agent does not see this conversation:

- the starter branch and its directory,
- the outcome, done-when, and owner,
- the ticket title and link, if any,
- the evidence state the standup currently claims,
- the rule to run the seed first and stop if it fails,
- the rule to record every observed result in a dated log in the tree, with
  the exact object, current state, next action, environment, and proof,
- the rule to write `GAP` or `not verified` for anything unknown instead of
  inventing a value,
- the rule to make no external ticket, branch, or deployment change.

Use the Herdr agent surface to start and address each slice's agent by the
slice name. Read each agent's result from its own pane once it settles.

Completion: every tree's seed passes, every agent is running with a complete,
self-contained contract, and each agent knows to leave external state alone.

## 4. Verify before you integrate

An agent settling is not proof. For each slice, take the agent's claimed
result and test it at its own level: run the focused command or check that
exercises the changed behavior in that tree and read the output. Confirm the
claimed result matches a reproduced result, not the agent's report.

Then classify each slice's outcome as one of:

- verified: a focused check reproduced the claimed result,
- unverified: claimed but not reproduced,
- failed: a check shows the outcome did not happen,
- not done: the agent stopped before the done-when, or marked a needed input
  `GAP`.

For unverified, failed, or not done slices, decide whether a second focused
attempt in the same tree is worth one more round. Do not keep restarting the
same claim; after two failures, record it as not done and move on.

Completion: every slice has a classification backed by a focused check result,
and no `verified` slice lacks its reproducing check.

## 5. Apply and record only what is verified

Bring verified source changes back as the standup's record. How you apply each
change depends on what it is:

- a source or test change: merge the slice's branch into the shared ref you
  opened the worktrees from, or apply the concrete diff to the source tree
  when the fanout runs on the actual source branch;
- a dated evidence log: move or copy the slice's log into
  `docs/log/YYYY-MM-DD-<name>.md` in the shared source and name the
  environment and date it ran on;
- a claimed change to a doc or ticket: this is still unverified unless a check
  reproduced it. Update the standup only with what a check supports.

Leave the slice's worktree open until the branch is merged or the diff is
applied. Do not delete a worktree or branch that still holds unverified or
unmerged work.

Read the outside tool's actual result for any change that touches a ticket,
branch, or deployment: a fanout may propose it, but the verification is the
real read, not the agent's sentence.

Completion: only verified changes landed in the source of truth, every
verified slice has its log in `docs/log/`, and no unverified claim appears in
the standup.

## 6. Fold results back into the standup

Reconcile the verified outcomes into the shared source and the standup:

- Move each verified slice's evidence into the matching standup position and
  update its evidence state to the strongest one the check supports.
- Move any `GAP` or failed slice into the standup's open questions or a dated
  follow-up document, with the next action, owner, and done-when.
- Update `docs/STATE.md` if the project picture changed, in the same change
  as the standup update.
- Do not update a decision log for routine wording. Update it only when a
  decision reversing it would change future behavior.
- Do not close, reprioritize, or create tickets. Put any proposed ticket
  changes in the same follow-up document, marked `proposed, not applied`, and
  ask the owner before any external write.

Completion: the standup, its follow-up, the source logs, and `docs/STATE.md`
agree; every verified outcome shows its real evidence state; every gap and
failure has an owner, next action, and done-when; and no external mutation
happened without approval.

## 7. Report the fanout

Give the owner a short result, in this order:

1. Per slice, the outcome, evidence state, and the focused check that proved
   it.
2. The held-back slices: unverified, failed, or not done, each with why and
   the next concrete action.
3. The workspace IDs and paths for the trees that still hold work.
4. Any proposed ticket delta, marked `proposed, not applied`.
5. The follow-up document link and any open questions needing owner input.

Use normal language for owners. The reader should repeat what changed, what
was proven, and what is blocked after reading it. Name each environment the
result ran on. Do not name a ticket by bare number: use the title and a direct
link, and only after verifying the ticket exists.

Completion: the owner can act on the fanout from the report alone, and every
claim in it is grounded in a reproduced check or marked a gap.
