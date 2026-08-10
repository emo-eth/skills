---
name: standup
disable-model-invocation: true
description: "Create or revise a daily standup aligned to weekly and monthly goals; turn feedback into ticket and priority changes; present clear ownership, evidence, blockers, and decisions."
---

# Standup

Read `GLOSSARY.md` before the first run. This skill is user-invoked because a
standup changes planning state and may propose external ticket changes.

A standup is a short decision surface, not a work diary. It answers four
questions in order: what changed, what matters today, what is blocked, and
what the owner must decide.

## Operating contract

- Treat the existing goal and ticket sources as authoritative. Do not invent a
  monthly goal, weekly priority, owner, due date, or completion claim.
- Separate the reporting owner's work, other people's work, and shared work.
  Attribute work to a person or workstream when the source supports it. If
  ownership is unknown, say `owner unknown`.
- Keep evidence states distinct: planned, in progress, merged, deployed,
  measured, and verified-live are different claims. Report the strongest state
  supported by evidence, not the state that sounds most complete.
- Default to a high-level day view. Do not make an hour-by-hour schedule unless
  the user asks for one.
- Keep routine feedback lightweight. Apply inline corrections in the current
  standup and show a short change list. The rendered standup is opened in
  Plannotator once per day (step 6); never launch a second session over it
  for a normal daily edit. If a submitted Plannotator review comes back, run
  `lc-review-capture`; that review is the exception because its decisions must
  be retained.
- `lc-ticketize` and `lc-review-capture` are sibling procedures in this skills
  repository. If either is not installed in the current agent, use the ticket
  contract directly; for submitted review feedback, first copy the raw
  comments to a dated log, answer every comment by number, and record durable
  decisions before applying changes. Never claim an external write or a
  captured review that did not happen.
- Never silently change an external ticket or release plan. Show a ticket
  delta first. Apply it only after the user explicitly asks to create, update,
  close, or reprioritize the named items.

## 1. Load the planning spine

Read, in this order:

1. The current standup and its last follow-up, if they exist.
2. The project state map (`docs/STATE.md` or its equivalent).
3. The monthly goal source and the weekly goal source. Find them from the
   state map or the user's supplied context; do not assume filenames. If no
   separate weekly file exists but the current standup or supplied context has
   explicit weekly outcomes, use it as a `provisional weekly source` and label
   it that way.
4. The ticket destination and a small set of recent tickets. Read its fields,
   status names, priority scale, ownership rules, and existing grain before
   proposing a ticket. If the destination is named but its adapter or fields
   are unavailable, record `destination known, fields unverified` and do not
   claim current ticket status.
5. The current date and reporting timezone. Use the repository or user
   setting; do not infer a timezone from a timestamp. If either source is
   missing, mark it `GAP` and ask for it.
Write down the sources used. If a goal or ticket destination is missing, keep
that gap visible and ask one bundled question at the end instead of filling it
with a plausible plan. Put all missing-source questions in one numbered
`Questions for owner` list under `Decisions and blockers`; one item may cover
several missing sources. A provisional weekly source is not a missing source,
but it stays labeled until the owner names the authoritative weekly source.

Completion: the monthly, weekly, and current-day sources are named, or each
missing source is marked `GAP`; a provisional weekly source is labeled; and
the ticket destination's fields and grain are known or marked unverified.

## 2. Reconcile new context and feedback

Process every new statement before drafting the standup. Classify it as one of:

- fact correction
- new fact
- ownership correction
- priority or due-date change
- ticket request
- decision
- open question

For each item, record the old claim, the corrected claim, and the source. Remove
superseded claims from the standup; do not leave both versions for politeness.
When an ownership correction changes who did the work, move the item between
`My update`, `Other work`, and `Shared work`; keep the old attribution only in
the change record.
Do not turn doubt into a failure: use `unmeasured`, `unverified`, or `owner
decision needed` when that is what the evidence says.

Completion: every user correction or context item appears in the change list or
in the open-questions list, and no corrected claim remains in the draft.

## 3. Build the goal alignment

Build a three-level chain:

`monthly outcome -> weekly outcome -> today's result`
Each item in today's result list must point to one weekly outcome and one
monthly outcome. If it does not, place it under `unattached work` and ask
whether to remove it, link it, or create a goal. Do not use a date as a
substitute for a goal. Keep it in the rendered `Unattached work` section; link
it from `Questions for owner` when it needs an answer and from `Follow-up` when
it needs operational detail. Never drop it from the saved standup.

Keep the daily list to three to five outcomes. Combine work that has one owner,
one done-when, and one result. Split work when ownership or done-when differs.

Completion: every daily outcome has a goal path, an owner, an evidence state,
and a done-when; unattached work is explicit.

## 4. Prepare ticket changes

Run this step when the user asks to create tickets, reprioritize them, or when
a new outcome needs a tracked unit of work. Read
`references/ticket-contract.md`, then use `lc-ticketize` for the detailed
decomposition.

Produce a ticket delta before any external write:

- `CREATE`: one owner-sized chunk with one observable done-when.
- `UPDATE`: exact fields that change, with old and new values.
- `REPRIORITIZE`: old priority, new priority, the goal or evidence that caused
  the change, and the tickets that become blocked or unblocked.
- `CLOSE`: the evidence that satisfies done-when. Do not close on a merge alone
  when deployment or live verification is part of done-when.
- `DEFER`: the revisit trigger and the goal that will bring it back.

Decisions are tickets when work depends on them. Give the decision one owner,
one due point, and the dependent tickets. Do not create two decision tickets
for one choice. Use `proposed, not created` for a new ticket and
`proposed, not applied` for a change to an existing ticket until the user
approves it. If the destination cannot be written from the current tools,
mark the delta `proposed, not created` or `proposed, not applied` as
appropriate and put it in the follow-up document.

Completion: every proposed ticket has a type, owner, priority, goal path,
done-when, evidence state, and destination status; every update names its
before and after values; no external mutation happened without explicit
approval.

## 5. Render the standup

Write the first screen for a teammate who has no time to study the repository.
Use this order:

1. `At a glance` - three to five bullets: what changed, today's result, largest
   blocker, owner decision, and send or release gate if one exists.
2. `My update` - completed work owned by the reporting owner, with ownership
   and evidence labels.
3. `Other work` - work from other people or workstreams, clearly attributed.
4. `Shared work` - work done by more than one person or workstream, with each
   supported contributor named.
5. `Today` - three to five high-level outcomes, each with its ticket and
   done-when.
6. `Unattached work` - results with no goal path, each with its reason and
   proposed next action.
7. `This week` - the weekly outcomes and their current status.
8. `This month` - the monthly outcomes and what this week contributes.
9. `Decisions and blockers` - only items that need an owner or external input.
10. `Questions for owner` - one numbered list containing all bundled questions
    for missing sources, unresolved ownership, or unattached work.
11. `Follow-up` - links to operational detail, open questions, and proposed
    ticket deltas.
12. `Sources used` - the goal, state, ticket, and evidence sources behind the
    claims. Put this last so it supports trust without crowding the summary.

This order maps the opening questions to visible sections: what changed to
`At a glance`, what matters today to `Today`, what is blocked to `Decisions and
blockers`, and what the owner must decide to `At a glance` plus
`Decisions and blockers`.

Use plain words. Define a term once in the glossary or at first use. Name a
count, ticket, model, or release only when the source is known. Keep details
that help someone inspect the system in the follow-up document, not in the
opening summary.

Completion: a teammate can repeat what changed, today's result, the owner
decision, and the largest blocker after reading the first screen; every claim
has a supported owner or shared attribution and an evidence state; unattached
work is visible; no hour-by-hour schedule appears unless requested.

## 6. Persist the result

Update the existing daily file in place when one exists:

`docs/log/YYYY-MM-DD-standup.md`

Create `docs/log/YYYY-MM-DD-standup-follow-up.md` when the standup has
operational steps, inspection instructions, unresolved questions, unattached
work, or ticket deltas that do not belong in the first screen. This includes
any `proposed, not created` or `proposed, not applied` delta. Use these
headings in the follow-up: `Operational checks`, `Open questions`,
`Unattached work`, and `Ticket deltas`; each item names its owner or
`owner unknown`, next action, done-when, and evidence state. Update the
existing daily and follow-up files in place on the same date; do not create a
second-round copy. Use the same filename and path on revision so review tools
retain their history.

After the files are written, open the standup for the owner in Plannotator:
`plannotator annotate docs/log/YYYY-MM-DD-standup.md`, launched detached
(`nohup ... & disown`), never as a harness-tracked background task, and
report the local URL. One session per standup file: if a session already
serves that file, do not relaunch — a relaunch resets the owner's
unsubmitted draft, and updating the file in place is enough. Revisions on
the same date reuse that session.

If the project state or decisions changed, update `docs/STATE.md` and the
append-only decision log named by the state map. If the state map names no
decision log, mark that destination `GAP` and do not invent a filename.
Record a durable decision only when reversing it would change future behavior.
Keep routine wording fixes out of the decision log.

Completion: the standup, any follow-up, ticket delta, state map, and decision
record agree; every source used in step 1 is either reflected or intentionally
left unchanged with a reason; the standup is open in one Plannotator session
and the owner has its URL.

## 7. Handle lightweight follow-up

When the user sends ordinary chat feedback after the standup:

1. Apply the correction without opening a review session.
2. Return `Applied`, `Still open`, and `Ticket changes` in three short lists.
3. Re-render only the affected standup sections.
4. Record a decision only when the feedback settles future behavior or scope.

When the user submits Plannotator feedback, stop applying changes until
`lc-review-capture` or the minimum review pass above has snapshotted the raw
feedback, answered every comment by number, and recorded durable decisions.
Then refresh the same files in place; do not launch a new review session for
routine edits.

Completion: every inline correction has a visible result, every unresolved
choice is assigned to an owner, and a later standup can find the durable source
of each changed decision.
