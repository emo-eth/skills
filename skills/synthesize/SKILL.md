---
name: synthesize
description: "Turn a scattered pile of research — dossiers, spreadsheets, chat threads, prior findings docs — into audience-fit understanding: a verbal brief, a written sync doc, or your own mental model. Use when research feels 'too granular without a good high-level thing to share,' when asked to summarize or synthesize scattered findings, prepare an executive summary, or explain complex findings to someone else, or when the user says they don't know how to make sense of a pile of information they've assembled."
argument-hint: "[topic, or path to the research to synthesize]"
---

The failure this skill defends against: restating a verdict — someone else's, or an earlier pass of your own — in polished prose, without redoing the analysis that verdict depends on. **Raw-first** is the discipline that prevents it: data before interpretation, losers before winners, every claim tagged, every audience served on purpose rather than by accident.

## 1. Map the stakeholders

Before opening any file, list who will read something produced this pass. For each: what they explicitly asked for, and what they probably need if they didn't say it. A person confused about "the task at hand" is really asking this question without naming it — surface it for them.

Completion: a written list exists, one line per audience, each with an explicit-ask clause and an inferred-need clause, before any research file is opened.

## 2. Inventory before you synthesize

Enumerate every existing artifact that touches the topic — docs, spreadsheets, prior write-ups, chat threads — and read each one's headers or structure, not just its filename. Spreadsheets and slide decks routinely hide a finished synthesis in a tab or section nobody opened; check for one specifically.

If a **hidden synthesis** turns up — someone (or something) already produced a summary and it went unread — say so explicitly, by name and location. Surfacing it beats silently superseding it, and it beats silently redoing it.

But existing ≠ good. A hidden synthesis has not earned trust just by existing, especially if it was itself machine-generated from the same scattered inputs — that's another layer of unvetted claims, not a shortcut past them. Hold it to the same bar as anything else: run it through steps 3–5 before repeating or presenting it. If it turns out to be noise (redundant, wrongly shaped, unclear provenance), say that plainly instead of presenting its discovery as a win.

Completion: every existing artifact is listed with a one-line description of what it already contains, before any new writing starts. Any hidden synthesis found is evaluated, not assumed valuable.

## 3. Tag every claim's evidence tier

Three tiers: **verified-live** (someone actually ran or tested it), **documented** (an authoritative source states it, untested), **inferred** (search-synthesis, third-party, single-sourced, or your own extrapolation). Mark every claim with its tier, visibly — a distinct tier marker, not a hedge buried in prose. Prose hedges get compressed away by whoever reads and re-forwards the summary; a visible tag survives that compression.

Completion: no claim in the output is untagged, and any claim resting on a single source or an unconfirmed fetch is flagged as such.

## 4. Raw before cooked

Show the underlying data unfiltered and ask what the reader notices, before offering any interpretation. Complex comparisons usually collapse onto one or two axes that decide most of the outcome — name that axis once it's visible, instead of presenting a wall of equally-weighted facts. Write the bottom-line or TL;DR last, after the reader has seen the raw material and reacted to it, never first.

Completion: the raw data has been shown and reacted to before any verdict is written; the TL;DR section is the last thing drafted, not the first.

## 5. Re-derive, don't inherit

When the source material already contains a verdict or a shortlist, re-run the elimination against the *full* option set before repeating that verdict — even when you land in the same place. The rejected options and the specific reason each one lost are the analytical content; the winner alone is not. Weight research effort by relevance to the open question, not by incumbency — an option that got looked at first, or named first in the original ask, is not thereby a stronger option, and an under-researched option can turn out to matter more than every incumbent once actually checked.

Completion: every option that was not selected has a stated, specific reason for rejection — not merely the absence of selection.

## 6. Match the artifact to the map

Return to the list from step 1. Produce one shaped deliverable per audience rather than forcing a single document to serve all of them — a verbal one-line brief for a live conversation is a different artifact from a written sync doc for a team, which is different again from an internal handoff for whoever picks up the underlying work next.

Completion: each audience from step 1 has a deliverable sized and shaped for how they'll actually consume it.

## Dispatching research agents

When delegating production of a research file to a subagent, confirm the agent type actually has Read/Write before instructing it to save output at a path. Some research-only agent configurations carry only WebSearch/WebFetch and will hand back the full write-up as text, asking the orchestrator to save it — plan for that outcome (read the returned text, save it yourself) rather than assuming the instruction to "write to path X" is sufficient on its own.

## Failure modes

- **Validated-not-derived** — restating an inherited verdict without showing the losers. Fix: step 5.
- **Verdict-first** — leading with conclusions before the reader has seen the raw material. Fix: step 4.
- **Confidence bleed** — a hedge in prose ("moderately verified," "search-synthesis suggests") that reads as fact once someone else compresses and relays the summary forward. Fix: step 3's visible tier tag, not a more careful hedge.
- **Incumbency bias** — treating the options that got researched first as the strongest ones, rather than checking. Fix: step 5.
- **One-document-fits-all** — writing a single artifact for every audience in step 1. Fix: step 6.
- **Noise-as-discovery** — treating a found artifact as valuable because it already exists or was already "synthesized," without checking whether it actually clarifies anything. A machine-generated summary of the same scattered inputs is not automatically a shortcut past them. Fix: step 2's existing ≠ good caveat.
