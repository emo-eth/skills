# Ticket Spec Reference

The **Ticket Spec** is the concrete downstream artifact produced from the Spec (and optional Plan) before dispatching work to an executing worker or workspace.

It is a named, structured object living directly on the issue/ticket (or `.herdr-ticket` / `TICKET.md` in the worktree). It gives the assigned agent or human complete, self-contained clarity on what must be accomplished without forcing them to hunt through chat history or multiple unanchored documents.

A ticket spec is:
- **Concrete:** bounded, verifiable, and actionable.
- **Structured:** strictly follows the four canonical sections.
- **Not a title stub:** a one-line title with an empty description is not a ticket spec.
- **Not a session dump:** raw transcripts, unedited scratch notes, or stack traces are not a ticket spec.
- **Not a second PRD:** it does not re-litigate product requirements or originate new user why; it binds the execution slice to the upstream VRD, PRD, and Spec.

---

## Ticket Spec Schema & Template

```markdown
## Intention

[One crisp paragraph describing what problem is being solved, what concrete capability or fix is introduced, and why now. Traced to the upstream VRD and PRD.]

## Vibe

[Qualitative feel promises, stakes, and boundaries for this slice of work. Cites relevant VRD feel IDs and anti-vibes. What must never happen during execution.]

## Boundaries & Non-goals

- [Explicit out-of-scope items, forbidden changes, or protected files.]
- [No merge: PR ready-for-review only, or specific deployment constraint.]

## Done-when

- [ ] [Observable, verifiable criterion 1: exact behavior or test pass.]
- [ ] [Observable, verifiable criterion 2: UI, CLI, or API verification.]
- [ ] [Observable, verifiable criterion 3: clean git state, documentation, or integration proof.]

## Map

- **Workspace Label:** [Herdr workspace label / human chair name]
- **Worktree Path:** [Filesystem path to the dedicated git worktree]
- **Branch:** [Git branch name]
- **Upstream Contracts:** [Paths to VRD, PRD, and Spec]
```

---

## Execution Mode: Slice vs Ratchet

Every ticket spec must declare its execution mode:

### 1. Mode: Slice (Mechanical / Plumbing)
Default mode for deterministic implementation: API routes, schema migrations, UI components, wiring, and standard bug fixes.
- **Verification:** Unit tests, integration tests, end-to-end smoke tests, and observable outcome criteria.
- **Lifecycle:** Single pass or short phased execution to satisfying all Done-when criteria.

### 2. Mode: Ratchet (Empirical Optimization / AutoResearch + AutoImplement)
Mandatory mode for tuning, semantic search relevance, latency reduction, prompt engineering, and heuristic classifiers.
- **The Rule:** Empirical optimization cannot be verified by "tests pass." It requires a frozen scalar oracle, a tiny editable surface, and an automatic keep/revert ratchet.
- **Mandatory Ratchet Clauses (Required for Ratchet Tickets):**
  1. **`## Frozen Oracle`**: The exact command (e.g. `npm run search:compare`), target metric (e.g. `NDCG@10`), and frozen test dataset path. The agent is strictly forbidden from editing the evaluator, tests, or benchmark data.
  2. **`## Edit Surface`**: Exact bounded list of files or directories the agent may touch (e.g. `src/lib/search/retrieval.ts`, `src/lib/search/rollup.ts`). Edits outside this surface trigger an immediate revert.
  3. **`## Ratchet Rule`**: Baseline score, required improvement threshold (e.g. `≥ 2%`), and mechanical keep/reset policy: improved $\rightarrow$ commit and log `keep`; degraded/neutral $\rightarrow$ `git reset --hard HEAD~1` and log `discard`.
  4. **`## Negative Memory`**: Untracked log paths (`results.tsv` / `journal.md`) recording tested hypotheses, scores, and failure reasons so fresh iterations do not retry failed ideas.

---
## Field Requirements

### 1. Intention
- Must state the exact **what** (concrete capability or fix) and **why** (problem-as-felt and stakes) for this slice.
- Must trace directly to the upstream VRD's What Is Desired and Why As Stakes, as well as an approved Spec item or PRD requirement.
- Must answer: *What is being changed?* and *Why does this matter now?*
- Must be understandable to an agent with a fresh context window without reading prior chat turns.

### 2. Vibe
- Carries the qualitative guardrails, feel expectations, and operational boundaries for the work slice.
- Must cite relevant VRD feel IDs (`V1`, `V2`, ...) and anti-vibes.
- Must state what would make the delivery feel broken even if the happy-path code compiles and tests pass.
### 3. Done-when
- Must consist of checkable, concrete conditions.
- No vague placeholders ("handle edge cases", "improve performance", "TBD").
- Every criterion must have an observable proof surface (a passing test, verified command output, UI check, or diff inspection).

### 4. Map
- Must provide exact coordinates: workspace label, git worktree path, branch name, and contract file paths.
- Enables anyone to reopen, inspect, or resume the work slice without guessing where state lives.

---

## Specification Sufficiency Gate ("Underspecified Gate")

Before a worker is dispatched, evaluate the ticket spec against the sufficiency rubric:

### The Four Ticket Spec Anti-Vibes

| Anti-Vibe | Definition & Failure Mode | Example Violation |
| :--- | :--- | :--- |
| **The Hollow Ticket** | Placeholder, tautological, or boilerplate text substituted for genuine intent. | *"The work named here is finished. Work captured from a herdr worktree."* |
| **Prescriptive Vibe** | Vibe specifies code mechanics, CLI flags, or file surgery instead of user experience and qualitative boundaries. | *"Add `--filter-mode=fast` and edit line 45 of search.ts."* |
| **Tautological Done-When** | Criteria state circular or unobservable conditions lacking a concrete proof surface. | *"Done when finished"*, *"Done when bug is fixed"*, *"PR is merged"*. |
| **The Unmapped Orphan** | Missing Map section, unclickable paths, or missing proof command. | Omits Map or gives raw filesystem paths with no test command. |

### Tri-State Classification & Operational Dispatch Rule

1. **`SPECIFIED`**: All four sections present, non-tautological, and observable proof surfaces named.
   - **Action:** Pull work and dispatch worker automatically without asking operator permission.
2. **`UNDERSPECIFIED`**: Structural flaw or missing section that is repairable from upstream contracts.
   - **Action:** Auto-repair from VRD/PRD if possible, or prompt the operator with a targeted nuance question before dispatch.
3. **`NEEDS_HUMAN_NUANCE`**: Core product outcome missing or hollow placeholder stub.
   - **Action:** Halt dispatch; prompt the operator for product nuance or re-examine source voice memo.

---

## Completeness Check

Before dispatching a worker with a Ticket Spec, verify:

- [ ] The ticket has all four canonical sections: Intention, Vibe, Done-when, and Map.
- [ ] Intention explicitly answers both **what** is being delivered and **why** it matters now, grounded in the VRD/PRD.
- [ ] Vibe references concrete VRD feel clauses and anti-vibes (no code mechanics or CLI flags).
- [ ] Done-when criteria are observable, specific, and verifiable (contains proof command, HTTP status, or test assertions).
- [ ] Map lists valid, existing workspace label, worktree path, branch name, and contract paths with clickable HTTPS links.
- [ ] The ticket does not contain raw conversation transcripts or unedited session dumps.
- [ ] The ticket is not a bare title stub or hollow placeholder.
