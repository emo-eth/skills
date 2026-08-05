# Wall Clock Plugin Design

## Glossary

- **Module**: A unit with a small interface and a hidden implementation.
- **Interface**: Everything a caller must know to use a module correctly, including state, ordering, and failure behavior.
- **Adapter**: Host-specific code that satisfies the common interface at a seam.
- **Seam**: The place where an interface lets us change an implementation without changing its callers.
- **WallClockController**: The common module that owns time contracts, plan assignments, reports, and tool decisions.
- **Time contract**: A start time, hard deadline, wrap-up time, and current phase.
- **Action class**: The risk category used by the pre-tool gate: read, write, destructive, delegate, or finalize.

## Design rule

The common module is the deep module. Its interface is small: activate, assign, status, decide, record, complete, and report. Pi and OMP adapters translate host events into those operations. They do not duplicate deadline logic.

The implementation is intentionally not a skill. A skill can describe behavior, but it cannot enforce a pre-tool gate or child abort. The plugin remains inert until a session is activated.

## State

State is keyed by session identifier. Each session has:

- optional main-session time contract;
- plan items;
- assignments;
- child reports;
- action records;
- a revision number.

Timers are not durable state. On reload or resume, the adapter restores the durable state and computes phase from the current clock.

## Time phases

```text
inactive -> active -> wrap-up -> expired
             |          |
             +----------+-> complete
```

- `active`: all actions may be admitted if they fit the remaining time.
- `wrap-up`: no new delegation or destructive action; finish current acceptance work and report.
- `expired`: no new tool call is admitted.
- `complete`: assignment has met its acceptance target; the plugin blocks further assignment work.

## Tool decision

The pre-tool gate receives:

```ts
decide(sessionId, {
  action: "read" | "write" | "destructive" | "delegate" | "finalize",
  estimatedMs?: number,
  assignmentId?: string,
}): { allow: boolean; reason?: string; phase: Phase; remainingMs: number }
```

The controller blocks when:

- the session is inactive for an assignment that requires activation;
- the session or assignment is expired;
- the assignment is complete;
- the action is disallowed during wrap-up;
- an estimated duration cannot fit before the hard deadline.

The controller does not claim to cancel an action already admitted. The host adapter may pass an abort signal to an executor when the host supports it.

## Parent and child flow

1. The user activates the main session.
2. The main agent creates an assignment with an objective, acceptance target, and maximum budget.
3. The controller caps the child deadline at the earlier of the assignment deadline and the parent deadline.
4. The adapter injects the assignment and remaining time into the child context where the host supports child context injection.
5. The child reports completion as soon as the acceptance target is met.
6. The parent receives a structured report and revises the remaining plan.
7. The controller records shortcuts, skipped validation, risks, and unknowns.

If a host cannot provide a child hook or abort signal, the controller records the assignment and gates work only in sessions where the plugin is active. It must mark child timing as guidance rather than enforcement.

## Persistence

The first version stores state as a versioned JSON entry through the host session store. It must include the session identifier and a revision. Restore uses the latest valid entry. A malformed entry disables wall-clock control for that session and reports the error; it must not affect unrelated sessions.

## Adapters

### Pi

The Pi adapter registers:

- `/wallclock start`, `/wallclock status`, `/wallclock stop`;
- `wallclock_assign`, `wallclock_complete`, and `wallclock_report` tools;
- `session_start` and `session_shutdown` handlers;
- `before_agent_start` or `context` injection;
- `tool_call` gating;
- `tool_result` recording.

Pi has no native extension task API. The adapter must not imply that a recorded assignment automatically becomes a hard-bounded native child. A later SDK adapter can own a child `AgentSession` and use `abort()` when it owns the executor.

### OMP

The OMP adapter registers the same common commands and tools, plus listeners for:

- `task:subagent:event`;
- `task:subagent:progress`;
- `task:subagent:lifecycle`.

It associates events only when the event contains a stable child identifier. It observes native task outcomes and records them; it does not rewrite `task.maxRuntimeMs` unless the host exposes a supported runtime setting for that call.

## Distribution

The experimental package is in `plugins/wall-clock/`. It is not in `skills/`, so `npx skills add` and `npx skills update` do not discover it. When the plugin is ready, publish or install its OMP and Pi entry points through their native extension mechanisms. Do not move it into `skills/` as a way to distribute runtime code.
