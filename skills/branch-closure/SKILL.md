---
name: branch-closure
disable-model-invocation: true
description: "Map the current branch or worktree to the tickets it should close, finish the smallest remaining work, prove progress, and split tickets that are too large to close honestly."
argument-hint: "[optional ticket, branch, or worktree context]"
---

# Branch Closure

## Terms

- **Branch**: the line of commits currently checked out.
- **Worktree**: the directory and checkout where this run may read or change files.
- **Branch scope**: the set of ticket results this branch is allowed to change and prove.
- **Closure proof**: the exact observable check a ticket requires before it can be called done.
- **Closure map**: the table that connects each ticket to its result, proof, current evidence, and next action.
- **Ticket grain**: the size of one ticket. A ticket has one owner, one result, and one closure proof.
- **GAP**: required information or evidence that was not found. GAP is not permission to guess.

The failure this skill defends against: a worktree contains code but nobody can
say which tickets it is for, an agent reports progress from commit count or
changed lines, a merge is treated as proof of live behavior, or one large ticket
hides several independent pieces of work. This skill turns the current branch
into a bounded closure map, does the reachable work, and leaves every remaining
piece with a real next action.

Use this skill when the user asks what a branch or worktree is for, which tickets
it should close, whether it can finish them, how far along it is, or how to split
a ticket that cannot be closed as one unit. It is user-invoked. Read this file
before acting.

## Operating contract

- Recover intent from an authoritative ticket, pull request, task brief, or
  explicit user instruction. The diff and commit messages show work performed;
  they do not prove why the branch exists.
- Name the exact branch, worktree path, base ref, ticket title, and direct ticket
  link in the closure map. A bare issue number is not enough.
- A branch may close several tickets only when each ticket has its own result and
  its own satisfied closure proof. Shared code does not merge their proofs.
- Progress means movement toward the stated proof. Do not use changed-line count,
  commit count, or an invented percentage as progress.
- A ticket is `done` only after its stated proof is reproduced. A destination
  status, merge, deploy, or agent report is not proof by itself.
- Preserve work already in the worktree. Do not reset, clean, stash, delete, or
  overwrite changes to make the branch easier to understand. If unrelated work
  is present, classify it as a scope leak and leave it in place.
- Work only inside the current worktree unless the user explicitly asks for
  another path. Do not inspect or modify another person's worktree as if it were
  this branch.
- The request to run this skill authorizes inspection and local work needed to
  reach the named ticket result. It does not authorize merging, deploying,
  deleting a branch, or changing an external tracker. A direct request in this
  run to create, update, split, or close named tickets authorizes those named
  tracker changes; read the destination first and verify every write.
- Use `GAP`, `not verified`, and `proposed, not created` or `proposed, not
  applied` when evidence or access is missing. Never turn an inference into a
  current status.
- Prefer the smallest focused check that proves the ticket. Run broader checks
  only when the ticket's proof requires them.

## 1. Freeze the branch context

Before interpreting the work, establish the checkout that this run owns.

Record:

- current branch name and worktree root;
- the base ref and merge-base commit used for comparison;
- the remote or pull request, if one is authoritative;
- clean, staged, and unstaged changes;
- changed files and commits from the base;
- changes that predate this run or appear to belong to another person.

Resolve the base from an explicit pull request or task source first. If none is
available, use the repository's normal integration ref and state the assumption.
Do not compare against a guessed base without recording it.

Read the complete diff against the resolved base. Separate:

1. branch commits;
2. uncommitted changes;
3. generated or incidental changes;
4. files that cannot be explained by any candidate ticket.

Do not edit until this inventory exists. If the worktree has uncommitted human
work, treat it as protected input, not as a reason to discard or rebuild the
branch.

Completion: the report can name the exact worktree, branch, base, merge-base,
changed files, and protected uncommitted changes.

## 2. Recover the intended tickets

Find the branch's intended work in this order:

1. the user's current instruction and any ticket links they supplied;
2. a pull request title, body, linked issues, or branch handoff;
3. the ticket destination's record, including parent and child relations;
4. the current standup, worktree assignment, task brief, or project state map;
5. branch naming and commit messages as hints only.

Read each candidate ticket completely. For every candidate, capture:

- title and direct URL;
- owner;
- type (build, research, design, operations, or the destination's equivalent);
- priority;
- one concrete output or behavior;
- the closure proof, including its environment;
- current destination status;
- parent, child, and dependency links.

Use the candidate only when a source connects it to this branch. A branch name
such as `fix/auth` or a commit mentioning an issue is evidence of a candidate,
not authoritative assignment. If no source establishes the mapping, report
`GAP: branch-to-ticket mapping not verified`, show the candidates as candidates,
and ask for the ticket link before claiming that any ticket is assigned. You may
still report what the diff changes; do not call that a ticket result.

Completion: every named ticket has a source-backed link to this branch, or the
missing link is an explicit GAP.

## 3. Test ticket grain and branch fit

For each ticket, rewrite its intended result in one sentence. Then check:

- one owner can finish it in this worktree;
- the result is one behavior, artifact, decision, or operational change;
- the proof can be stated as one observable check or a short set of checks for
  that same result;
- the branch changes are all necessary for that result;
- the result does not silently require a second branch, owner, environment, or
  unrelated decision.

Mark a ticket `scope leak` when branch changes cannot be explained by it. Do not
silently attach unrelated changes to the nearest ticket. Mark a ticket
`oversized` when it has independent outputs, mixes build with research or live
observation, names multiple owners, or cannot reach its proof in one worktree.

If a ticket lacks an owner, output, or proof, keep its status `not done` and
propose the missing field. Do not invent a proof from the code that happens to
be present.

Completion: every ticket is classified as fitting this branch, a scope leak,
oversized, or blocked by a missing contract field.

## 4. Build the closure map

Create this map before making new changes:

| Ticket | Result | Closure proof | Evidence in this branch | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| title and direct URL | one result | exact check and environment | files, commits, runs, or GAP | strongest supported status | one concrete action |

Use these status names when they fit the evidence:

- `not done` - the result or proof is not satisfied;
- `implemented` - the local change exists, but later proof remains;
- `merged` - the change is in the required integration ref, but later proof
  remains;
- `deployed` - the required version reached its target environment;
- `measured` - the required measurement was run and recorded;
- `done` - every stated closure proof passed.

Add `blocked`, `awaiting owner input`, `unverified`, `scope leak`, or `oversized`
when one of those conditions explains why the ladder cannot advance. Keep the
underlying status visible; for example, `implemented - awaiting deploy` is more
useful than `blocked` alone.

Classify each row into one of four action groups:

1. **Closeable now** - the proof can be run now and is already satisfied, or the
   smallest missing action is a focused verification.
2. **Finishable here** - the branch has enough scope and access to do the
   remaining local work and then run its proof.
3. **Blocked** - a human decision, credential, external service, deployment,
   owner, or missing source is required.
4. **Needs a split** - the ticket contains independent results or proofs and
   cannot honestly finish as one worktree unit.

Completion: every row has evidence, a status, and exactly one action group.

## 5. Move finishable work to a proof

Start with `closeable now`, then the smallest `finishable here` result that
unblocks the most work. Do not start a new idea because the current branch feels
small.

For each finishable ticket:

1. State the missing result and its closure proof before editing.
2. Make the smallest local changes that produce that result. Keep all changes
   traceable to the ticket.
3. Run the focused test, command, request, observation, or artifact check that
   the proof names.
4. Record the result, exact command or target, environment, and date in the map.
5. Recompute the row's status and next action from the new evidence.

If the proof needs a deploy, live request, measurement, external review, or
owner decision, complete all reachable local work first. Stop at that boundary
with the exact required action; do not simulate the missing proof.

If a check fails, diagnose the failure and fix it when the cause is inside this
branch. After two focused attempts with no progress, record `not done` with the
failure and next action instead of repeating the same run.

If the branch has protected or unexplained changes, do not rewrite them to fit a
ticket. Separate the safe work, show the scope leak, and ask for routing when
needed.

Completion: every `finishable here` row either has a reproduced proof or a
specific blocker that this branch cannot remove.

## 6. Prove and classify the result

Treat claims and proof as separate things. An agent summary, green seed command,
compilation, or merge may support `implemented` or `merged`; it supports `done`
only when it is the ticket's stated proof.

Choose the proof that matches the ticket:

- build: focused tests or a real request through the changed path;
- research: the named comparison, measurement, recommendation, or other
  artifact exists and is readable;
- decision: the decision is recorded with its owner and the work it unblocks;
- operations: the target environment reports the requested state;
- live behavior: exercise one real request or message and observe the relevant
  result on the target surface;
- deploy: confirm the target is running the intended revision, then run any
  separate behavior proof the ticket requires.

A ticket can be ready for an approved close while the branch is still unmerged.
Report both facts: `proof passed; branch not merged`. Do not close the external
record unless the user authorized that named change and the destination confirms
it.

Completion: no row is `done` without a reproduced proof, and every stronger
status names the evidence that supports it.

## 7. Split tickets that cannot close honestly

Use a split when any of these is true:

- the title or description contains two independent results;
- the proof contains independent checks that can pass separately;
- the ticket mixes implementation with deploy, live observation, research, or a
  decision;
- different owners, repositories, worktrees, or environments are required;
- one child can finish while another waits on a human or external system;
- merging this branch would leave the parent outcome materially unproven.

For every proposed child, write:

```text
Parent: <title and direct URL>
Child: <verb-first title>
Owner: <one person or owner unknown>
Priority: <parent priority unless the parent is re-prioritized first>
Why now: <the parent result this enables>
Output: <one artifact or behavior>
Proof needed: <one observable check and environment>
Depends on: <child links or none>
Destination status: proposed, not created
```

Make each child fit one owner-sized worktree and one proof. Keep the parent open
until the child proofs together satisfy the parent's closure proof. Do not make
a child named `finish the rest`; give it the missing result and its own check.

If the user explicitly asked in this run to split a named ticket, apply the
approved split only after reading the destination's fields and existing grain.
Create or update records one at a time when the destination supports verification,
then re-read every resulting parent and child. If the destination cannot be read
or written, return the full breakdown as `proposed, not created`.

Completion: every oversized ticket has either verified child records or a
complete proposed breakdown with owners, outputs, proofs, dependencies, and a
clear parent rule.

## 8. Record external changes safely

Before changing a tracker, show the delta for the named ticket:

- `CREATE` child ticket;
- `UPDATE` missing result or proof;
- `CLOSE` only after the proof passed;
- `DEFER` with a revisit trigger;
- `REPRIORITIZE` only when the reason and affected work are explicit.

Use `proposed, not created` or `proposed, not applied` until the destination
confirms the write. After an applied change, query the destination by direct ID
and verify title, parent or child relation, changed fields, URL, and status.

Do not merge, deploy, delete the branch, or delete the worktree as part of this
skill unless the user separately names that action. Do not claim a ticket close
from a local edit or a proposed tracker delta.

Completion: every external mutation is either verified in the destination or
clearly labelled proposed and not applied.

## 9. Report the branch honestly

Lead with the answer, then the evidence:

```text
## Branch purpose
- Worktree:
- Branch:
- Base and merge-base:
- Intended tickets:
- Scope verdict:

## Closure map
<table with one row per ticket>

## What changed in this run
- local changes and focused checks, or `Nothing changed`

## Can close now
- ticket, proof, and destination action (if any)

## Still finishable here
- ticket, remaining work, and next proof

## Blocked or needs a split
- ticket, exact blocker or proposed children

## Ticket changes
- applied and verified changes;
- proposed, not applied changes;
- `None` when there are none.

## Finish line
- the exact observable result that would make this branch and its tickets ready;
  if it is not reached, name the next owner, action, environment, and proof.
```

Cite the source for each intent claim and the exact check for each evidence
claim. Say `Nothing from you right now` only when the branch has a reachable
next action and no human dependency. If a decision, access grant, value, or
approval is the smallest missing step, list it once with the context needed to
answer it.

Completion: a reader can tell what this branch is for, which tickets it can
close, what was proved, what remains, who owns the next action, and what exact
check ends the work. No claim relies on branch vibes or code volume.
