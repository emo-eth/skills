---
name: standup
disable-model-invocation: true
description: "Create or revise one short daily standup that turns current work, goals, and ticket evidence into clear priorities, ownership, decisions, and proposed ticket changes."
---

# Standup

A daily standup is one short decision document. It answers:

1. What changed?
2. What matters today?
3. What is blocked?
4. What must the owner decide?

Do not read or create a glossary for a standup. Use normal words. Do not use
`goal path`, `done-when`, `unattached work`, or `evidence state` in the
standup. Say `why this matters`, `how we will prove it`, `open work`, and
`current status` instead.

## Operating contract

- Use current goal, state, ticket, and code sources. Do not invent a goal,
  priority, owner, due date, or completion claim.
- Report status in plain terms. Use `not done`, `implemented`, `merged`,
  `deployed`, `measured`, or `done` only when the source supports it. Do not
  ask the reporting owner to sign off their own work. If validation remains,
  say `not done: validate ...`. A destination status of Done is a fact; it
  does not prove live behavior without the required evidence.
- This is the reporting owner's standup. Report only their work, decisions,
  and blockers. Mention another person's work only when it changes the
  owner's next action; do not create an `Other work` section.
- Keep the daily plan to three to five results. Each result names its owner,
  why it matters now, the ticket when one exists, the current status, and how
  we will prove it.
- When the route to an outcome is vague, decompose it into small proposed
  tickets before claiming that the outcome is today's work. A model-routing
  result, for example, needs separate work to define the evaluation set, run
  the current-model baseline, choose a candidate, compare the results, and
  change routing.
- A due date is a planning signal. It can change during planning. Do not ask
  the owner to confirm that due dates are the weekly source. If no weekly plan
  exists, create a short `Working week` view from current priorities and due
  dates, and label it as a working plan.
- Keep the daily document short enough to read and discuss in ten minutes.
  Do not create a same-day follow-up document. Put the small amount of
  inspection detail needed for today's work in the daily document. A separate
  weekly planning document is allowed when the owner asks for one.
- Use both observability surfaces for their distinct jobs. Railway's service
  page covers deploy health, service logs, CPU, memory, and request signals.
  The existing application `/admin` view covers per-turn, inference, tool,
  workflow-step, and application-event detail. Do not replace one with the
  other. `ADMIN_PASSWORD` is the secret value in the deployed service
  environment; say where the variable is stored, never print its value.
- A fresh worktree may hold each day's standup. The next day's run reads the
  current state and ticket sources again. It does not treat an archived
  worktree as current evidence.
- Routine edits update the same standup file in place. A submitted Plannotator
  round runs `lc-review-capture`: snapshot raw comments, answer every comment
  by number, record durable decisions, apply the changes, and reuse the active
  review session.
- Never silently change an external ticket or release plan. Show a ticket
  delta first. A clear owner instruction in chat or submitted review feedback
  to create, update, assign, close, or reprioritize a named ticket is explicit
  approval for that named change. Apply it, then verify the destination state.

## 1. Load the planning spine

Read, in this order:

1. The current standup file, if it exists.
2. The project state map (`docs/STATE.md` or its equivalent).
3. The monthly goal source and the current working-week source. Find them from
   the state map or supplied context. If no weekly file exists, use current
   priorities and ticket due dates as a `Working week` view; do not invent a
   formal weekly goal.
4. The ticket destination and a small set of recent tickets. Read its fields,
   status names, priority scale, ownership rules, and existing ticket grain
   before proposing a change.
5. The current date and reporting timezone. If either source is missing, mark
   it `GAP` and ask one bundled question at the end.

List the sources at the bottom of the standup. A missing goal source or ticket
destination stays visible as a gap. Never fill a missing source with a plausible
plan.

## 2. Reconcile new context

Process every new statement before drafting. Classify it as a fact correction,
new fact, ownership correction, priority or due-date change, ticket request,
decision, or open question.

For each correction, replace the old claim. Keep a short change record in the
review answers document when the change came from Plannotator. Do not leave
the old claim in the standup for politeness.

Use `unmeasured`, `unverified`, or `not done: validate ...` when the source
supports no stronger claim.

## 3. Build today's plan

For each of three to five results, write:

- the result in plain language;
- the owner;
- why it matters now;
- the existing ticket, if any;
- the current status;
- how we will prove it.

Link the result to the monthly outcome and the current working-week priority in
plain words. Do not call this a goal path. If a result has no such reason,
place it under `Open work` with a reason and a proposed next action. Do not
silently drop it.

When a result is vague, make the missing work visible as proposed tickets. One
proposal has one owner, one output, and one proof. Do not pretend that a
comparison, measurement, or recommendation exists before its setup work does.

## 4. Prepare ticket changes

Read `references/ticket-contract.md` when a ticket change is needed. Use the
existing ticket grain. A ticket should be one owner-sized result, not a whole
uncertain project.

Every proposal states:

- title;
- type;
- owner;
- priority;
- why now;
- output;
- proof needed;
- current evidence or status;
- destination status.

Use `proposed, not created` for a new ticket and `proposed, not applied` for
an existing-ticket change until it is applied. For an explicit owner request,
apply the named change and verify it. Do not close a ticket on a merge alone
when its proof also requires deployment, measurement, live behavior, or
validation.

A decision becomes a ticket only when it blocks named work. Give the decision
one owner and one due point. Do not create two tickets for one decision.

## 5. Render one short standup

Use this order:

1. `Say this aloud` - two to four sentences the owner can repeat at an
   in-person standup. Use plain results and blockers, not ticket names or
   ticket states.
2. `My update` - the reporting owner's work, with current status and what
   remains.
3. `Today` - three to five results with tickets, owners, reasons, status, and
   proof.
4. `Open work` - only work not placed in Today that still needs an owner,
   ticket, or decision.
5. `Decisions` - only choices or blockers that need owner input.
6. `Proposed tickets` - only new or changed ticket records; state clearly that
   they are not applied unless they were explicitly requested and verified.
7. `This week` - a short preview of current priorities, not a second plan.
8. `This month` - a short preview of monthly outcomes and this week's part.
9. `Sources used` - the sources behind the claims.

Keep ticket titles and direct links in the written sections. Do not put ticket
labels in the spoken summary. Use plain descriptions. Replace abstract labels
with the action and the proof. For example, write `Add known-answer behavior
tests to CI` instead of `Deploy-gate test set`, and write `things required
before sending to dinner guests` instead of `release gate`. If a stronger
public-release checklist is also relevant, label it `before public release`;
do not mix it with the dinner-guest checklist.

## 6. Persist the result

Update the existing file in place:

`docs/log/YYYY-MM-DD-standup.md`

Do not create `docs/log/YYYY-MM-DD-standup-follow-up.md` for a daily standup.
Keep the daily document self-contained and short. Create a separate weekly
planning document only when the owner asks for the longer planning session.

If state or a durable decision changed, update `docs/STATE.md`, the append-only
decision log named there, and `docs/taste.md` when the round revealed a
standing preference. Record a decision only when reversing it would change
future behavior.

After writing, reuse the existing detached Plannotator session for the same
standup file. Never relaunch over a live session: that destroys unsubmitted
comments. Report the existing local URL.

## 7. Handle feedback

For ordinary chat feedback, return three short lists: `Applied`, `Still open`,
and `Ticket changes`. Re-render only the affected sections.

For submitted Plannotator feedback:

1. Copy the raw feedback verbatim to
   `.context/review/YYYY-MM-DD-standup-round-N.md`.
2. Answer every numbered comment in
   `docs/log/YYYY-MM-DD-standup-feedback-answers-round-N.md`, including where
   each fix landed and what still needs owner input.
3. Record each durable decision with the exact supporting quote.
4. Update the state map and taste notes when the decision changes future work.
5. Apply changes to the same standup file and reuse its review session.
6. Do not claim a ticket write, review capture, or live proof that did not
   happen.

Completion means the one daily document, ticket changes, state map, decisions,
answers, and review session agree. The owner can repeat the first section in a
few sentences and can see every unresolved choice without reading another
same-day file.
