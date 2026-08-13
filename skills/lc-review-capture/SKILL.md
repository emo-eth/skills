---
name: lc-review-capture
description: Persist what a human review round decided, so the round never has to happen twice. Use immediately after annotations or feedback come back from ANY human review round (Plannotator or otherwise), while applying them, and after applying them — snapshot the raw feedback, produce the numbered answers doc, record decisions to docs/DECISIONS.md, update docs/taste.md, route deferred work, and close with one summary. Triggers on "the annotations came back", retrieved Plannotator output, applying review feedback, or a review round ending — including approval rounds. Never human-invoked; runs every round.
---

# Review Capture

The failure this skill defends against: a review round evaporates. The doc
gets better, but the *why* — what the human rejected, what they chose, the
tradeoff they accepted — lives only in a transient feedback buffer. Next
session the agent re-proposes the thing the human already killed, and the
human reviews the same doc three times.

The fix is one mandated pass, run by the agent after every round, with no
human invocation. The human's entire interface is: annotate, then read one
closure summary.

This skill owns capture. It does not own review mechanics — how to launch
sessions, protect unsubmitted drafts, or retrieve feedback is
`annotation-review`'s job. This skill starts where retrieval ends.

## When it runs

After EVERY round where a human's judgment came back — including pure
approval rounds and rounds delivered through any tool. No exceptions, no
"nothing worth saving." The pass scales to the round: a typo round costs
thirty seconds; skipping capture costs a repeated review.

If you are about to apply human feedback and this skill has not run, stop
and run it. Applying without capturing is the bug.

## The pass

Seven steps, in order. Steps 1–3 happen with the raw feedback in hand;
4–6 as part of applying it; 7 last.

1. **Snapshot the raw feedback verbatim** to
   `.context/review/YYYY-MM-DD-<target>-round-N.md` in the project repo
   (create `.context/` and gitignore it if absent — it is machine-managed
   crash recovery, never a human artifact, never committed).
2. **Apply every item** to the reviewed document. Items you disagree with
   get a stated reason — never silence.
3. **Write the answers doc** (or section, per project convention): every
   numbered item, in the human's numbering, with where each fix landed and
   anything still needing human input collected at the end.
4. **Record decisions** to `docs/DECISIONS.md` — one append-only entry per
   decision, each quoting the annotation that forced it. The test: *an
   entry is only a decision if reversing it would change future behavior.*
   Typo fixes and mechanical corrections get nothing. Format and taxonomy:
   `references/persistence.md`.
5. **Update `docs/taste.md`** when the round revealed a pattern — a
   preference stated twice, a rejected category of change, a standing
   constraint. Taste entries cite the decision IDs that established them.
   Agent-maintained; the human audits occasionally, approves nothing
   per-round.
6. **Route state changes**: a deferred item gets BOTH a `Status:
   deferred` entry in the log (the detail, with its revisit trigger) and
   a pointer under STATE.md's "Where we are — Deferred" (the map). Open
   questions needing the human go under "Open". A load-bearing decision
   that constrains ALL future work also gets a one-line mirror in
   STATE.md's Standing constraints citing its D-ID. `docs/DECISIONS.md`
   and `docs/taste.md` themselves get rows in the topic index. Mechanics
   of STATE.md are `lc-project-state`'s — this skill only hands off.
7. **Close with one summary** — the only human-facing output: what was
   applied, what was recorded (decision IDs), what was deferred and why,
   and exactly what (if anything) still needs the human. Short.

Steps 4–6 may be delegated to a light subagent when the round is large.
Cheap is required; skipped is not.

## The decision test

An entry is a decision only if reversing it would change future behavior.
Apply it three ways:

- **Too small**: "fixed typo in §3" — reversing it changes nothing about
  future work. No entry.
- **Decision**: "bundle copies keep original filenames" — reversing it
  would silently break diff view next round. Entry.
- **Approval that settles an open question**: "ship v0 without auth" —
  reversing it would reopen scope. Entry. (A pure LGTM on a typo round is
  not.)

Every entry quotes the annotation verbatim. The quote is what makes
"mistakes not repeated" enforceable rather than aspirational — an agent
can check a future proposal against the human's actual words.

## Approval gates

Human approval IS required for: unresolved product behavior or scope,
conflicting domain definitions, contract or data-lifecycle sign-off,
meaningful architectural tradeoffs, destructive or external actions.

Human approval is NOT required for — and this skill performs without
asking: annotation extraction, crash-recovery snapshots, numbering and
cross-linking, answers docs, recording already-explicit rationale,
DECISIONS.md/taste.md maintenance, STATE.md pointer and status updates,
moving non-blocking future issues into deferred work, mechanical
corrections.

## Artifact roles

- **STATE.md** — the map: current work, deferred work, open decisions,
  pointers. Owned by `lc-project-state`.
- **DECISIONS.md** — the log: every decision, append-only, superseded
  entries demoted not deleted. Load-bearing is a tag on an entry, not a
  separate ADR ceremony.
- **taste.md** — how the human thinks, distilled: a page of principles
  citing decision IDs. An agent reads ten principles, not forty decisions.
- **The reviewed docs** — current thinking. Decisions local to a doc live
  in the log with a pointer, not duplicated in prose.

## Failure modes

- **Trivia logging** — entries for typo rounds. Fix: the decision test.
- **Missing rationale** — entry states *what* without the human's *why*.
  Fix: quote the annotation, always.
- **Silent disagreement** — dropping an item you disagree with. Fix:
  stated reason in the answers doc, every time.
- **Deferred black hole** — v1 items vanish into a list nobody reads.
  Fix: every deferred entry carries a revisit trigger, and planning-time
  agents read deferred entries before proposing v1 work.
- **Taste fan fiction** — taste.md drifting into the agent's imagination
  of the human. Fix: every principle cites decision IDs; no citation, no
  principle.
- **Capture promised, not run** — "I'll record that later." Fix: the pass
  is part of the round; a round is not done until step 7.
- **Endless fix rounds** — a doc coming back for a third fix round. Fix: the
  bound is two fix rounds per doc and the goal is one. A third-round need
  means the draft failed; say so in the closure summary and recommend a
  rewrite or re-interview instead of opening round three.
- **Reconstructed rationale** — answering "why did we decide X" from
  memory when the log has no entry. Fix: say the log has no entry, check
  `.context/` snapshots and git history, and capture going forward —
  never backfill an invented why.
