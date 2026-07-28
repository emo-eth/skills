# Lifecycle management

Which skills maintain the project's living record, what file each owns, and when
each fires. This is the navigation doc for that subset — not an index of every
installed skill.

## The test for what belongs here

**A lifecycle skill either owns a file that outlives the session, or exists only
to read the ones that do.**

That is the whole discriminator. `code-review` finds bugs and owns nothing — its
output dies with the conversation. `project-state` owns `docs/STATE.md`, which is
still there next week.

Applied to ~107 installed skills, this leaves **nine**: seven that own a file,
plus two readers that own nothing. Everything else is build / verify / review
tooling — useful, invoked ad hoc, irrelevant to the question "how does this
project remember things."

The two readers answer different questions, and conflating them is easy:
`comeback-recovery` resumes **the task you were on**; `project-status` briefs on
**the project** — what shipped, what's left, what's blocked on you.

## Three kinds of record

Treating these as one undifferentiated pile is what makes the set feel
incoherent. They have different mutability rules, and that is the point.

**1. The artifact chain** — how an idea becomes shipped code. Each stage is a
contract for the next; written once, amended deliberately, never edited casually.

```
vibe.md → PRD → spec → plan → implementation
```

**2. The record chain** — how what happened survives context death. Append-only
or continuously re-verified; never "finished."

```
decisions → state map → briefing
```

**3. The domain record** — what the product can actually do, and how well each
part of it is verified. Neither a contract nor a history: a current-state
inventory that goes stale the moment code moves.

```
capabilities
```

Most confusion about "which doc do I put this in" resolves by asking which of the
three it is. A frozen contract cannot hold a growing inventory; a 1–2 page map
cannot hold dozens of feature rows; a history cannot answer "does this work now."

## The nine

| Skill | Owns | Fires when | Invoked by |
| --- | --- | --- | --- |
| `north-star` | `docs/prds/<date>-<topic>/vibe.md`, `prd.md` | starting something new; amending the contract | you |
| `review-capture` | `docs/DECISIONS.md`, `docs/taste.md` | every human review round, always | auto — never you |
| `project-state` | `docs/STATE.md` (the map) | bootstrap once per repo, then sync every session | you, or session end |
| `project-status` | nothing — read-only | you want a project briefing | you |
| `capability-registry` | `docs/capabilities.md` | after features exist; re-sync when code moves | you |
| `ticketize` | tracker items (Notion / Linear / Issues) | a settled plan must become assigned work | you |
| `phase-tracker` | `.context/progress.md` (gitignored) | inside one task of 3+ sequential phases | auto, mid-task |
| `session-handoff` | `docs/log/YYYY-MM-DD-handoff.md` | ending a session with unfinished work | you, or session end |
| `comeback-recovery` | nothing — read-only | resuming an in-flight task after a gap | you |

Read the trigger column. **Two of the nine are never yours to type:**
`review-capture` runs itself after every review round, and `phase-tracker` fires
*inside* a task rather than at its start. If you have been trying to remember
when to invoke those, that is why it felt wrong — they are not commands.

## When to run what

- **Starting fresh work** → `north-star`, then `ticketize` once the plan settles.
- **First session in a repo with no `docs/STATE.md`** → `project-state bootstrap`, once.
- **"Where do things stand?"** → `project-status`. Read-only, safe any time.
- **"Which features actually work? what are the gaps?"** → `capability-registry`.
- **"What do I need to deploy so I can test it?"** → `capability-registry`; its gap
  partition separates what blocks testability from what blocks completeness.
- **End of any session that changed understanding or code** → `project-state sync`,
  in the same commit as the work. **This is the one habit everything else depends
  on.** Skip it and the map becomes a lie within a week — and a stale map is worse
  than no map, because it still gets trusted.
- **Ending mid-task** → `session-handoff`. **Resuming one** → `comeback-recovery`.
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
`docs/capabilities.md`, `docs/log/`, `.context/progress.md` are all plain
markdown, and `project-state`'s definition of done forbids tool-specific
machinery. Codex, Cursor, and opencode read them natively.

Six skills are pure file I/O and work anywhere: `project-status`, `north-star`,
`ticketize`, `phase-tracker`, `session-handoff`, `comeback-recovery`. Three
degrade rather than break:

- `project-state` — its step-5 fresh-chat test spawns `fresh-eyes`, which needs
  subagents. Without them, open a literal fresh session in another tool and ask it
  the question. That is a *stronger* test than the subagent version, since it also
  proves a non-Claude tool can orient from the map.
- `capability-registry` — fans out one agent per capability to verify support
  independently. Without subagents, verify sequentially: slower, same result.
- `review-capture` — one subagent hop for applying feedback; do it inline instead.

**Wire `AGENTS.md`, not only `CLAUDE.md`.** The `@`-import direction decides
whether other tools see the convention at all: `CLAUDE.md` importing `AGENTS.md`
works everywhere, the reverse hides the map from every non-Claude tool. When
`project-state` bootstraps a repo, the three directives go in `AGENTS.md`.

## The domain record, in detail

`docs/capabilities.md` is one row per capability → implementing code → support
level → evidence → gap. Two properties keep it from being a table that lies:

- **Support is verified, not declared.** `absent` / `partial` (gap note required)
  / `wired` (reachable, untested) / `live` (driven and observed), on the same
  evidence tiers `STATE.md` uses, downgraded when code moves. The `partial` →
  `wired` line — code exists vs. code is actually reachable — is where most real
  gaps hide, because a handler nobody registered looks complete in a grep.
- **Gaps are partitioned** into blocks-testability vs blocks-completeness. That
  split is what makes "what do we need to deploy so I can test it" answerable
  without expanding into "finish everything."

It uses the repo's own noun — intents, commands, tools, endpoints, features —
rather than imposing "capability" on a codebase with its own vocabulary. And it
refuses to invent the set: where capabilities exist only implicitly, it proposes
unconfirmed candidates and says that confirming them is product work.

## Resolved conflicts

Kept as a record of why the layout is what it is.

1. **Root-vs-`docs/log/`** — `phase-tracker` and `session-handoff` both wrote to
   repo root, violating `project-state`'s invariant. Resolved by the split above:
   the progress checklist is runtime state (`.context/`, gitignored, because a
   checklist shipping in commits causes cross-machine churn); the handoff is
   durable dated history (`docs/log/`, committed). `session-handoff`'s old
   prune-after-two-sessions rule was also removed — it deleted history.
2. **Two decision logs** — resolved in favour of `docs/DECISIONS.md`. One
   append-only file stays greppable in a single read, keeps the monotonic IDs
   `taste.md` cites, and holds every status transition in one place; a directory
   of ADR files does none of that. ADR's real advantage was *depth*, so
   `Alternatives:` and `Consequences:` were added to the entry template, required
   when `Load-bearing: yes`. `CONTEXT.md` keeps vocabulary only; `docs/adr/` is
   not used.
3. **Unpublished members** — `phase-tracker`, `session-handoff`, and
   `comeback-recovery` lived on one machine only. Now in this repo.
