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

## Field Requirements

### 1. Intention
- Must state the exact problem being addressed and the concrete deliverable.
- Must trace directly to an approved Spec item or PRD requirement.
- Must be understandable to an agent with a fresh context window.

### 2. Vibe
- Carries the qualitative guardrails and feel expectations for the work slice.
- Must cite relevant VRD feel IDs (`V1`, `V2`, ...) and anti-vibes.
- Must state what would make the delivery feel broken even if code compiles.

### 3. Done-when
- Must consist of checkable, concrete conditions.
- No vague placeholders ("handle edge cases", "improve performance", "TBD").
- Every criterion must have an observable proof surface (a passing test, verified command output, UI check, or diff inspection).

### 4. Map
- Must provide exact coordinates: workspace label, git worktree path, branch name, and contract file paths.
- Enables anyone to reopen, inspect, or resume the work slice without guessing where state lives.

---

## Completeness Check

Before dispatching a worker with a Ticket Spec, verify:

- [ ] The ticket has all four sections: Intention, Vibe, Done-when, and Map.
- [ ] Intention explains the specific problem and deliverable without requiring conversational context.
- [ ] Done-when criteria are observable and verifiable.
- [ ] Map lists valid, existing workspace and worktree coordinates.
- [ ] The ticket does not contain raw conversation transcripts or unedited session dumps.
- [ ] The ticket is not a bare title stub.
