# Audit Passes

Run these passes against the intent ledger. A finding must cite contract intent and target evidence. Contract intent can come from the PRD or `vibe.md`.

## Severity

- **P0:** The target would ship a product that violates the north-star contract, exposes the wrong data, breaks a must-have user flow, destroys a core vibe promise, or creates a high-risk safety/compliance issue.
- **P1:** A stated PRD requirement, unacceptable outcome, platform promise, success criterion, vibe promise, anti-vibe, or use circumstance is contradicted or omitted.
- **P2:** The target probably violates intent, but the evidence is incomplete; or verification is too weak to prove a meaningful PRD requirement or vibe clause.
- **P3:** Residual ambiguity or minor unproven edge case that does not block the contract's core intent.

## Status Values

Classify every ledger row:

- **satisfied:** target directly satisfies the PRD or vibe item and has adequate verification.
- **violated:** target contradicts, omits, narrows, or expands the PRD or vibe item.
- **unproven:** target may satisfy the item, but no evidence or verification proves it.
- **out-of-scope:** PRD or vibe explicitly excludes or defers the item and names acceptable current behavior.
- **amendment-needed:** downstream reality requires a product or vibe decision before work can honestly proceed.

## Coverage Pass

Ask:

- Which PRD requirements have no matching target behavior?
- Which vibe clauses have no matching target behavior, affordance, flow, wording, visual state, or verification?
- Which acceptance criteria are only partially represented?
- Which users, jobs, or required surfaces disappeared?
- Which undesirable outcomes have no prevention, handling, or test?
- Which anti-vibes can still occur?
- Which success criteria cannot be measured or demonstrated from the target?

Flag missing obligations as P1 unless the contract itself marks them out of scope.

## Drift Pass

Ask:

- Did the target narrow platform support, permissions, data visibility, persistence, or recovery behavior?
- Did it add product behavior the PRD did not authorize?
- Did it make the product feel harder, more brittle, less forgiving, more confusing, or more implementation-exposing than `vibe.md` allows?
- Did implementation choices create user-visible constraints the PRD did not accept?
- Did the spec or plan reinterpret a requirement into something easier but materially different?
- Did the spec or plan reinterpret a vibe promise into decorative polish or optional UX?
- Did any target wording turn a must-have into a maybe, later, or nice-to-have?

Flag silent narrowing or expansion as at least P1.

## Counterexample Pass

Construct scenarios that try to make forbidden outcomes happen:

- Mobile user completes the primary flow.
- User refreshes, navigates away, logs out, or retries mid-flow.
- User lacks permissions, loses access, or changes org/context.
- Data is empty, stale, partial, slow, duplicated, or unavailable.
- Two users or processes act on the same resource.
- External services fail, time out, reorder events, or return malformed data.
- Admin and non-admin users attempt each other's actions.
- A user in each stated vibe circumstance tries the flow: rushed, distracted, mobile, repeated daily, high-stakes, first-time, operator under pressure.
- A user encounters every anti-vibe named in `vibe.md`.

For implementation targets, trace the scenario through code. For docs, trace whether the spec or plan says enough to prevent the outcome.

## Verification Pass

Ask:

- Which PRD requirements have tests or manual checks?
- Which vibe clauses have demo checks, screenshot checks, dogfood checks, usability checks, or reviewer checks?
- Which undesirable outcomes are tested directly?
- Which tests only prove implementation details rather than PRD behavior or vibe?
- Which user-visible states lack E2E, integration, or manual coverage?
- Which success criteria require instrumentation, logs, analytics, or operational checks?
- Which vibe checks require a finished-product review rather than a unit test?

Weak verification for a core requirement or vibe clause is P2. Missing verification for a high-risk requirement or core vibe clause is P1.

## Layering Pass

Ask:

- Is the PRD being changed by the spec, plan, or code without approval?
- Is `vibe.md` being changed, softened, ignored, or treated as polish without approval?
- Is the spec changing technical design without updating itself?
- Is the plan implementing behavior not in the spec?
- Is the implementation relying on a product or vibe assumption that belongs in the contract?

Treat unauthorized PRD or vibe mutation as P1 or P0 depending on impact.

## Finding Schema

Each finding should include:

- Severity.
- Contract item ID or section.
- Target location or behavior.
- Category: coverage, drift, counterexample, verification, layering.
- Evidence from PRD or `vibe.md`.
- Evidence from target.
- Why the discrepancy matters.
- Required resolution.
- Confidence: high, moderate, or low.

Suppress low-confidence findings unless they identify a concrete amendment-needed decision.
