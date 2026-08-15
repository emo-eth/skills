---
name: standup-fanout
description: "Fork the daily standup's Today work into isolated Herdr worktrees, assign each worktree specific tickets it aims to close, run one or more coding agents per tree under Herdr orchestration, and integrate only verified results back into the standup and the source of truth. Use when the standup lists three or more tickets that can be worked independently, and the owner wants them done in parallel instead of one after another. Runs after a standup exists."
argument-hint: "[standup date or file]"
---

# Standup Fanout

The standup names Today's work. Each work item resolves to tickets. A fanout
assigns each ticket its own isolated worktree — one ticket per worktree by
default — and asks Herdr to drive the coding agent in that tree toward closing
the ticket's sub-tickets. It turns the standup from a plan into a list of
closed or proven tickets in one working session.

The failure this defends against: working all of today's tickets in one shared
tree, so a half-finished change leaks into unrelated work, proof gets mixed
between tickets, an agent can stall waiting for an input it may never get, and
a broken run has to be unwound all at once.

Boundary: this is the execution half. The standup and its tickets must already
exist. This skill never writes the standup's plan; build the standup and the
goal chain with `standup` first. This skill only drives tickets toward done and
reports what actually happened.

You must be inside a Herdr-managed session. Herdr is the orchestrator here; it
owns panes, agents, worktrees, and cross-agent communication. Confirm before
you start:

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
- One worktree holds exactly one ticket by default. Do not merge two tickets
  into one tree just to save a checkout; the count is what keeps the fanout
  independently verifiable and swappable. Only two tickets that are genuinely
  one result — one owner, one done-when, one proof, and no separable value —
  share a worktree, and say why when they do. Two tickets with different
  done-when or proof belong in different worktrees. When one ticket's work or
  proof depends on another ticket's, keep them in separate worktrees and stack
  the dependent branch (Section 3) instead of merging the tickets into one
  tree.
- A ticket that cannot be implemented atomically in one worktree is not crammed
  into a tree. It is broken into sub-tickets, each of which fits one tree or one
  tree's proof. Do the breakdown visibly and get owner sign-off before you
  create sub-tickets.
- Keep evidence states distinct: planned, in progress, merged, deployed,
  measured, and verified-live are different claims. Report the strongest state
  the evidence supports.
- Never mutate an external ticket, merge a branch, or deploy to an environment
  without the owner's explicit approval. The fanout drives tickets toward done
  in isolated trees; it publishes only what the owner approves.
- A source or test change lands in `dev` only through a pull request, and that
  PR must be merged by a human. The fanout and its agents open the PR and
  prepare it for merge; they never merge code into `dev` themselves. A branch
  is not merged into `dev` by automation, by an agent, or by the fanout
  orchestrator.
- Verification and research work do not create a PR. Run the required check or
  produce the stated artifact, then record the result in the dated evidence log
  and standup. Only create a PR when the work changes source or tests.
- An agent asks for human input when it needs an answer only a person has:
  a decision between options, a missing credential or value, an approval, or a
  fact the code cannot reveal. An agent that needs such input stops and asks
  rather than guessing. Relay the question to the owner with the exact context
  the agent needs; do not let the agent guess a secret or a policy choice.
- Do not touch other people's worktrees or agents. You created the fanout
  workspaces; you close or revert only those.
- The standup is the reporting owner's plan. Assign tickets the owner owns; do
  not reassign other people's tickets.
- A seed check that fails is the tree's problem, not a reason to skip the
  check. Do not proceed on a tree whose seed did not pass.

## 1. Read the standup and map tickets to worktrees

Read today's standup file:
`docs/log/YYYY-MM-DD-standup.md` (the date is the reporting day, not today's
clock date).

From the standup, list every ticket today's work points to. For each ticket
write down:

- the ticket title and direct link (verify it exists in the destination; never
  cite a bare number),
- its done-when (how you prove it),
- the owner,
- the type (build, research, design, ops, or the destination's equivalent),
- the current evidence state the standup claims for it.

Give each ticket its own worktree. Only tickets that are literally one result
(one owner, one done-when, one proof) share a tree, and say why. When tickets
depend on each other they stay in separate worktrees and their branches are
stacked (Section 3) rather than grouped. Do not exceed the session's
concurrency cap; if the standup names more independent worktrees than you can
run at once, rank by owner priority and run the rest after the first wave.

A ticket without a done-when is not fanout-ready: mark it `GAP`, leave it in
the standup, and put it in the follow-up's open questions. Do not invent a
done-when.

Repeat this phrase for the owner before dispatching: every worktree closes one
named ticket, a ticket too big for one tree becomes sub-tickets, and a ticket
that needs another's work branches its tree on top of it.

Completion: every Today ticket is assigned to a worktree with a done-when, or
marked `GAP`; the worktree count fits the concurrency cap.

## 2. Decide what each worktree closes

For each worktree's ticket, decide how it reaches done. A ticket closes when
its proof is satisfied. Proof is satisfied one of three ways:

- merge: the ticket's code change is written, tested, and merged;
- observe: the ticket's question is answered by observing deployed state, a
  live environment, or the results of running tests or an eval;
- research: the ticket produces its stated output (comparison, measurement,
  recommendation, or another concrete artifact).

Write down, per ticket, which of the three will satisfy it and the exact proof
needed.

If a ticket cannot be implemented atomically in a single worktree — because it
spans layers, needs a separate deploy before it can be verified, mixes build
and research, or has more than one independent done-when — break it into
sub-tickets:

- each sub-ticket has one owner, one done-when, one output, and one proof;
- a sub-ticket inherits its parent's priority; no sub-ticket gets a different
  priority from the parent unless the owner re-prioritizes the parent first;
- build sub-tickets land code; observe sub-tickets verify deployed or live
  state; research sub-tickets produce the artifact;
- a parent ticket stays open until its sub-tickets' proofs are satisfied.

Show the owner the proposed breakdown (parent, sub-tickets, and how each
sub-ticket's proof connects to the parent's done-when) and get explicit
approval before creating any sub-ticket. Until approval, mark the breakdown
`proposed, not created`.

The sub-ticket breakdown process itself is not settled. If the fanout reaches
this step, do not invent a new convention: propose it in the follow-up, and
record it. The owner is tracking how this should work through a dedicated
ticket; check whether that ticket still needs input and flag anything new the
fanout revealed. Use the canonical `standup/references/ticket-contract.md` for
the fields every proposed ticket must carry before the breakdown goes to the
owner.

Completion: every worktree has a decided exit (merge, observe, or research)
with the exact proof; oversized tickets have an approved sub-ticket breakdown
or a `proposed, not created` one in the follow-up.

## 3. Open one isolated worktree per ticket

Create one Herdr worktree workspace per ticket. Each worktree's handle carries
the Linear ticket name so the workspace list shows which ticket a tree is for
at a glance: set `--label` from the ticket (an identifier-slug like
`ABC-101-auth-refresh`), and keep the branch as `<owner>/<ticket-slug>`:

```bash
herdr worktree create \
  --base <base-ref> \
  --branch <owner>/<ticket-slug> \
  --label <ticket-name> \
  --cwd <the-repo> \
  --no-focus
```

The base ref is the shared base (`dev`) by default. Build worktrees branch
independently and land source or test changes as their own PRs. Verification
and research work may use a worktree for isolation, but they finish by
running the check or producing the artifact; they do not create a PR or merge
anything. Use **stacked PRs** only when one code ticket's work depends on
another: create the dependent worktree with `--base <dependency-branch>`
instead of `dev`, so it builds on the ticket it needs rather than duplicating
or guessing. The stack lands in dependency order — merge the dependency's PR
first, then the dependent PR shows only its own diff and can be reviewed and
merged on top. Keep a stack serial and shallow: one dependency per PR, and
only stack where a real dependency exists, never to save worktree count. A
worktree with no dependency branches from `dev`.

Read the new workspace ID and worktree path from the command's JSON response;
do not guess them. The slug is short and names the ticket (for example
`synthetic-apex-age`, `opus5-baseline`, `reset-check`), not the date.

Record which workspace, branch, path, and Linear name belong to which ticket
before you move on. If a worktree already exists for a ticket from an earlier
run, open it instead of creating another; do not stack two checkouts of the
same branch.

Completion: every ticket has its own open worktree on its own branch, and each
worktree maps to one workspace ID and one path.

## 4. Seed each tree, verify the seed, and launch its agent

Give each agent the prerequisites it needs before it can work. In each tree,
run the seed in the tree's directory: install dependencies, generate code the
build needs (for example Prisma), and compile if the ticket edits code. Confirm
the seed actually passes where the fanout runs; do not assume the parent tree's
state carries over.

Then launch one or more coding agents per tree through Herdr. Herdr is the
orchestrator: it starts agents, watches their lifecycle, and lets them
communicate when a tree needs more than one agent or when work crosses trees.
Use multiple agents when one tree spans independent sub-tickets or when two
trees' work depends on the same knowledge; let Herdr route the discussion. Do
not run agents side by side without Herdr as the coordinator.

Each agent prompt carries the full contract, because an agent does not see this
conversation:

- the starter branch and its directory,
- the ticket or sub-ticket title and link, and its done-when,
- the exit chosen (merge, observe, or research) and the exact proof,
- the evidence state the standup currently claims,
- the rule to run the seed first and stop if it fails,
- the rule to record every observed result in a dated log in the tree, with
  the exact object, current state, next action, environment, and proof,
- the rule to write `GAP` or `not verified` for anything unknown instead of
  inventing a value,
- the rule to make no external ticket, branch, or deployment change,
- the rule to stop and ask for human input when a decision, credential, value,
  or approval only a person can provide is required — and to never guess it.

Use the Herdr agent surface to start and address each agent by name. Read each
agent's result from its own pane once it settles. If Herdr reports an agent
`blocked` (an approval or question UI), relay the material to the owner and do
not let the agent guess past it.

Completion: every tree's seed passes, every agent is running with a complete,
self-contained contract under Herdr coordination, and each knows to leave
external state alone and to ask for human input rather than guess.

## 5. Verify before you integrate

An agent settling is not proof. For each tree, take the agent's claimed result
and test it at its own level: run the focused command or check that exercises
the changed behavior in that tree and read the output. Confirm the claimed
result matches a reproduced result, not the agent's report.

Then classify each ticket as one of:

- done: the proof for its exit was satisfied and reproduced,
- verified: the claimed result matched a reproduced check,
- unverified: claimed but not reproduced,
- failed: a check shows the proof did not happen,
- awaiting input: the agent blocked on a decision, credential, value, or
  approval that only a person can provide,
- not done: the agent stopped before the done-when, or marked a needed input
  `GAP`.

For any ticket awaiting input, collect the concrete question(s) and bring them
to the owner in one list with the exact context each answer needs. Do not
restart the agent until the owner answers; do not let it guess.

For unverified, failed, or not done tickets, decide whether a second focused
attempt in the same tree is worth one more round. Do not keep restarting the
same claim; after two failures, record it as not done and move on.

Completion: every ticket has a classification backed by a focused check, no
`done` or `verified` ticket lacks its reproducing check, and every awaiting-input
question is queued for the owner.

## 6. Apply and record only what is verified

Bring verified results back as the standup's record. How you apply each change
depends on what it is:

- a source or test change: open a pull request from the tree's branch into
  `dev` (the base the worktrees branched from), with the evidence and
  evidence-state recorded. Do not merge the branch into `dev` yourself: a
  human must review and merge the PR. The tree's branch stays open until that
  human merge happens;
- a verification ticket: run the exact check that proves its done-when, record
  the environment, date, result, and any gap in the dated evidence log, then
  update the standup. Do not create a PR or merge a branch for verification
  alone;
- a research ticket: produce its stated comparison, measurement,
  recommendation, or other artifact in the dated evidence log, then update the
  standup. Do not create a PR or merge a branch for research alone;
- a claimed change to a doc or ticket: this is still unverified unless a check
  reproduced it. Update the standup only with what a check supports.

Leave a code worktree open until a human merges its PR into `dev`. A
verification or research worktree can close after its check or artifact is
recorded and no uncommitted work remains. Do not delete a worktree or branch
that still holds unverified or unmerged source changes.

Read the outside tool's actual result for any change that touches a ticket,
branch, or deployment: a fanout may propose it, but the verification is the
real read, not the agent's sentence. Do not close a ticket on a merge alone
when its proof also requires deploy, observe, research, or owner sign-off.

Completion: only verified changes landed in the source of truth, every
verified ticket's log is in `docs/log/`, and no unverified claim appears in the
standup.

## 7. Fold results back into the standup

Reconcile the verified outcomes into the shared source and the standup:

- Move each verified ticket's evidence into the matching standup position and
  update its evidence state to the strongest one the check supports.
- Move any `GAP`, `failed`, `not done`, or `awaiting input` ticket into the
  standup's open questions or a dated follow-up document, with the next action,
  owner, and done-when.
- Put every proposed sub-ticket breakdown and proposed ticket close in the
  follow-up, marked `proposed, not created` or `proposed, not applied`, and ask
  the owner before any external write.
- Update `docs/STATE.md` if the project picture changed, in the same change
  as the standup update.
- Do not update a decision log for routine wording. Update it only when a
  decision reversing it would change future behavior.
- Record what the fanout learned about breaking tickets into sub-tickets, so
  the owner's dedicated ticket on that mechanism gets real evidence.
In batch mode, when the last open child proof passes, `standup-fanout`
aggregates the child evidence and applies the parent close when authorized.

Completion: the standup, its follow-up, the source logs, and `docs/STATE.md`
agree; every verified ticket shows its real evidence state; every gap, failure,
and awaiting-input question has an owner, next action, and done-when; and no
external mutation happened without approval.

## 8. Report the fanout

Give the owner a short result, in this order:

1. Per worktree, the tickets it closed or proved, each with its evidence state
   and the focused check that proved it.
2. The tickets awaiting input: the exact question, the context the agent needs,
   and the worktree it blocks.
3. The held-back tickets: unverified, failed, or not done, each with why and
   the next concrete action.
4. Any proposed sub-ticket breakdown, marked `proposed, not created`, and any
   proposed ticket close, marked `proposed, not applied`.
5. The workspace IDs and paths for the trees that still hold work.
6. The follow-up document link and any open questions needing owner input.

Use normal language for owners. The reader should repeat what changed, what
was proven, and what is blocked after reading it. Name each environment the
result ran on. Do not name a ticket by bare number: use the title and a direct
link, and only after verifying the ticket exists.

Completion: the owner can act on the fanout from the report alone, every claim
in it is grounded in a reproduced check or marked a gap, and every question an
agent needs answered is on one list the owner can answer.
