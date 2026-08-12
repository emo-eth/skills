# Lifecycle management

Which skills maintain the project's living record, what file each owns, and when
each fires. This is the navigation doc for that subset — not an index of every
installed skill.

## The test for what belongs here

**A lifecycle skill maintains the project's record: it owns one of the record
files, or it is a read mode over them.**

That is the whole discriminator, and it is narrower than "owns a file that
outlives the session." `code-review` finds bugs and owns nothing — its output
dies with the conversation, so it is out. The record is the thing a fresh
agent must orient from cold: it captures what is true, decided, and shipped.

Applied to ~107 installed skills, the record test leaves **five**. Everything
else is build / verify / review tooling — useful, invoked ad hoc, irrelevant to
the question "how does this project remember things."

The five are `lc-`prefixed so the lifecycle set is unambiguous at a glance and
sorts together in any skill list.

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

**3. The readiness record** — every behavior the product is meant to have, how
far along each one is, and how well the built ones are verified. Neither a
contract nor a history: a per-behavior inventory on one ladder from `deferred`
to `live`, whose top rungs go stale the moment code moves.

```
readiness
```

Most confusion about "which doc do I put this in" resolves by asking which of the
three it is. A frozen contract cannot hold a growing inventory; a 1–2 page map
cannot hold a row per feature; a history cannot answer "does this work now" or
"how far along is it."

The map (`docs/STATE.md`) and the readiness record (`docs/readiness.md`) are both
owned by `lc-project-state` — one skill, because there is no moment you sync the
map without wanting the readiness record re-checked too. It keeps them separate
files and re-checks them at different costs (see its four modes below).

## The five

| Skill | Owns | Fires when | Invoked by |
| --- | --- | --- | --- |
| `lc-north-star` | `docs/prds/<date>-<topic>/vibe.md`, `prd.md` | starting something new; amending the contract | you |
| `lc-review-capture` | `docs/DECISIONS.md`, `docs/taste.md` | every human review round, always | auto — never you |
| `lc-project-state` | `docs/STATE.md` (the map) + `docs/readiness.md` (the readiness record) | bootstrap once per repo; sync every session; status / audit on demand | you, or session end |
| `lc-ticketize` | tracker items (Notion / Linear / Issues) | a settled plan must become assigned work | you |
| `lc-phase-tracker` | `.context/progress.md` (gitignored) | inside one task of 3+ sequential phases | auto, mid-task |

`docs/DECISIONS.md` is one append-only decision log, not a directory of ADR
files — see *Resolved conflicts* §2 for why, and for how ADR's depth was folded
back in.

Read the trigger column. **Two of the five are never yours to type:**
`lc-review-capture` runs itself after every review round, and `lc-phase-tracker`
fires *inside* a task rather than at its start. If you have been trying to
remember when to invoke those, that is why it felt wrong — they are not commands.

### `lc-project-state`'s four modes

The merge put the map, the readiness record, and the read-back under one skill.
Invoked bare (`/lc-project-state`, no args) it infers the mode: bootstrap if
there is no `docs/STATE.md`, else sync.

| Mode | Does | Writes? |
| --- | --- | --- |
| `bootstrap` | first run: turn the doc pile into a map + clean structure | yes |
| `sync` | cheap end-of-session upkeep: reconcile the map, downgrade stale tiers, and do a **cheap** readiness pass — downgrade verified rows whose code moved, cheaply move bottom-rung stages where plans changed, and flag that an audit is due | yes |
| `status` | read-only briefing: what shipped / what's left / what's blocked on you / what's awaiting review / what's most pressing | **no** |
| `audit` | full verification of the readiness record's top rungs: (re)build `docs/readiness.md` with per-behavior reachability + drove-it checks, partition the gaps | yes |

The `status`/`audit` split is the whole reason the merge is safe: read-only is a
**mode guarantee** now, not a separate skill you might forget exists, and the
expensive verification (`audit`) is decoupled from the cheap habit (`sync`) so
the habit stays cheap enough to actually run.

## When to run what

- **Starting fresh work** → `lc-north-star`, then `lc-ticketize` once the plan settles.
- **First session in a repo with no `docs/STATE.md`** → `/lc-project-state` (it infers `bootstrap`), once.
- **"Where do things stand?" / "what's blocked on me?"** → `/lc-project-state status`. Read-only, safe any time, writes nothing by mode guarantee.
- **"How far along is X? which features actually work? where are the gaps?"** → `/lc-project-state audit`. "How far along" and "does it actually work" are the *same lookup* — one behavior, one position on one ladder. Its gap partition (blocks-testability vs blocks-completeness) also answers "what do I need to deploy so I can test it," and is worth running standalone — outside any ticket or milestone workflow.
- **End of any session that changed understanding or code** → `/lc-project-state` (it infers `sync`), in the same commit as the work. **This is the one habit everything else depends on.** Skip it and the map becomes a lie within a week — and a stale map is worse than no map, because it still gets trusted. Sync now also keeps the readiness record honest: it downgrades the verified rungs where code moved, cheaply moves bottom-rung stages where plans changed this session, and flags when a full `audit` is due, without doing the expensive verification inline.
- **A review round came back** → nothing. `lc-review-capture` handles it.

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

## The readiness record, in detail

`docs/readiness.md` is one row per behavior → stage on a single ladder →
implementing code (once any exists) → evidence → gap. One axis answers two
questions that used to feel separate: "how far along is X" and "does X actually
work" are the same lookup, because both are just the row's position on the
ladder. Three properties keep it from being a table that lies:

- **One ladder, split into declarations and verified claims.**
  `deferred → planned → in-progress → partial → wired → live`. The **bottom
  rungs** (`deferred`, `planned`, `in-progress`) are *declarations*: a row there
  claims nothing about reality and needs no evidence. The **top rungs**
  (`partial` — gap note required — `wired` (reachable, untested), `live` (driven
  and observed)) are *verified*, on the same evidence tiers `STATE.md` uses,
  defaulted down when evidence is absent and downgraded when the code moves. The
  trust boundary sits between `in-progress` and `partial`: nothing crosses it
  without evidence. The `partial` → `wired` line — code exists vs. code is
  actually reachable — is where most real gaps hide, because a handler nobody
  registered looks complete in a grep.
- **Gaps are partitioned** into blocks-testability vs blocks-completeness, at the
  verified end of the ladder. That split is what makes "what do we need to deploy
  so I can test it" answerable without expanding into "finish everything."
- **Tracks planned and in-flight work, not just current state.** The record
  spans the whole ladder deliberately. `lc-ticketize` fires *once*, when a
  settled plan becomes assigned work, and nothing ever syncs status back from the
  tracker; `STATE.md`'s milestone section is capped at 1–2 pages and cannot hold
  a row per feature. So per-behavior work status — planned, in-flight,
  done-and-verified — lived *nowhere* in the lifecycle before. It lives here now.
  This does **not** reintroduce the declaration-graded-as-verification failure:
  the original failure was never "planned rows exist," it was "declared things
  graded as verified," and the declaration/verification split in the ladder makes
  that structural — a `planned` row can never masquerade as a `live` one.

It uses the repo's own noun — intents, commands, tools, endpoints, features — for
its rows rather than imposing "readiness" (or "capability") as the noun;
readiness is the *axis*, not the thing. And it refuses to invent the set: where
the behaviors exist only implicitly, it proposes unconfirmed candidates and says
that confirming them is product work.

**Open, not designed yet:** how the map and the readiness record scope to a
*worktree* — "which tickets and behaviors does this worktree own" — is an
unanswered question, not a decided one. Do not assume the current single-tree
model extends cleanly to parallel worktrees.

## Cross-tool portability

The artifacts are fully portable by design — `STATE.md`, `DECISIONS.md`,
`docs/readiness.md`, `docs/log/`, `.context/progress.md` are all plain
markdown, and `lc-project-state`'s definition of done forbids tool-specific
machinery. Codex, Cursor, and opencode read them natively.

`lc-north-star`, `lc-ticketize`, and `lc-phase-tracker` are pure file I/O and
work anywhere. Two skills degrade rather than break:

- `lc-project-state` — `status` and `sync` are pure file I/O and portable as-is.
  Two pieces need subagents and degrade gracefully without them: `bootstrap`'s
  step-5 fresh-chat test spawns `fresh-eyes` (without it, open a literal fresh
  session in another tool and ask the question — a *stronger* test, since it
  also proves a non-Claude tool can orient from the map), and `audit` fans out
  one agent per behavior to verify the top rungs independently (without subagents,
  verify sequentially: slower, same result).
- `lc-review-capture` — one subagent hop for applying feedback; do it inline instead.

**Wire `AGENTS.md`, not only `CLAUDE.md`.** The `@`-import direction decides
whether other tools see the convention at all: `CLAUDE.md` importing `AGENTS.md`
works everywhere, the reverse hides the map from every non-Claude tool. When
`lc-project-state` bootstraps a repo, the three directives go in `AGENTS.md`.

## Resolved conflicts

Kept as a record of why the layout is what it is.

1. **Two decision logs** — resolved in favour of `docs/DECISIONS.md`. One
   append-only file stays greppable in a single read, keeps the monotonic IDs
   `taste.md` cites, and holds every status transition in one place; a directory
   of ADR files does none of that. ADR's real advantage was *depth*, so
   `Alternatives:` and `Consequences:` were added to the entry template, required
   when `Load-bearing: yes`. `CONTEXT.md` keeps vocabulary only; `docs/adr/` is
   not used.
2. **Nine collapsed to five: merges and a prefix** — the set was nine skills
   and read as sprawl. Three moves fixed it:
   - `project-status` **merged into** `lc-project-state` as its read-only
     `status` mode. Making read-only a *mode guarantee* of one skill beats a
     separate skill you have to remember exists, and it puts the briefing next to
     the map it reads.
   - `capability-registry` **folded into** `lc-project-state`, split by cost: the
     domain record is something you want re-checked on every sync, but the full
     per-capability verification is too expensive to run every session. So `sync`
     does a cheap downgrade-and-flag pass and the new `audit` mode does the real
     verification. Folding it in makes the one lifecycle habit cover the domain
     record instead of relying on a second habit nobody kept.
   - The five survivors took an **`lc-` prefix** so the lifecycle set groups
     unambiguously and sorts together.
3. **`capabilities` → `readiness`, and scope widened to planned work** — the
   domain record (formerly `docs/capabilities.md`, produced by the
   `capability-registry` skill folded in at item 4) was renamed to
   **`docs/readiness.md`** and its scope widened from current-state-only to the
   whole `deferred → planned →
   in-progress → partial → wired → live` ladder. The old design kept the record
   current-state-only and pushed planned/in-progress work to tickets and
   `STATE.md`'s milestone section. That left a real hole: `lc-ticketize` fires
   once and nothing syncs status back from the tracker, and the milestone section
   is capped at 1–2 pages and cannot hold a row per feature — so per-behavior work
   status lived *nowhere*. Widening the record fills the hole. It does not
   reintroduce the failure the old boundary guarded against, because that failure
   was "declarations graded as verified," not "planned rows exist": the ladder's
   split between declaration rungs (bottom, no evidence) and verified rungs (top,
   evidence required, defaulted down) makes the guarantee structural. The rename
   also made "how far along is X" and "does X actually work" one lookup instead of
   two. The historical name `capabilities`/`capability-registry` is kept in the
   entries above where they describe how the skill got here; the current name is
   `readiness`.
