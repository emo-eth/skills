# Lifecycle management

Which skills maintain the project's living record, what file each owns, and when
each fires. This is the navigation doc for that subset — not an index of every
installed skill.

## The test for what belongs here

**A lifecycle-management skill owns a file that outlives the session.**

That is the whole discriminator. `code-review` finds bugs and owns nothing —
its output dies with the conversation. `project-state` owns `docs/STATE.md`,
which is still there next week. Only the second kind is lifecycle management.

Applied to ~107 installed skills, this leaves **nine** — eight that own a file,
plus two read-only members (`project-status`, `comeback-recovery`) that own
nothing but exist only to read this set. Everything else is build / verify /
review tooling: useful, invoked ad hoc, irrelevant to the question "how does the
project remember things."

The two readers answer different questions, and conflating them is easy:
`comeback-recovery` resumes **the task you were on**; `project-status` briefs on
**the project** — what shipped, what is left, what is blocked on you.

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
| `phase-tracker` | `.context/progress.md` (gitignored) | inside one task of 3+ sequential phases | auto, mid-task |
| `session-handoff` | `docs/log/YYYY-MM-DD-handoff.md` | ending a session with unfinished work | you, or session end |
| `comeback-recovery` | nothing — read-only | resuming an in-flight task after a gap | you |
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

## Where session state goes

Two homes, chosen by the nature of the file — not one catch-all directory.

| | `.context/` | `docs/log/` |
| --- | --- | --- |
| Nature | mutable working state for one task | dated artifact, written once |
| Lifespan | discarded when the task ends | permanent; never pruned |
| Committed | no — gitignored | yes |
| Example | `.context/progress.md` | `docs/log/2026-07-28-handoff.md` |

The repo root holds only README, AGENTS/CLAUDE, and config. Nothing in this set
writes there.

## Cross-tool portability

The artifacts are fully portable by design — `STATE.md`, `DECISIONS.md`,
`docs/log/`, `.context/progress.md` are plain markdown, and `project-state`'s
definition of done requires no tool-specific machinery. Codex, Cursor, and
opencode read them natively.

The skills are mostly portable. Six own nothing but file I/O and work anywhere:
`project-status`, `north-star`, `ticketize`, `phase-tracker`, `session-handoff`,
`comeback-recovery`. Three degrade rather than break:

- `project-state` — the step-5 fresh-chat test spawns `fresh-eyes`, which needs
  subagents. Without them, open a literal fresh session in another tool and ask
  it the question. That is a *stronger* test than the subagent version, since it
  also proves a non-Claude tool can orient from the map.
- `review-capture` — one subagent hop for applying feedback; do it inline instead.
- `contract-audit` — not in this set, but bundles `agents/*.agent.md` and is
  effectively Claude-only.

**Wire `AGENTS.md`, not only `CLAUDE.md`.** The `@`-import direction decides
whether other tools see the convention at all: `CLAUDE.md` importing `AGENTS.md`
works everywhere, the reverse hides the map from every non-Claude tool. When
`project-state` bootstraps a repo, the three directives go in `AGENTS.md`.

## Resolved conflicts

Kept as a record of why the layout is what it is.

1. **Root-vs-`docs/log/`** — `phase-tracker` and `session-handoff` both wrote to
   repo root, violating `project-state`'s invariant. Resolved by the split
   above: the progress checklist is runtime state (`.context/`, gitignored,
   because a checklist shipping in commits causes cross-machine churn), the
   handoff is durable dated history (`docs/log/`, committed). `session-handoff`'s
   old prune-after-two-sessions rule was also removed — it deleted history.
2. **Two decision logs** — resolved in favour of `docs/DECISIONS.md`. One
   append-only file stays greppable in a single read, keeps the monotonic IDs
   `taste.md` cites, and holds every status transition in one place; a directory
   of ADR files does none of that. ADR's real advantage was *depth*, so
   `Alternatives:` and `Consequences:` were added to the entry template, required
   when `Load-bearing: yes`. `CONTEXT.md` keeps vocabulary only; `docs/adr/` is
   not used.
3. **Unpublished members** — `phase-tracker`, `session-handoff`, and
   `comeback-recovery` lived on one machine only. Now in this repo.

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
