---
name: ticketize
disable-model-invocation: true
description: "Turn crystallized thinking — a problem map, plan doc, spec, or post-synthesis understanding — into tickets a team can actually pick up. Use when the user says 'ticket this out,' 'break this into tasks,' or 'populate the board'; when a planning doc needs to land in a tracker (Notion, Linear, GitHub Issues); or as the step after synthesize or north-star when understanding must become assigned work."
---

# Ticketize

The failure this skill defends against: "tickets" that are actually ideas —
"explore X and create tickets" — which hand the real planning to whoever picks
them up; and ticket text so machine-flavored that no teammate believes a human
wrote it.

> **WIP.** This skill is being figured out in use. After each real run, invoke
> `skill-iteration` on it with what worked, what read wrong, and what the user
> corrected.

## 1. Find the destination and its exemplar

Tickets land somewhere — a board, a tracker, a sprint doc. Read the destination
before writing anything: its fields, its ID scheme, and how granular the
existing tickets are. The existing tickets are your **exemplar** — match their
format and grain exactly, and extend the set that's there rather than replacing
it. Arriving with a competing set is both a bad look and harder to merge.

If there is no destination yet, use the default fields: ID, name, type
(build / research / design / ops), priority, one-line description. Priorities
are **P labels** (P0 = blocks others or the demo, P1 = core path, P2 = polish
or stretch) — not week or date labels; dates drift, priorities don't. When
joining an exemplar that schedules differently, mirror the exemplar.

Completion: you can state the destination's fields, ID scheme, and grain — or
you have declared the default because none exists.

## 2. Gather the crystallized thinking

Ticketize only what is already understood. Collect: the problem map / plan /
spec being decomposed, the project's state map (`docs/STATE.md` or equivalent),
its standing constraints, and any prior art the repo has already verified. If
no doc states what the work is for, stop — run a synthesis pass first
(`synthesize`, `north-star`). Ticketing vibes produces "explore this idea"
tickets, the exact failure this skill exists to prevent.

Completion: every input doc is listed; standing constraints and verified prior
art are noted for step 4.

## 3. Decompose

One ticket = one owner-sized chunk of work with a **done-when**: the observable
state that closes it. Rules, applied to every ticket:

- **Decisions are tickets.** A decision gets an owner, a date, and a list of
  the tickets blocked on it. Work that presupposes an undecided choice links
  to the decision ticket — it never silently assumes the answer.
- **Research names its artifact.** "Comparison grid + a pick," "memo with a
  recommendation" — never "explore" or "look into."
- **Epics split.** A description holding two deliverables is two tickets.
- **Prior art travels.** When the repo already answers part of a ticket, the
  description says where in one line, so nobody re-researches what's known.

Completion: every ticket has a done-when, a priority, a type, and one
deliverable; no research ticket lacks a named artifact.

## 4. Diff against what exists

Compare the new set against the destination's existing tickets and the
project's state. Four checks, run explicitly:

- **Fake-open decisions** — a ticket "evaluates X vs Y" while sibling tickets
  already hardcode X. Either the decision is made (say so; demote the
  evaluation to a confirmation) or the siblings get marked blocked on it.
- **One decision, two owners** — the same choice split across workstreams'
  tickets. Merge to one ticket, one owner.
- **Unclaimed constraints** — a standing constraint from the state map that no
  ticket carries. Add the ticket or flag the gap.
- **Overlaps** — where the new set covers ground an existing ticket owns,
  propose replacement description text for theirs; don't create a duplicate.

Completion: all four checks ran; findings appear in the output as amendments
and flags, never as silent fixes to someone else's tickets.

## 5. Write like a teammate wrote it

Tickets are read by coworkers, not agents. Kill **neuralese** — words no
teammate would say out loud (elicitation, durable artifact, arming, posture,
surface, leverage). Read each description aloud; if it sounds like a bot,
rewrite it from what a person would actually say: *"'Actually, pause that' has
to work."* A term the project genuinely needs gets defined once at the top of
the output, then used plainly everywhere else.

Completion: the read-aloud pass ran on every description; at most one or two
defined terms survive, defined once.

## 6. Land it

Deliver three things: the ticket set in destination format; a **back-map**
(every area of the source thinking → the ticket(s) that cover it, so gaps are
visible rather than vibes); and the decisions-to-force list for the next
meeting. When writing to the tracker directly: one test row first, user
sign-off, then the batch, then re-query the tracker to verify the full set has
no duplicates or gaps. If the repo keeps a state map, update it in the same
commit.

Completion: the back-map shows no uncovered area; the tracker (if written) is
verified by re-query; the state map reflects where the tickets now live.
