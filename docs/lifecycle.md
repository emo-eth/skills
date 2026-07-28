# Lifecycle management

Which skills maintain the project's living record, what file each owns, and when
each fires. This is the navigation doc for that subset — not an index of every
installed skill.

## The test for what belongs here

**A lifecycle-management skill owns a file that outlives the session.**

That is the whole discriminator. `code-review` finds bugs and owns nothing —
its output dies with the conversation. `project-state` owns `docs/STATE.md`,
which is still there next week. Only the second kind is lifecycle management.

Applied to ~107 installed skills, this leaves **eight**. Everything else is
build / verify / review tooling: useful, invoked ad hoc, irrelevant to the
question "how does the project remember things."

## Two chains, not one

Conflating these is what makes the set feel incoherent.

**The artifact chain** — how an idea becomes shipped code. Each stage is a
contract for the next; each is written once and amended deliberately.

```
vibe.md → PRD → spec → plan → implementation
```

**The record chain** — how what happened survives context death. Append-only or
continuously re-verified; never "finished."

```
decisions → state map → briefing
```

`north-star` owns the artifact chain and is well covered. The record chain is
where the gaps are, and it is what answers "what shipped," "what's left,"
"what's blocked on me."

## The eight

| Skill | Owns | Fires when | Invoked by |
| --- | --- | --- | --- |
| `north-star` | `docs/prds/<date>-<topic>/vibe.md`, `prd.md` | starting something new; amending the contract | you |
| `review-capture` | `docs/DECISIONS.md`, `docs/taste.md` | every human review round, always | auto — never you |
| `project-state` | `docs/STATE.md` (the map) | bootstrap once per repo, then sync every session | you, or session end |
| `project-status` | nothing — read-only | you want a briefing | you |
| `ticketize` | tracker items (Notion / Linear / Issues) | a settled plan must become assigned work | you |
| `phase-tracker` | `PROGRESS.md` | inside one task of 3+ sequential phases | auto, mid-task |
| `session-handoff` | `HANDOFF.md` | ending a session with unfinished work | you, or session end |
| **capability registry** | `docs/capabilities.md` | **does not exist yet** — see Gap | — |

Read the trigger column twice. `review-capture` is never yours to type; it runs
itself every round. `phase-tracker` fires inside a task, not at its start. Most
of the confusion about "when do I use these" is that only four of the eight are
things you invoke at all.

## When to run what

- **Starting fresh work** → `north-star`, then `ticketize` once the plan settles.
- **Any session in a repo with no `docs/STATE.md`** → `project-state bootstrap`, once.
- **Asking where things stand** → `project-status`. Read-only, safe any time.
- **End of any session that changed understanding or code** → `project-state sync`,
  in the same commit as the work. This is the one habit the rest depends on;
  skip it and the map becomes a lie within a week, and a stale map is worse than
  no map because it gets trusted.
- **Ending mid-task** → `session-handoff`.
- **A review round came back** → nothing. `review-capture` handles it.

## Known collisions

Unresolved conflicts between skills in this set. Settle these before adding a
ninth artifact.

1. **Root-vs-`docs/log/`.** `phase-tracker` writes `PROGRESS.md` and
   `session-handoff` writes `HANDOFF.md`, both at repo root. `project-state`'s
   standing rule is that root holds only README / AGENTS / config, and dated
   session artifacts go to `docs/log/YYYY-MM-DD-<name>.md`. Two skills in this
   set violate a third's invariant.
2. **Two decision logs.** `review-capture` writes `docs/DECISIONS.md` and states
   "the log is the ADR." `domain-modeling` (not in this repo) writes
   `docs/adr/NNNN-*.md` for the same purpose. Consolidate on `DECISIONS.md`;
   leave `CONTEXT.md` owning vocabulary only.
3. **Unpublished members.** `phase-tracker`, `session-handoff`, and
   `comeback-recovery` are not in this repo and not in
   `~/.agents/.skill-lock.json` — they exist on one machine only, and drift from
   every other one. Three of the eight are outside the source of truth.

## Gap: the capability registry

Nothing in the set enumerates **what the product does**. Every artifact above
records *process* — where we are, why we chose, what happened when — or is a
frozen contract. None answers "which features exist, and which are actually
supported end-to-end."

That is a domain record, and it cannot be retrofitted into the others:
`STATE.md` has a 1–2 page cap that dozens of feature rows destroy, and the PRD
is immutable after approval while features accrete.

The missing artifact: `docs/capabilities.md`, one row per capability →
implementing code → support level → evidence tier → gap note. Support levels
align to the tiers already used in `STATE.md`: `absent` / `partial` (gap note
required) / `wired` (= documented) / `live` (= verified-live). Derived from code
wherever a registry or enum exists — a hand-maintained inventory of dozens of
rows rots faster than the map, and a rotted registry is worse than none because
its size reads as authority. One `STATE.md` topic row points at it, keeping the
map within its cap.
