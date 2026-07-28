---
name: confidence-gated-review
disable-model-invocation: true
description: Replace review-everything with confidence-gated exception handling. Use when working under a product owner who doesn't want to review every doc/decision - rate each decision by how well you understand their intent, proceed above threshold with a logged call, and bring them only the low-confidence residue plus actions only they can take. Requires a written product contract (vibe/PRD or equivalent) to score against.
---

# Confidence-Gated Review

The failure this replaces: every doc goes to the owner, their queue fills
with "what does this mean" comprehension taxes, review becomes the
bottleneck, and the *actual* decisions drown in the volume. The owner's
words that created this skill: "i don't want to review too much... i only
want to review the stuff you actually need guidance on."

## Preconditions

- A WRITTEN product contract exists (vibe doc, PRD, or equivalent). The
  confidence score means "how sure am I this matches the contract and the
  owner's intent" — without a contract you are scoring against your own
  mood, which is worthless.
- A decision log location the owner knows about (a standing doc or the
  project's state map).

## The loop

For every decision that would previously have gone to review:

1. **Score it 0-100**: how well do you understand the product and the
   owner's intent HERE, specifically. Not "how good is my solution" —
   "how sure am I the owner would nod."
2. **Write the reason the score isn't higher.** This sentence is more
   informative than the number and is mandatory. ("82: shape follows PRD
   R1, but the default allocation content is taste, not spec.")
3. **Route by threshold** (default 75, owner-tunable):
   - ABOVE: proceed. Log: decision, score, the reason-it-isn't-higher,
     where it landed (commit/doc). Do not ask. Do not announce each one.
   - BELOW: queue it for the owner — the QUESTION and your recommended
     answer, not a document to read.
   - EXTERNAL: things only the owner can do (accounts, credentials,
     legal, other humans) are actions, not reviews — list them separately
     and keep the list short and concrete.
4. **Batch the asks.** Never drip low-confidence items one at a time;
   deliver them in one small set with everything needed to decide inline.

## Calibration honesty (the failure mode inside the fix)

Confidence measures your SENSE of understanding, not truth — you can be
90-confident and flat wrong. Three mandatory backstops:

- **The decision log is skimmable by design**: one line per call. Invite
  the owner to skim weekly (~5 min) and veto; drift compounds silently
  without this.
- **External checks trump scores**: if the project has an eval harness /
  test suite that measures the product against the owner's stated
  demands, a passing score there beats your confidence number — and a
  failing one overrides it.
- **When corrected, recalibrate the CATEGORY, not just the item.** A
  correction means every score in that neighborhood was inflated; say so
  in the log and re-rate the neighbors.

## What still always goes to the owner

- Anything that would CHANGE the contract itself (vibe/PRD edits).
- Irreversible or outward-facing actions (real money, publishing,
  deleting user data) regardless of confidence.
- The first instance of a new KIND of decision, even at high confidence —
  it seeds calibration for the category.

## Review mechanics

When something does go to the owner, keep the surface tiny: one short
item (or diff) per decision, the recommendation stated first, and — if
using an annotation tool — one standing session, never replaced under
them (see annotation-review's prime rule).
