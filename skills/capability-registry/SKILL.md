---
name: capability-registry
description: "Build and maintain docs/capabilities.md — a living record of what the product can do, which code implements each capability, and how well each one is actually verified. Use when asked 'which features are fully supported', 'where are the gaps', 'what's covered by tools', 'what do we need to deploy so I can test it', or when a project has no enumerated list of its own capabilities. Two modes: bootstrap (first run) and sync (refresh after code changes). Verifies support rather than trusting declarations."
argument-hint: "[bootstrap | sync] (defaults: bootstrap if no docs/capabilities.md exists, else sync)"
---

# Capability Registry

The failure this skill defends against: a coverage table that lists
*declarations* as though they were *verifications*. A handler exists, so the
capability is marked supported — but nothing checked that it is registered with
the router, that it handles its own edge cases, or that anyone has ever run it
end to end. The table then reads authoritative, gets trusted, and is wrong in
exactly the places that matter.

Every other record in this project tracks **process** — where we are, why we
chose, what happened when. This one tracks **domain**: what the product can
actually do. It is the only artifact that answers "which features work."

Read this whole file before acting. Pick the mode from the argument, or infer
it: no `docs/capabilities.md` → **bootstrap**; one exists → **sync**.

## Standing rules

- **Never invent the capability set.** If no authoritative list exists, propose
  candidates and mark them unconfirmed — do not silently manufacture a list and
  then grade coverage against your own invention. That is circular, and it reads
  as authority.
- **Use the project's own noun.** If the repo says intents, commands, tools,
  endpoints, or features, use that word throughout. Do not impose "capability"
  on a codebase with its own vocabulary.
- **Derive from code wherever possible.** A hand-maintained inventory of dozens
  of rows rots faster than the map, and a rotted registry is worse than none
  because its size reads as authority. If an enum, router table, manifest, or
  registry exists, that is the source; humans annotate only support level and
  gap notes.
- **Default the support level down, never up.** Absent evidence, the lower level
  is correct. Assigning `live` without having driven the capability is the
  central failure this skill exists to prevent.
- **Gaps are the deliverable.** A registry of all-green rows is either a finished
  product or a lying table. Assume the second and go look.

## Support levels

Each capability carries exactly one, aligned to the evidence tiers in
`docs/STATE.md`:

| Level | Means | Equivalent tier |
| --- | --- | --- |
| `absent` | nothing implements it | — |
| `partial` | implemented but incomplete — **requires a gap note** | inferred |
| `wired` | complete and reachable (registered, routed, exposed), untested here | documented |
| `live` | driven end to end and observed working | verified-live |

`wired` → `live` is the expensive step and the one people skip. The distinction
between "the code exists" and "the code is reachable" is `partial` → `wired`, and
it is where most real gaps hide: a handler nobody registered is invisible to
every caller and looks complete in a grep.

---

## Mode: bootstrap

### 1. Find the authoritative set

Determine where the list of capabilities actually lives. Three cases, and which
one holds decides everything downstream:

- **Code-derivable** — an enum, router table, command registry, tool manifest,
  OpenAPI spec, or similar single place that enumerates them. Best case: derive
  the rows mechanically, and cells can legitimately reach `live`.
- **Spec-derivable** — enumerated in a PRD, spec, or design doc but not in code.
  Derive from there, and note that the doc is the source. A capability in the
  spec with no code is an `absent` row, which is a real finding.
- **Nowhere** — the set exists only implicitly, in prompt text or in someone's
  head. **Stop and say so.** Propose candidates from what you can find, mark
  every row unconfirmed, and tell the user that confirming the list is a product
  decision, not a documentation one. Deciding what the product does is
  `north-star` work; this skill records it, it does not invent it.

Completion: the case is named, and if code- or spec-derivable, the exact file
that is the source of truth is cited.

### 2. Map each capability to its implementation

For each row, find the code that implements it — and check reachability, not
just existence. A function that no router, dispatcher, or registry points at is
`partial`, not `wired`, however complete it looks.

Where per-capability work is independent, fan out: one agent per capability,
each returning implementing path, reachability, and proposed level with its
evidence. Independent verification is what keeps this from being a grep with
opinions.

Completion: every row has an implementing path or is marked `absent`.

### 3. Assign support levels — adversarially

For every row proposed as `wired` or `live`, try to disprove it. Those are the
claims that lie; `absent` and `partial` rarely need defending.

- Proposed `wired`: is it genuinely registered and reachable from a real entry
  point, or only defined?
- Proposed `live`: who drove it, when, and what did they observe? A test passing
  is not the same as the capability working; note which one you have.

Downgrade anything that cannot survive the check. Record what the evidence was,
not just the level.

Completion: every `wired`/`live` row cites its evidence; unsupported claims are
downgraded.

### 4. Write `docs/capabilities.md`

```md
# Capabilities

> What the product can do and how well each is verified. Derived from
> `src/intents/registry.ts` — re-run `capability-registry sync` after changing it.
> Support: absent · partial (gap note required) · wired (reachable, untested) · live (driven, observed)

| Capability | Implemented by | Support | Evidence | Gap |
| --- | --- | --- | --- | --- |
| transfer | `src/tools/transfer.ts` | live | drove on staging 2026-07-24 | — |
| swap | `src/tools/swap.ts` | wired | registered, never run | untested |
| bridge | `src/tools/bridge.ts` | partial | no multi-hop path | multi-hop unimplemented |
| stake | — | absent | — | no implementation |
```

Then add **one** row to `docs/STATE.md`'s topic index pointing here, so the map
keeps its page cap while a fresh agent still learns the registry exists. Do not
copy capability rows into `STATE.md`.

Completion: `docs/capabilities.md` exists, every row has a level and evidence,
every `partial` has a gap note, and `STATE.md` has exactly one pointer row.

### 5. Partition the gaps

The registry's payoff. Split every non-`live` row into two lists, because they
answer different questions:

- **Blocks testability** — the user cannot exercise the product at all until
  this is done. Deployment, config, wiring, auth, a missing entry point.
- **Blocks completeness** — the capability is missing or partial, but the rest of
  the product is testable without it.

Conflating these is how "get it deployed so I can test" silently becomes "finish
everything." Order the testability list by dependency and state the shortest
path to a running, exercisable product.

Completion: two ordered lists, and a named shortest path to something the user
can actually try.

---

## Mode: sync

Refresh against what changed. Cheap enough to run whenever code moves.

1. **Re-derive the set.** If the source is code, re-read it: capabilities added
   or removed since last run are new or deleted rows. A row whose source entry
   vanished is deleted, not silently kept.
2. **Downgrade what moved.** Any `live` row whose implementing code changed since
   the registry was last written drops to `wired` until re-driven — a
   verification is a claim about evidence, and evidence expires when its subject
   moves. Same rule `project-state` applies to `verified-live`.
3. **Re-check reachability** for rows whose router, registry, or manifest changed.
4. **Re-partition the gaps** and restate the shortest path to testable.
5. **Same commit as the work**, like the map.

Completion: rows match the source, stale `live` rows are downgraded, gaps
re-partitioned, staged with the work.

---

## Definition of done

1. **The set is sourced, not invented** — either derived from a cited file, or
   explicitly marked unconfirmed pending a human decision.
2. **Every `wired`/`live` row cites evidence** — who checked reachability, who
   drove it and observed what.
3. **Every `partial` row has a gap note** — "partial" with no gap is not a finding.
4. **`STATE.md` has exactly one pointer row** — detail stays here, the map stays a map.
5. **Gaps are partitioned** — testability-blocking separated from
   completeness-blocking, with a shortest path to something runnable.

## Failure modes

- **Declaration as verification** — marking a capability supported because a
  handler exists. Fix: check reachability, then check someone drove it.
- **Invented set** — manufacturing the capability list, then grading coverage
  against it. Fix: name case three and stop; the list is a product decision.
- **Hand-maintained rot** — a registry typed out once and never re-derived. Fix:
  derive from code; sync when code moves.
- **All green** — every row `live` on first run. Fix: you trusted declarations;
  go back to step 3 and try to disprove each one.
- **Map bloat** — capability rows copied into `STATE.md`. Fix: one pointer row.
- **Gap soup** — one undifferentiated list of missing things, so "what do I need
  to test this" is unanswerable. Fix: partition by what blocks testability.
- **Vocabulary imposition** — calling them capabilities in a repo that says
  intents. Fix: use the repo's noun.
