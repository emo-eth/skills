# Persistence formats

Reference for `review-capture`. Load when writing entries, not on every round.

## `docs/DECISIONS.md` — the log

One file per project repo. Append-only. Entries are never deleted;
superseded entries keep their text and get a new status line.

### Entry template

```md
## D14 — 2026-07-28 — Bundle copies must keep original filenames
Decision: review bundles copy docs with original names, never 01-a.md renames.
Why: "renaming silently kills the diff view and I wasted a round" — annotation on docs/spec.md, round 3.
Source: plannotator round on docs/spec.md, 2026-07-28
Status: active
Scope: v0
Load-bearing: yes
```

### Fields

- **ID** — `D<n>`, monotonic, never reused. Gaps are fine. Next ID: read
  the log's highest existing `D<n>` and increment. (Round numbers for
  snapshots work the same way: count the target's existing
  `.context/review/` snapshots and increment.)
- **Decision** — one or two sentences, stated as a rule future work can
  follow or violate.
- **Why** — the rationale, anchored by a verbatim quote of the annotation
  (or the human's chat message) that forced it.
- **Source** — which round / doc / date produced it.
- **Status** — one of:
  - `active` — in force.
  - `superseded-by D<n>` — replaced. Edit only this line on the old entry;
    append the successor as a new entry.
  - `deferred` — real question, not blocking current work. Requires
    **Revisit:** line naming the event that should reopen it.
- **Scope** — `v0`, `v1+`, etc. Planning-time rule: before proposing v1
  work, read deferred and v1+ entries; before v0 work, ignore them.
- **Load-bearing** — `yes` when the decision is expensive to reverse,
  surprising, or affects more than one local doc or module. This tag
  replaces a separate ADR file ceremony; the log is the ADR.

### Deferred entry addition

```md
Status: deferred
Revisit: when v1 scoping starts, or if a second user asks about export
```

## `docs/taste.md` — distilled principles

Hard cap ~1 page. Each principle is one line plus citations:

```md
## Tooling decisions
- Never rename artifacts that tools key on (filenames, IDs, slugs). [D14, D21]
- Prefer demote-over-delete for anything a human wrote. [D3, D9, D17]
```

Rules:

- Every principle cites the decision IDs that established it. No citation,
  no principle — that is the defense against the agent writing fan fiction
  about the human.
- Add or sharpen a principle when a round reveals a *pattern* (second
  occurrence of a preference), not a one-off.
- Agent-maintained, human-audited: the human reviews taste.md occasionally
  (an annotation round like any other), not per-edit.
- An agent about to act autonomously reads taste.md first, then greps
  DECISIONS.md for the area it is about to touch — first-occurrence rules
  live only in the log, and the log is small and greppable. It never
  re-reads the log cover to cover.

## `.context/` — crash recovery snapshots

- Path: `.context/review/YYYY-MM-DD-<target>-round-N.md`, raw feedback
  verbatim.
- Machine-managed: agents write it, nobody reads it unless a session died
  mid-round.
- The project repo's `.gitignore` must contain `.context/`. If it doesn't,
  add it in the same commit that first writes a snapshot.

## Answers doc

Default location when the project has no convention:
`docs/review/YYYY-MM-DD-<doc>-answers.md`. Preserves the human's item
numbering; each item gets: what was done, where it landed (file +
section), or a stated reason for disagreement. Ends with a collected list
of anything still needing human input.

## Closure summary format

The only human-facing output of the pass. Five lines or fewer:

```md
Round applied: 6 of 7 items (item 4 declined — reason in answers doc).
Recorded: D22 (filename rule), D23 (evidence tiers over prose hedges).
Deferred: export format → D24, revisit at v1 scoping.
taste.md: added "rename nothing tools key on" [D22].
Needs you: item 7 (scope question on public API).
```
