---
name: lc-project-state
description: "Bootstrap and maintain a project's living record so a fresh clean-context agent (Claude, Codex, Cursor — any tool) orients from the repo alone, and read that record back on demand. Owns docs/STATE.md (the map) and docs/capabilities.md (what the product can actually do, verified not declared). Use when context keeps dying across sessions or compactions; when someone asks 'what's current here?', 'what did we just ship', 'what's left for v0', 'what's blocked on me', 'what should I review', 'which features actually work', 'where are the gaps', or 'what do we need to deploy so I can test it'; when setting up docs/STATE.md; or for an end-of-session doc sync. Four modes: bootstrap (first run in a repo), sync (cheap end-of-session upkeep), status (read-only briefing, writes nothing), audit (full capability verification). Invoked bare, it infers the mode."
argument-hint: "[bootstrap | sync | status | audit] (defaults: bootstrap if no docs/STATE.md, else sync)"
---

# Project State

The failure this skill defends against: a repo where currency is unknowable — a dozen docs at the root, none dated, one of them a finished synthesis nobody indexed, and a fresh agent that has to be spoon-fed context or interrogates the user because it cannot tell what is true *now* from what was true three sessions ago.

The fix is one small, tool-agnostic convention: plain markdown plus `AGENTS.md` wiring. A single `docs/STATE.md` is **the map** — an index that points at where truth lives and how well each claim is verified. The map is never the truth itself.

This skill maintains two records and reads them back:

- **`docs/STATE.md`** — the map. Where truth lives, and how well each claim is verified.
- **`docs/capabilities.md`** — the domain record. What the product can actually do, which code implements each capability, and how well each one is verified end to end.

The two travel together on purpose. There is essentially no moment you would sync project state without also wanting the capability record re-checked — a session that moved code moved what the product can do. But the full capability audit (independent verification per capability) is expensive, and the end-of-session habit has to stay cheap or it gets skipped. So the split is by cost, not by concept: **`sync` does a cheap capability pass** (downgrade rows whose code moved, flag that an audit is due) and **`audit` does the expensive verification**.

Read this whole file before acting. Pick the mode from the argument, or infer it: no `docs/STATE.md` yet → **bootstrap**; one exists → **sync**. `status` and `audit` are always explicit (or triggered by the phrases above).

## Standing rules (all modes)

These override any impulse to the contrary. Violating one defeats the purpose of the convention.

- **The map points at truth, never is the truth.** STATE.md is an index. Agents — including you — still open and read the source doc or the code before editing anything. A row in the map is a pointer plus a verification tier, not a substitute for the source.
- **Never delete an old doc. Demote it.** Superseded thinking moves to `docs/log/` and gets a status header pointing at its successor. History is evidence of how decisions were reached; destroying it destroys that.
- **No doc-generation sprawl.** This skill maintains a small map, a capability record, and reorganizes what already exists. It does not spawn new explainer docs, summaries, or per-topic write-ups. If you feel the urge to write a new doc, you are almost certainly off-task.
- **Re-derive, don't inherit.** When you find an existing verdict, shortlist, or "current status" in the pile, check it against the underlying docs and code before transcribing it into the map. Inherited verdicts are unvetted claims wearing a confident tone.
- **Adapt to what exists.** If the repo already has a docs convention (a `docs/` layout, an ADR directory, a status doc under another name), extend it rather than imposing this exact structure. The goal is the properties in "Definition of done," not this literal file tree.
- **The map stays re-readable.** STATE.md has a hard cap of ~1–2 pages — small enough to fully re-read and re-verify every session. A map that outgrows one sitting rots, because nobody checks it. Push detail down into the source docs; keep the map a map. The capability record lives in `docs/capabilities.md`, not the map — STATE.md carries exactly one pointer row to it.

## Evidence tiers

Every factual claim in the map — every topic row — carries a visible tier tag, not a prose hedge (hedges get compressed away when the map is skimmed and relayed):

- **verified-live** — someone ran it first-hand and observed the result this project.
- **documented** — an authoritative source states it, but it is untested here.
- **inferred** — extrapolation, single-sourced, third-party, or assumed.

If code changes under a row that was `verified-live`, the verification is stale: downgrade the tier until someone re-verifies. A tier is a claim about *evidence*, and evidence expires when its subject moves. The capability support ladder in "Mode: audit" is the same idea applied to `docs/capabilities.md`.

---

## Mode: bootstrap

First run in a repo. Turn the pile into a map plus a clean structure.

### 1. Inventory — read structure, not filenames

Enumerate every doc in the repo (root, `docs/`, anywhere). Open each and read its headers and structure, not just its name. A file called `notes.md` may be the authoritative architecture doc; `execution-synthesis.md` may be a finished summary nobody ever indexed.

Look specifically for a **hidden synthesis** — a finished summary or decision doc that was produced and then buried. Surface each by name and path. Finding one does not make it trustworthy: hold it to "re-derive, don't inherit" before you treat its conclusions as current.

Classify each doc into exactly one bucket:

- **current-authoritative** — the live thinking on a topic; still the thing to act on.
- **superseded-historical** — was authoritative, now replaced by newer thinking.
- **dated-session-artifact** — a findings / handoff / status / sync doc tied to a moment in time.
- **reference-research** — external research, vendor dossiers, background material.

Completion: a written classification list exists, one line per doc — path, bucket, one-line contents — and any hidden synthesis is named explicitly.

### 2. Restructure — with `git mv`, preserving history

Move files into a structure that makes currency legible from location alone:

- `docs/` — current authoritative thinking, one topic per doc.
- `docs/log/YYYY-MM-DD-<name>.md` — dated historical artifacts (session findings, handoffs, status, and superseded docs). Demoted, never deleted. Date from the doc's own content or its git history, not today.
- `docs/research/` — reference research and background.
- Repo root keeps only `README`, `AGENTS.md` / `CLAUDE.md`, and config. Nothing else.

Use `git mv` so history follows the file. After moving, fix every relative link that now points at a moved file — grep for the old paths and update them. A superseded doc gets a status header at its top: `> Superseded by docs/<successor>.md as of YYYY-MM-DD. Historical.`

If the repo already has a docs convention, map these roles onto it instead of forcing the exact tree.

Completion: repo root is down to README/AGENTS/CLAUDE + config; every moved file moved via `git mv`; no broken relative links (grep confirms); every superseded doc carries a status header.

### 3. Write `docs/STATE.md` — the map

Use `references/state-template.md` as the skeleton. Five sections, nothing more:

1. **What this is** — three sentences. What the project is, who it is for, what stage it is at.
2. **Where we are** — current phase, current priorities, what is proven versus what is open, and what is deferred (v1+ work parked with a revisit trigger, or a pointer to deferred entries in the decision log). This is also where planned and in-progress milestone work lives — the capability record is current-state only and must not hold planned rows (see "Mode: audit").
3. **Standing constraints** — the rules that must survive into any future work regardless of how old the doc they came from is (e.g. "never place session artifacts at repo root," "IBKR adapter is the only live-verified execution path"). These are the load-bearing invariants a fresh agent must not violate.
4. **Topic index** — a table, one row per topic: `topic | thinking/decision doc | code that implements it | verified-by`, and each row tagged with an evidence tier. Superseded docs appear as `historical, behind <successor>`. This is the heart of the map: it connects each area of the project to the doc that decides it, the code that implements it, and the evidence that it works. When the project has a decision log (`docs/DECISIONS.md`) or distilled taste (`docs/taste.md`) — the artifacts `lc-review-capture` maintains — they get standard rows here, so a fresh agent learns they exist from the map. If a `docs/capabilities.md` exists, it gets exactly one pointer row too.
5. **Maintenance rule** — the contract from "Mode: sync" below, stated in-doc so any agent that reads STATE.md learns how to keep it alive.

Keep it under the ~1–2 page cap. If it overflows, you are putting detail in the map that belongs in a source doc.

Completion: STATE.md exists with all five sections; every topic row carries an evidence tier; the file is within the page cap.

### 4. Wire `AGENTS.md`

Add to the top of `AGENTS.md` (create it if absent), so every agent and tool that respects it is steered before doing any work:

```md
## Project state

- Before any work, read `docs/STATE.md`. It is the index of what is current — the map, not the truth. Follow its pointers to the real source before editing.
- If your session changes the project's understanding or its code, update `docs/STATE.md` in the **same commit** as the work.
- Dated session artifacts (findings, handoffs, status) go in `docs/log/YYYY-MM-DD-<name>.md`, never the repo root.
```

If the repo uses `CLAUDE.md` that `@`-imports `AGENTS.md` (or vice versa), wire the canonical one and let the import carry it.

Completion: `AGENTS.md` carries the three directives at its top.

### 5. Verify — the fresh-chat test

Run `fresh-eyes` against the repo: a clean-context agent given **only** the repo (no briefing, no context from this session), asked a topical question about current state or a past decision — something answerable only by orienting through STATE.md into the right source doc (e.g. "which execution venue is live-verified and where is that proven?") — and required to answer from the files or declare a gap.

It passes if it orients from STATE.md and answers correctly **without asking you for context**. If it flounders — asks what the project is, or answers from a superseded doc — the map is at fault, not the agent. Fix the map (better pointers, clearer currency, a missing row) and re-run until a fresh agent passes cold.

Completion: a fresh clean-context agent, given only the repo, answered a real topical question correctly and without asking for context.

---

## Mode: sync

End of session, or invoked after meaningful work. Keep the map honest against what actually changed. This is the cheap habit everything else depends on, so it does **no** verification work — it flags what needs verifying and moves on.

### 1. Diff reality against the map

Compare what this session changed — `git diff`, plus what you know from the conversation — against what STATE.md currently claims. Where has code moved under a row? What topic has no row yet? Which doc did this session supersede? Which `verified-live` claim now sits on top of changed code?

### 2. Update the map

- Move or rewrite rows whose thinking or code changed.
- Add rows for genuinely new topics (do not invent topics for trivia).
- **Fold in review rounds**: if `lc-review-capture` ran this session, confirm `docs/DECISIONS.md` and `docs/taste.md` have topic-index rows, surface newly-deferred items (with their revisit triggers) under "Where we are — Deferred" and open questions needing the human under "Open", and mirror any new load-bearing invariants as one-liners under "Standing constraints" citing their D-IDs. The log holds the detail; the map only points.
- **Downgrade evidence tiers**: any `verified-live` row whose code changed this session drops until re-verified.
- Mark newly-superseded docs historical in **two** places: the topic index (`historical, behind <successor>`) and a status header at the top of the doc itself pointing to its successor.
- Keep it within the page cap. If the map grew, prune detail down into source docs rather than letting the map bloat.

### 3. Cheap capability pass

If `docs/capabilities.md` exists, do the cheap pass only — no verification, no fan-out:

- For every row whose implementing code moved this session, **downgrade the support level** one step toward `absent` (a moved `live` row drops to `wired`; the code it claimed to have driven is no longer the code that was driven) and note the downgrade.
- **Flag the registry as needing an audit** — add a dated line at the top of `docs/capabilities.md` (e.g. `> ⚠️ Audit due: code moved under N rows on YYYY-MM-DD; run lc-project-state audit.`) so the next reader knows the record is behind and a `status` briefing surfaces it.

That is the whole pass. Re-deriving the set, checking reachability, and re-driving anything is `audit` work — do not do it here, or the end-of-session habit stops being cheap and starts getting skipped.

If no `docs/capabilities.md` exists yet, skip this step; the record is created by `audit`.

### 4. Route new artifacts

Any findings / handoff / status doc this session produced goes to `docs/log/YYYY-MM-DD-<name>.md` — never the repo root. This is where session output belongs; the map only *points* at it.

### 5. Land it in the same commit

The map update ships in the same commit as the work that made it necessary. A map updated in a later commit — or not at all — is a map a future agent cannot trust, which is a map nobody reads.

Completion: STATE.md reflects the session's changes; stale `verified-live` tiers are downgraded; moved capability rows are downgraded and the registry flagged if an audit is due; newly-superseded docs are marked in both places; new artifacts are in `docs/log/`; all of it is staged in the same commit as the work.

---

## Mode: status

Read-only briefing. The failure this mode defends against: a confident briefing assembled from `git log` and vibes. Commits tell you what changed, never what it *meant*, what it unblocked, or what is now waiting on the human — so a status answer derived from them reads authoritative and is quietly fiction. The fix is to answer only from artifacts that record intent, tag every claim with how stale it is, and say "I don't know" where the artifacts are silent.

This mode answers five questions and nothing else:

1. What shipped since the last briefing
2. What's left for the milestone
3. What's blocked on the human
4. What's awaiting the human's review
5. What's most pressing, ranked, with the reason for the rank

### Standing rules (status mode)

These override any impulse to the contrary.

- **Read-only. Write nothing.** No file edits, no `git mv`, no commits, no "while I'm here" map fixes. If `docs/STATE.md` is wrong, *report* that and point at `lc-project-state sync` — do not fix it. A read mode that mutates is a mode nobody can run safely mid-session, which defeats the point of having it.
- **Never invent a queue.** If nothing is blocked on the human, the answer is "nothing needs you." Manufacturing plausible-sounding action items to fill the section is the worst possible failure here — it spends the user's attention on fiction.
- **Staleness is the headline, not a footnote.** If the map is behind the code, that fact outranks everything else in the briefing, because it determines whether the rest can be trusted at all. A `> ⚠️ Audit due` flag on `docs/capabilities.md` is the same headline for the domain record — surface it.
- **Tiers survive to the output.** An `inferred` row in the topic index is relayed as inferred. Never launder a weak claim into a confident status line by dropping its tag.
- **Distinguish blocked-on-human from blocked-on-work.** This is the whole value of the briefing. "Needs a decision from you" and "needs someone to write the code" are different queues; collapsing them makes both useless.
- **Cap it at one screen.** This is a briefing you re-read daily, not a report. Detail lives in the artifacts; the briefing points.

### 1. Establish what's readable

Find which inputs exist before planning around them. In a repo maintained by this skill and `lc-review-capture` you'll have most of these; in any other repo you'll have few, and the honest answer degrades with them.

| Input | What it supplies |
| --- | --- |
| `docs/STATE.md` | current phase, priorities, proven/open/deferred, topic index + tiers |
| `docs/capabilities.md` | what works vs. what's a gap, support levels, any audit-due flag |
| `docs/DECISIONS.md` | `Scope:` per decision, `Status: deferred` + `Revisit:`, `Load-bearing: yes` |
| `docs/taste.md` | standing principles, so a "pressing" item isn't proposed against known taste |
| `docs/log/YYYY-MM-DD-*.md` | dated session artifacts — the trail of what actually happened |
| `docs/review/*-answers.md` | each ends with a collected list of items still needing human input |
| `.context/review/` | snapshots of review rounds; a recent one with no answers doc means a round stalled |
| git | commit and merge history, working tree state |
| `gh` | open PRs, and which await this user's review |

Then locate the milestone. Use the argument if given; otherwise take the current phase/milestone from STATE.md's "Where we are." If neither names one, say so and answer without milestone scoping rather than guessing at "v0."

Completion: a written list of which inputs exist and which are absent, plus the milestone in force.

### 2. Run the staleness gate — before anything else

Establish whether the map still describes the code. This gates the entire briefing's trustworthiness.

```sh
git log -1 --format='%H %cI' -- docs/STATE.md         # when the map was last touched
git log --oneline <that-sha>..HEAD -- <paths from the topic index>
```

Take the code paths from STATE.md's topic index. Any row whose code changed after the map's last touch is a row whose claims — especially `verified-live` — are now unverified regardless of what the tier says.

Three outcomes, and they change how you present everything below:

- **Map current** — no code moved under any row since the map's last touch. Brief normally.
- **Map behind** — code moved under N rows. Lead with this, name the rows, mark every affected claim unverified, and recommend `lc-project-state sync`.
- **No map** — `docs/STATE.md` doesn't exist. Say plainly that the repo isn't bootstrapped, that what follows is inference from git and nothing more, and recommend `lc-project-state bootstrap`. Do not produce a confident briefing off commits alone; that is the exact failure this mode exists to prevent.

Completion: one of the three outcomes is determined, with the affected topic rows named if the map is behind.

### 3. Gather the five answers

Work from artifacts of intent first, git second. Git is corroboration for what a doc claims, not a substitute for it.

**Shipped.** Bound the window at the last briefing or the most recent `docs/log/` artifact, whichever is later; if neither exists, use the last milestone-ish marker (tag, release commit). Prefer merges and the log trail over raw commit counts — `git log --merges --oneline` plus the dated artifacts tells you what landed as *units of work*. Name what it unblocked when an artifact says so; don't infer causation from adjacency.

**Left for the milestone.** Union of: STATE.md "Open"; `DECISIONS.md` entries with `Scope: <milestone>` and `Status: active` that aren't yet implemented; and any tracker items if the repo uses one. Honor the planning-time rule from `lc-review-capture`: when the milestone is v0, **ignore** `v1+` and `deferred` entries — pulling them in is how a milestone silently doubles.

**Blocked on the human.** Only real signals, each cited:

- `Needs you:` lines in review-capture closure summaries
- the trailing "still needing human input" list in any answers doc
- `Status: deferred` entries whose `Revisit:` trigger has now fired — quote the trigger and state what fired it
- STATE.md "Open" items phrased as questions for the human
- a `.context/review/` snapshot with no corresponding answers doc — a round that went out and never came back

**Awaiting their review.** `gh pr status` for review-requested, plus open PRs with no review decision. Include age; a four-day-old request is a different item than a four-hour-old one.

**Most pressing.** Rank by this order, and state the reason inline so the ranking is auditable rather than asserted:

1. blocks another person or a running process
2. blocks the current milestone
3. a fired revisit trigger on a `Load-bearing: yes` decision
4. a stale `verified-live` claim on load-bearing code — nobody knows if it works
5. everything else, newest first

Completion: all five have an answer or an explicit "nothing here," every item carries a file/PR citation, and each ranked item carries its reason.

### 4. Brief

One screen. Staleness first when it applies, then the five sections, then the single recommended next action. Cite paths so every claim is checkable, and tag any claim resting on an `inferred` or stale row.

```md
⚠️ Map is behind: docs/STATE.md last touched 2026-07-19; code moved under
   `Order execution` and `Auth` since. Those rows' claims are unverified.
   → run `/lc-project-state sync`

**Shipped** (since docs/log/2026-07-19-findings.md)
- Backend route handler + tests — #412, docs/log/2026-07-22-handoff.md
- Token selector — #418

**Left for v0** (3)
- Empty-state copy — STATE.md "Open"
- Rate-limit policy — D19 (active, scope v0), unimplemented
- Mobile web breakpoints — STATE.md "Open"

**Blocked on you** (2)
- D24 deferred, revisit trigger FIRED: "when v1 scoping starts" — scoping
  started 2026-07-24. Needs your call.
- docs/review/2026-07-22-spec-answers.md item 7 — scope question on public API

**Awaiting your review** (1)
- #418 token selector — review requested 4 days ago

**Most pressing**
1. #418 — 4 days blocking another person
2. Rate-limit policy (D19) — blocks v0
3. D24 revisit — load-bearing, trigger already fired

Next: unblock #418, it's the only item with someone waiting on you.
```

If a section is empty, say so in one line. Do not pad.

Completion: briefing fits one screen, every claim cites its source, staleness led if present, exactly one next action proposed, and **nothing was written**.

---

## Mode: audit

Full verification of the domain record. The failure this mode defends against: a coverage table that lists *declarations* as though they were *verifications*. A handler exists, so the capability is marked supported — but nothing checked that it is registered with the router, that it handles its own edge cases, or that anyone has ever run it end to end. The table then reads authoritative, gets trusted, and is wrong in exactly the places that matter.

Every other record here tracks **process** — where we are, why we chose, what happened when. `docs/capabilities.md` tracks **domain**: what the product can actually do. It is the only artifact that answers "which features work." If no `docs/capabilities.md` exists, audit bootstraps it; if one exists, audit refreshes it with full verification (and clears any audit-due flag `sync` left).

The gap partition this mode produces is useful **standalone** — "what do we need to deploy so I can test it" and "where are the gaps" are worth answering outside any ticket or milestone workflow.

### Standing rules (audit mode)

- **Never invent the capability set.** If no authoritative list exists, propose candidates and mark them unconfirmed — do not silently manufacture a list and then grade coverage against your own invention. That is circular, and it reads as authority.
- **Use the project's own noun.** If the repo says intents, commands, tools, endpoints, or features, use that word throughout. Do not impose "capability" on a codebase with its own vocabulary.
- **Derive from code wherever possible.** A hand-maintained inventory of dozens of rows rots faster than the map, and a rotted registry is worse than none because its size reads as authority. If an enum, router table, manifest, or registry exists, that is the source; humans annotate only support level and gap notes.
- **Default the support level down, never up.** Absent evidence, the lower level is correct. Assigning `live` without having driven the capability is the central failure this mode exists to prevent.
- **Gaps are the deliverable.** A registry of all-green rows is either a finished product or a lying table. Assume the second and go look.
- **Current-state only.** `docs/capabilities.md` records what exists *now*. Planned and in-progress work lives in tickets (`lc-ticketize`) and STATE.md's milestone section — putting planned rows in the registry recreates the exact declaration-graded-as-verification failure this mode exists to prevent.

### Support levels

Each capability carries exactly one, aligned to the evidence tiers above:

| Level | Means | Equivalent tier |
| --- | --- | --- |
| `absent` | nothing implements it | — |
| `partial` | implemented but incomplete — **requires a gap note** | inferred |
| `wired` | complete and reachable (registered, routed, exposed), untested here | documented |
| `live` | driven end to end and observed working | verified-live |

`wired` → `live` is the expensive step and the one people skip. The distinction between "the code exists" and "the code is reachable" is `partial` → `wired`, and it is where most real gaps hide: a handler nobody registered is invisible to every caller and looks complete in a grep.

### 1. Find the authoritative set

Determine where the list of capabilities actually lives. Three cases, and which one holds decides everything downstream:

- **Code-derivable** — an enum, router table, command registry, tool manifest, OpenAPI spec, or similar single place that enumerates them. Best case: derive the rows mechanically, and cells can legitimately reach `live`.
- **Spec-derivable** — enumerated in a PRD, spec, or design doc but not in code. Derive from there, and note that the doc is the source. A capability in the spec with no code is an `absent` row, which is a real finding.
- **Nowhere** — the set exists only implicitly, in prompt text or in someone's head. **Stop and say so.** Propose candidates from what you can find, mark every row unconfirmed, and tell the user that confirming the list is a product decision, not a documentation one. Deciding what the product does is `lc-north-star` work; this skill records it, it does not invent it.

Completion: the case is named, and if code- or spec-derivable, the exact file that is the source of truth is cited.

### 2. Map each capability to its implementation

For each row, find the code that implements it — and check reachability, not just existence. A function that no router, dispatcher, or registry points at is `partial`, not `wired`, however complete it looks.

Where per-capability work is independent, fan out: one agent per capability, each returning implementing path, reachability, and proposed level with its evidence. Independent verification is what keeps this from being a grep with opinions.

Completion: every row has an implementing path or is marked `absent`.

### 3. Assign support levels — adversarially

For every row proposed as `wired` or `live`, try to disprove it. Those are the claims that lie; `absent` and `partial` rarely need defending.

- Proposed `wired`: is it genuinely registered and reachable from a real entry point, or only defined?
- Proposed `live`: who drove it, when, and what did they observe? A test passing is not the same as the capability working; note which one you have.

Downgrade anything that cannot survive the check. Record what the evidence was, not just the level.

Completion: every `wired`/`live` row cites its evidence; unsupported claims are downgraded.

### 4. Write `docs/capabilities.md`

```md
# Capabilities

> What the product can do and how well each is verified. Derived from
> `src/intents/registry.ts` — re-run `lc-project-state audit` after changing it.
> Support: absent · partial (gap note required) · wired (reachable, untested) · live (driven, observed)

| Capability | Implemented by | Support | Evidence | Gap |
| --- | --- | --- | --- | --- |
| transfer | `src/tools/transfer.ts` | live | drove on staging 2026-07-24 | — |
| swap | `src/tools/swap.ts` | wired | registered, never run | untested |
| bridge | `src/tools/bridge.ts` | partial | no multi-hop path | multi-hop unimplemented |
| stake | — | absent | — | no implementation |
```

Clear any `> ⚠️ Audit due` flag a prior `sync` left at the top of the file. Then ensure `docs/STATE.md`'s topic index has **one** row pointing here, so the map keeps its page cap while a fresh agent still learns the registry exists. Do not copy capability rows into `STATE.md`.

Completion: `docs/capabilities.md` exists, every row has a level and evidence, every `partial` has a gap note, any audit-due flag is cleared, and `STATE.md` has exactly one pointer row.

### 5. Partition the gaps

The registry's payoff, and useful on its own. Split every non-`live` row into two lists, because they answer different questions:

- **Blocks testability** — the user cannot exercise the product at all until this is done. Deployment, config, wiring, auth, a missing entry point.
- **Blocks completeness** — the capability is missing or partial, but the rest of the product is testable without it.

Conflating these is how "get it deployed so I can test" silently becomes "finish everything." Order the testability list by dependency and state the shortest path to a running, exercisable product.

Completion: two ordered lists, and a named shortest path to something the user can actually try.

---

## Definition of done

**bootstrap / sync** — a run is done only when all four hold:

1. **Fresh-chat test passes** (bootstrap) — a clean-context agent orients from STATE.md and answers a real topical question without asking the user for context.
2. **Currency is legible in seconds** — any doc's status (current / historical / dated artifact / research) is determinable from its location, name, or status header alone, without reading its body.
3. **Understanding-changing sessions update the map in the same commit** — enforced by the `AGENTS.md` wiring and honored in practice; a moved capability row is downgraded and the registry flagged in the same commit.
4. **Plain markdown + `AGENTS.md` only** — the convention requires no tool-specific machinery. Any agent that can read files and honor `AGENTS.md` can use and maintain it.

**status** — the briefing is done only when:

1. **Nothing was written** — no file in the repo changed as a result of this run.
2. **Every claim is checkable** — each line cites a path, doc ID, or PR number.
3. **Staleness is explicit** — the user knows whether to trust the briefing before they read it.
4. **The human queue is real** — every "blocked on you" item traces to a recorded request for human input, not to inference about what they'd want.
5. **One next action** — the briefing ends with a single recommendation, not a menu.

**audit** — the run is done only when:

1. **The set is sourced, not invented** — either derived from a cited file, or explicitly marked unconfirmed pending a human decision.
2. **Every `wired`/`live` row cites evidence** — who checked reachability, who drove it and observed what.
3. **Every `partial` row has a gap note** — "partial" with no gap is not a finding.
4. **`STATE.md` has exactly one pointer row** — detail stays in `docs/capabilities.md`, the map stays a map.
5. **Gaps are partitioned** — testability-blocking separated from completeness-blocking, with a shortest path to something runnable.

## Failure modes

- **Map-as-truth** — editing based on a STATE.md row without opening the source. Fix: the row is a pointer; read the source first.
- **Doc sprawl** — bootstrapping by writing a stack of new summary docs. Fix: maintain one map plus the capability record, reorganize what exists, write nothing new but those.
- **Inherited verdict** — transcribing the pile's existing "current status" into the map without checking it against the code and docs. Fix: re-derive.
- **Deleted history** — cleaning up by removing old docs. Fix: demote to `docs/log/`, never delete.
- **Bloated map** — a STATE.md that has grown past re-reading in one sitting, so nobody re-verifies it. Fix: hard page cap; push detail into sources.
- **Stale verified-live** — a row still claiming first-hand verification over code that has since changed. Fix: downgrade the tier on every sync where the code moved.
- **Late map** — updating STATE.md in a follow-up commit, or promising to "later." Fix: same commit as the work, or it does not count.
- **Audit in sync's clothing** — doing verification work in `sync` because the capability record looked stale. Fix: `sync` only downgrades and flags; the verification is `audit`, run when the flag says so.
- **Declaration as verification** (audit) — marking a capability supported because a handler exists. Fix: check reachability, then check someone drove it.
- **Invented set** (audit) — manufacturing the capability list, then grading coverage against it. Fix: name case three and stop; the list is a product decision.
- **All green** (audit) — every row `live` on first run. Fix: you trusted declarations; go back to step 3 and try to disprove each one.
- **Planned rows in the registry** (audit) — recording work that doesn't exist yet as a capability. Fix: current-state only; planned work is tickets and STATE.md's milestone section.
- **Git-log fiction** (status) — a confident briefing in a repo with no STATE.md, built from commit messages. Fix: declare the repo unbootstrapped and label the output as inference.
- **Manufactured queue** (status) — inventing "blocked on you" items to avoid an empty section. Fix: empty is a valid, useful answer.
- **Helpful mutation** (status) — fixing the stale map mid-briefing. Fix: report and hand off to `sync`; status never writes.
