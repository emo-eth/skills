---
name: project-state
description: "Bootstrap and maintain a living project-state convention so a fresh clean-context agent (Claude, Codex, Cursor — any tool) orients itself from the repo alone, without being fed context and without asking. Use when project context keeps dying across sessions or compactions; when someone asks 'what's current here?' or 'make a fresh chat understand this project'; when the repo root is a pile of undated docs, findings, and handoffs; when setting up docs/STATE.md; or for an end-of-session doc sync after meaningful work. Two modes: bootstrap (first run in a repo) and sync (ongoing upkeep)."
argument-hint: "[bootstrap | sync] (defaults: bootstrap if no docs/STATE.md exists, else sync)"
---

# Project State

The failure this skill defends against: a repo where currency is unknowable — a dozen docs at the root, none dated, one of them a finished synthesis nobody indexed, and a fresh agent that has to be spoon-fed context or interrogates the user because it cannot tell what is true *now* from what was true three sessions ago.

The fix is one small, tool-agnostic convention: plain markdown plus `AGENTS.md` wiring. A single `docs/STATE.md` is **the map** — an index that points at where truth lives and how well each claim is verified. The map is never the truth itself. This skill only bootstraps and maintains that map; it does not generate documentation.

Read this whole file before acting. Pick the mode from the argument, or infer it: no `docs/STATE.md` yet → **bootstrap**; one exists → **sync**.

## Standing rules (both modes)

These override any impulse to the contrary. Violating one defeats the purpose of the convention.

- **The map points at truth, never is the truth.** STATE.md is an index. Agents — including you — still open and read the source doc or the code before editing anything. A row in the map is a pointer plus a verification tier, not a substitute for the source.
- **Never delete an old doc. Demote it.** Superseded thinking moves to `docs/log/` and gets a status header pointing at its successor. History is evidence of how decisions were reached; destroying it destroys that.
- **No doc-generation sprawl.** This skill maintains exactly one small map and reorganizes what already exists. It does not spawn new explainer docs, summaries, or per-topic write-ups. If you feel the urge to write a new doc, you are almost certainly off-task.
- **Re-derive, don't inherit.** When you find an existing verdict, shortlist, or "current status" in the pile, check it against the underlying docs and code before transcribing it into the map. Inherited verdicts are unvetted claims wearing a confident tone.
- **Adapt to what exists.** If the repo already has a docs convention (a `docs/` layout, an ADR directory, a status doc under another name), extend it rather than imposing this exact structure. The goal is the properties in "Definition of done," not this literal file tree.
- **The map stays re-readable.** STATE.md has a hard cap of ~1–2 pages — small enough to fully re-read and re-verify every session. A map that outgrows one sitting rots, because nobody checks it. Push detail down into the source docs; keep the map a map.

## Evidence tiers

Every factual claim in the map — every topic row — carries a visible tier tag, not a prose hedge (hedges get compressed away when the map is skimmed and relayed):

- **verified-live** — someone ran it first-hand and observed the result this project.
- **documented** — an authoritative source states it, but it is untested here.
- **inferred** — extrapolation, single-sourced, third-party, or assumed.

If code changes under a row that was `verified-live`, the verification is stale: downgrade the tier until someone re-verifies. A tier is a claim about *evidence*, and evidence expires when its subject moves.

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
2. **Where we are** — current phase, current priorities, what is proven versus what is open.
3. **Standing constraints** — the rules that must survive into any future work regardless of how old the doc they came from is (e.g. "never place session artifacts at repo root," "IBKR adapter is the only live-verified execution path"). These are the load-bearing invariants a fresh agent must not violate.
4. **Topic index** — a table, one row per topic: `topic | thinking/decision doc | code that implements it | verified-by`, and each row tagged with an evidence tier. Superseded docs appear as `historical, behind <successor>`. This is the heart of the map: it connects each area of the project to the doc that decides it, the code that implements it, and the evidence that it works.
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

Spawn a clean-context subagent given **only** the repo (no briefing, no context from this session). Ask it a topical question about current state or a past decision — something answerable only by orienting through STATE.md into the right source doc (e.g. "which execution venue is live-verified and where is that proven?").

It passes if it orients from STATE.md and answers correctly **without asking you for context**. If it flounders — asks what the project is, or answers from a superseded doc — the map is at fault, not the agent. Fix the map (better pointers, clearer currency, a missing row) and re-run until a fresh agent passes cold.

Completion: a fresh clean-context agent, given only the repo, answered a real topical question correctly and without asking for context.

---

## Mode: sync

End of session, or invoked after meaningful work. Keep the map honest against what actually changed.

### 1. Diff reality against the map

Compare what this session changed — `git diff`, plus what you know from the conversation — against what STATE.md currently claims. Where has code moved under a row? What topic has no row yet? Which doc did this session supersede? Which `verified-live` claim now sits on top of changed code?

### 2. Update the map

- Move or rewrite rows whose thinking or code changed.
- Add rows for genuinely new topics (do not invent topics for trivia).
- **Downgrade evidence tiers**: any `verified-live` row whose code changed this session drops until re-verified.
- Mark newly-superseded docs historical in **two** places: the topic index (`historical, behind <successor>`) and a status header at the top of the doc itself pointing to its successor.
- Keep it within the page cap. If the map grew, prune detail down into source docs rather than letting the map bloat.

### 3. Route new artifacts

Any findings / handoff / status doc this session produced goes to `docs/log/YYYY-MM-DD-<name>.md` — never the repo root. This is where session output belongs; the map only *points* at it.

### 4. Land it in the same commit

The map update ships in the same commit as the work that made it necessary. A map updated in a later commit — or not at all — is a map a future agent cannot trust, which is a map nobody reads.

Completion: STATE.md reflects the session's changes; stale `verified-live` tiers are downgraded; newly-superseded docs are marked in both places; new artifacts are in `docs/log/`; all of it is staged in the same commit as the work.

---

## Definition of done

A run is done only when all four hold:

1. **Fresh-chat test passes** — a clean-context agent orients from STATE.md and answers a real topical question without asking the user for context.
2. **Currency is legible in seconds** — any doc's status (current / historical / dated artifact / research) is determinable from its location, name, or status header alone, without reading its body.
3. **Understanding-changing sessions update the map in the same commit** — enforced by the `AGENTS.md` wiring and honored in practice.
4. **Plain markdown + `AGENTS.md` only** — the convention requires no tool-specific machinery. Any agent that can read files and honor `AGENTS.md` can use and maintain it.

## Failure modes

- **Map-as-truth** — editing based on a STATE.md row without opening the source. Fix: the row is a pointer; read the source first.
- **Doc sprawl** — bootstrapping by writing a stack of new summary docs. Fix: maintain one map, reorganize what exists, write nothing new but STATE.md.
- **Inherited verdict** — transcribing the pile's existing "current status" into the map without checking it against the code and docs. Fix: re-derive.
- **Deleted history** — cleaning up by removing old docs. Fix: demote to `docs/log/`, never delete.
- **Bloated map** — a STATE.md that has grown past re-reading in one sitting, so nobody re-verifies it. Fix: hard page cap; push detail into sources.
- **Stale verified-live** — a row still claiming first-hand verification over code that has since changed. Fix: downgrade the tier on every sync where the code moved.
- **Late map** — updating STATE.md in a follow-up commit, or promising to "later." Fix: same commit as the work, or it does not count.
