# Nested Assignment Limits Proposal

## Glossary

- **Wall Clock**: The plugin that enforces real elapsed-time limits around agent work.
- **OMP**: The `@oh-my-pi/pi-coding-agent` native host.
- **Time contract**: The owner session's enforced deadline, wrap-up boundary, and expiry policy.
- **Owner session**: The top-level OMP session that owns one time contract and its durable assignment tree.
- **Execution session**: One OMP session that performs an assignment.
- **Assignment**: A bounded piece of work with an objective, scope, acceptance targets, and a time ceiling.
- **Root assignment**: An assignment created directly by the owner session under a plan item.
- **Nested assignment**: An assignment created within another assignment.
- **Parent assignment**: The assignment that created a nested assignment.
- **Descendant assignment**: Any assignment below another assignment in the assignment tree.
- **Effective deadline**: The earliest applicable deadline from the time contract, every ancestor assignment, and the assignment's requested ceiling.
- **Effective wrap-up**: The earliest applicable wrap-up boundary from the time contract, every ancestor assignment, and the assignment's requested wrap-up.
- **Session binding**: The relation between one OMP execution session and the assignment it performs.
- **Abort domain**: One native OMP session controlled by one session-wide abort function.
- **Terminal report**: The structured result that ends an assignment as complete, partial, blocked, or expired.
- **Background task**: An OMP task whose execution continues after its caller's `task` tool call returns.

## Verdict

This is a medium-sized extension, not an architectural rewrite. The recursive part is simpler than the earlier discussion implied.

Wall Clock already keeps assignments in one owner state, maps every execution session back to that state, scopes actions by assignment, and uses a process-wide registry when OMP gives a child a different event bus. OMP 17.2.15 already exposes the `task` tool to child sessions up to `task.maxRecursionDepth`, which defaults to two. Two explicit Wall Clock guards currently prohibit a child from creating or delegating another assignment.

The real work is to define ancestor rules, validate the assignment tree, and prove lifecycle correlation at the next OMP depth. The largest uncertainty is not recursion. It is background execution: OMP enables asynchronous tasks by default, while the current native Wall Clock child tests set `async.enabled` to false. A one-level background-child characterization test is a prerequisite before changing the data model.

| Area | Complexity | Reason |
| --- | --- | --- |
| Assignment tree data | Medium | One parent link plus tree validation replaces the current flat root-only contract. |
| Deadline calculation | Low | A direct child only needs the minimum of its requested boundary and its parent's already-effective boundary. |
| Nested session binding | Low to medium | The existing process-wide registry should recurse, but a real OMP test must prove event order and cleanup. |
| Action admission | Medium | Decisions must use ancestor phase and status, not only the current assignment. |
| Abort behavior | Medium | An ancestor expiry must select running actions across its assignment subtree and deduplicate abort requests. |
| Background tasks | Medium to high uncertainty | Current native child tests do not exercise OMP's default asynchronous path. |
| Persistence | Medium | Version 4 must reject cycles, bad ancestry, and child boundaries that exceed ancestor boundaries. |

Expected change surface: five production modules (`types.ts`, `controller.ts`, `store.ts`, `host.ts`, and `mcp.ts`), tests, and documentation. The OMP adapter registry should not need a new architecture. No new dependency is needed.

## Objective

Allow an assignment-scoped OMP agent to create a smaller enforced assignment and bind it to one native `task` child. Repeat this while OMP permits another recursion level.

Example:

```text
owner session: 30 minutes
  assignment A: implement feature, 20 minutes
    assignment B: inspect API behavior, 5 minutes
      assignment C: reproduce one edge case, 90 seconds
```

Every lower assignment has its own measured elapsed time and report. No lower assignment can outlive or bypass an ancestor limit.

## Non-goals

- Pi child delegation.
- OMP batch `tasks[]` delegation.
- A different expiry policy for each assignment.
- Automatic selection or division of assignment budgets.
- File-system enforcement of the free-text `scope` field.
- Cancellation of remote provider inference.
- Migration of version 4 session state.
- Increasing OMP's own recursion limit.

## Current behavior

The current controller stores a flat `assignments` array. Each assignment points to the owner session and can bind one child session. A child binding resolves all controller access back to the owner state and the child's assignment.

Recursion is stopped at two points:

1. `wallclock_assign` rejects any caller that already has an assignment scope.
2. Delegation rejects `task` from an assignment-scoped caller.

Batch delegation is supported at the parent level. Each inline batch item
creates one bounded assignment and maps to one child session. The one-unbound
assignment selection remains only for the legacy single-task path where the
parent pre-created one assignment.

Those two nested-delegation guards are deliberate v0 restrictions. They are
not evidence that the host cannot recurse.

The current OMP registry is already close to the required form. Each extension instance listens on its local event bus. When a child starts, its extension adopts the owner coordination object through a process-wide session-file registry. A nested child's local lifecycle listener can therefore publish a grandchild binding into the same registry. This must be proven in a real host test before relying on it.

## Required behavior

### N1. One owner, recursive assignments

All assignments remain in the owner session's one durable state. A nested execution session does not create a second time contract or a second state store.

Each assignment has at most one parent assignment. Following parent links must end at a root assignment. Cycles are invalid.

### N2. Assignment creation

The owner session can create a root assignment under a root plan item. An assignment-scoped caller can create a nested assignment only while its current assignment is active and before effective wrap-up.

For a nested assignment, the host derives the parent assignment from the caller's session binding. The model cannot name another parent assignment.

The budget starts when `wallclock_assign` succeeds, not when OMP eventually starts the child. Queue and setup time consume the assignment budget.

### N3. Inherited boundaries

A root assignment uses:

```text
hard deadline = minimum(time contract deadline, issue time + requested budget)
own wrap-up = hard deadline - minimum(requested wrap-up, hard deadline - issue time)
wrap-up = minimum(time contract wrap-up, own wrap-up)
```

A nested assignment uses:

```text
hard deadline = minimum(parent hard deadline, issue time + requested budget)
own wrap-up = hard deadline - minimum(requested wrap-up, hard deadline - issue time)
wrap-up = minimum(parent wrap-up, own wrap-up)
```

Because every parent boundary is already effective, checking the direct parent also checks every ancestor.

The expiry policy is inherited from the time contract and cannot change within the tree.

### N4. Effective phase

Action admission uses the most restrictive state in the assignment's ancestry:

- If the assignment or any ancestor is expired, new non-control work is blocked as expired.
- If the assignment or any ancestor is terminal, new non-control work is blocked because the branch is closed.
- If the assignment or any ancestor is in wrap-up, delegation and destructive actions are blocked.
- Otherwise, the assignment is active.

Status and injected context show the current assignment's effective deadline, effective wrap-up, phase, and elapsed time. They also name its parent assignment when one exists.

### N5. Delegation correlation

A single task call can start from one active, unbound parent assignment when
the parent pre-created that assignment. An inline batch task call instead
contains one assignment contract per item; the host validates the full batch,
creates one assignment per item, and correlates each child by its batch index
and native `parentToolCallId`.

Each assignment binds to one child session. Batch delegation is therefore
many independent assignment-to-child links, not one shared assignment.

Lifecycle correlation must use the emitting execution session,
`parentToolCallId`, and batch index. The adapter must not guess from a
globally unique-looking tool-call identifier or from an unrelated unbound
assignment.

### N6. Session access

An execution session can:

- inspect its own assignment;
- create a direct nested assignment;
- inspect assignments in its own descendant subtree;
- report only for its own assignment.

It cannot inspect ancestors beyond the measured context supplied to it, inspect sibling branches, stop the owner time contract, revise the owner plan, or report for another assignment.

The owner session retains access to the full tree.

### N7. Reports and completion

A `complete` or `partial` terminal report is rejected while any descendant assignment is active. The caller must first receive or terminate every descendant result. `wallclock_complete` follows the same rule and does not replace the report required before OMP `yield`.

A `blocked` or `expired` report is allowed with active descendants because an ended branch or `block-new` expiry can leave already-admitted work running. The report must list those descendants as unknown or skipped work. An unexpected OMP lifecycle termination can also create the existing fallback `blocked` or `expired` report while descendants are still active.

Once an ancestor is terminal, descendants may use Wall Clock control tools to report and finalize, but cannot start ordinary work. Under `block-new`, already-admitted actions may finish. Under `abort-running`, the adapter requests an abort for every running action in the ancestor's assignment subtree.

A descendant report remains stored in the owner state even when its immediate parent execution session has ended. Reports do not automatically rewrite ancestor reports.

OMP `yield` remains blocked until the current assignment has a terminal report. A `complete` or `partial` report therefore also proves that all descendants are terminal.

### N8. Abort domains

The existing one-action-per-native-session rule remains. A parent `task` action and a descendant action can run together because they have separate native abort domains.

When assignment A expires under `abort-running`, expiry handling selects actions for A and every descendant of A. Each native session context receives at most one abort request, and each action records one observed abort result.

The root time-contract expiry continues to select every owned action.

### N9. Persistence and restore

State version 5 is required. Version 4 state fails closed and is not migrated.

Restore validates the full tree before activation. It schedules timers for every active assignment from stored absolute boundaries. Runtime session bindings and running actions remain non-durable and must be rebuilt from OMP lifecycle events.

### N10. OMP recursion limit

Wall Clock does not invent a second depth setting. Delegation is available only when OMP exposes the native `task` tool at that execution depth. If OMP denies another spawn, Wall Clock preserves the prepared assignment as unbound until it expires, is completed by the owner, or is otherwise resolved.

## Data shape sign-off checkpoint

Do not implement this proposal until the user approves this shape. The field names are part of the durable contract that other code and tests will use.

### Assignment draft

This is the native `wallclock_assign` input:

```ts
type AssignmentDraft = {
  id?: string;
  rootPlanItemId?: string;
  objective: string;
  scope: string[];
  acceptance: string[];
  budgetMs: number;
  wrapUpMs?: number;
};
```

`rootPlanItemId` is required from the owner session and rejected from an assignment-scoped caller. For a nested assignment, the host inherits it from the parent assignment.

### Durable assignment

```ts
type Assignment = AssignmentDraft & {
  id: string;
  ownerSessionId: string;
  rootPlanItemId: string;
  parentAssignmentId?: string;
  executorSessionId?: string;
  issuedAt: number;
  hardDeadline: number;
  wrapUpAt: number;
  status: "active" | "complete" | "partial" | "blocked" | "expired";
  completedAt?: number;
};
```

Changes from version 4:

- `parentSessionId` becomes `ownerSessionId` because it always names the tree root, not the immediate parent.
- `parentPlanItemId` becomes `rootPlanItemId` because nested assignments inherit the root plan relation.
- `parentAssignmentId` adds direct ancestry.
- `childSessionId` becomes `executorSessionId` because the session executes this assignment at any depth.

Depth is derived by following parent links and is not persisted.

### Session binding

```ts
type SessionBinding = {
  ownerSessionId: string;
  assignmentId: string;
};
```

The binding does not duplicate ancestry. The durable assignment tree is authoritative.

### Concrete example

```json
{
  "version": 4,
  "sessionId": "owner-session",
  "hardDeadline": 2000000,
  "wrapUpAt": 1900000,
  "expiryPolicy": "block-new",
  "assignments": [
    {
      "id": "implement",
      "ownerSessionId": "owner-session",
      "rootPlanItemId": "feature",
      "objective": "Implement the feature",
      "scope": ["src"],
      "acceptance": ["The feature works end to end"],
      "budgetMs": 1200000,
      "issuedAt": 500000,
      "hardDeadline": 1700000,
      "wrapUpAt": 1640000,
      "status": "active",
      "executorSessionId": "child-session"
    },
    {
      "id": "inspect-api",
      "ownerSessionId": "owner-session",
      "rootPlanItemId": "feature",
      "parentAssignmentId": "implement",
      "objective": "Inspect the API edge case",
      "scope": ["src/api"],
      "acceptance": ["Return one reproducible conclusion"],
      "budgetMs": 300000,
      "issuedAt": 600000,
      "hardDeadline": 900000,
      "wrapUpAt": 840000,
      "status": "active",
      "executorSessionId": "grandchild-session"
    }
  ]
}
```

Unrelated session-state fields are omitted from the example.

### Assignment lifecycle

```text
active, unbound
  -> task lifecycle started -> active, bound
  -> terminal report -> complete | partial | blocked | expired

active, bound
  -> OMP lifecycle ends without report -> blocked | expired fallback report
```

Terminal states do not return to active.

### Tree invariants

- Assignment identifiers and executor session identifiers are unique within the owner state.
- A root assignment has no `parentAssignmentId`.
- A nested assignment names an existing assignment in the same owner state.
- Parent links are acyclic and end at a root assignment.
- A nested assignment inherits its parent's `rootPlanItemId`.
- A root assignment's `rootPlanItemId` exists in the owner plan when that plan is nonempty.
- `issuedAt` is not earlier than the owner contract or parent assignment.
- `hardDeadline` does not exceed the owner or parent deadline.
- `wrapUpAt` does not exceed the owner or parent wrap-up boundary or the assignment deadline.
- A complete or partial assignment has no active descendants; a blocked or expired assignment can retain active descendants only for already-admitted work and terminal reporting.
- Every report names an assignment and agrees with its terminal status and measured elapsed time.

## Implementation map

This section identifies expected changes; it does not authorize implementation.

### `types.ts`

- Replace the version 4 assignment fields with the approved version 5 shape.
- Add parent information to elapsed context and status where useful.

### `controller.ts`

- Accept the caller's assignment scope when creating an assignment.
- Add parent, ancestor, descendant, and direct-child queries.
- Calculate effective boundaries from the direct parent.
- Select an unbound assignment within one direct parent scope.
- Calculate effective phase from the ancestry chain.
- Reject complete or partial reports with active descendants.
- Select subtree actions for ancestor expiry.

### `store.ts`

- Require version 5.
- Validate ancestry, acyclicity, inherited plan relations, and inherited time boundaries.
- Continue to reject the newest malformed state without falling back.

### `host.ts`

- Allow `wallclock_assign` from an assignment scope.
- Remove the blanket nested-delegation block.
- Resolve delegation among the caller's direct child assignments.
- Allow scoped status only for self and descendants.
- Correlate lifecycle events by direct execution session and parent tool-call identifier.
- Block parent completion according to descendant state.
- Apply ancestor expiry to subtree actions.

### `omp.ts`

No structural change is expected. Its global event-bus and session-file registries should support any depth. Native tests must prove that expectation.

### `mcp.ts`

- Expose the approved version 4 assignment field names.
- Preserve the rule that standalone MCP cannot activate or enforce Wall Clock.

## Verification plan

### Gate 0: characterize current OMP background behavior

Before changing state, run the existing one-level child flow with OMP's default `async.enabled: true`:

- assignment binds after the parent `task` call returns;
- child context adopts the correct owner state;
- child report persists after background completion;
- deadline blocks late child work;
- `abort-running` aborts a child action;
- lifecycle cleanup removes only the completed binding.

If this gate fails, fix or explicitly exclude background tasks before adding recursion. Do not treat synchronous tests as proof of normal OMP behavior.

### Controller and state tests

- Root, child, and grandchild deadlines and wrap-up boundaries are correctly capped.
- An ancestor wrap-up or expiry controls descendant admission.
- Assignment selection is isolated to one direct parent.
- Cycles, missing parents, mismatched plan roots, and expanded deadlines fail validation.
- Version 4 restore fails closed.
- Complete and partial reports fail while descendants remain active.
- Expired and lifecycle fallback reports preserve late descendant reporting.

### Shared host tests

- A child creates a nested assignment and binds a grandchild on a separate event bus.
- Equal raw tool-call identifiers in separate execution sessions do not cross-bind.
- A child can inspect descendants but not ancestors or siblings.
- An ancestor expiry blocks a grandchild action.
- One ancestor expiry aborts actions in multiple descendant abort domains exactly once.
- Parent and descendant terminal lifecycle events clean only their own bindings.

### Native OMP tests

- A real OMP child creates a real grandchild under `block-new`.
- The grandchild receives measured nested context and blocks late work.
- A grandchild reports, yields, and lets its parent report and yield.
- A real running grandchild bash action is aborted at its own deadline.
- A real running grandchild action is aborted at an ancestor deadline.
- The same cases run with OMP background tasks enabled where the selected agent type permits them.
- Reload or revival preserves the tree and recomputes effective phases.

## Acceptance criteria

The feature is complete only when all of these statements are directly proven:

- An OMP child can create a smaller enforced limit for its own child.
- No assignment deadline or wrap-up boundary exceeds an ancestor boundary.
- No execution session can bind to or inspect a sibling assignment.
- Ancestor expiry blocks descendant work before execution.
- `abort-running` reaches each supported descendant abort domain without duplicate or collateral aborts.
- Descendant reports persist to the owner state in correct tree positions.
- Parent completion cannot hide active descendant work.
- OMP's normal background-task mode is either fully tested and supported or explicitly rejected before nested delegation starts.
- Unsupported lifecycle or correlation paths fail closed.

## Recommendation

Proceed only after the data shape sign-off and Gate 0.

If Gate 0 passes, this is a contained medium-complexity feature. Most host plumbing can be reused, and the implementation risk is concentrated in tree invariants and tests. If Gate 0 fails, background task ownership becomes a separate prerequisite and the total work becomes materially more complex.
