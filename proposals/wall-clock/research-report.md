# Wall Clock Plugin Research Report

## Glossary

- **OMP**: Oh My Pi, a fork of Pi that supports extensions.
- **Pi**: The Pi coding-agent runtime with TypeScript extensions.
- **Extension**: Code loaded inside a host runtime that can observe events and register commands or tools.
- **Session**: One agent conversation with its own runtime state and persisted history.
- **Assignment**: A bounded subset of a parent plan given to a child session.
- **Host enforcement**: A runtime mechanism that blocks or stops work.
- **Model guidance**: Context or instructions that the model may follow but the host does not enforce.

## Scope

This report answers whether an in-process extension can control plan-driven work with deadlines, assignments, child reports, and time contraction. It does not treat a prompt, skill, wrapper, or separate supervisor as enforcement.

The API facts below were checked against primary documentation and source on 2026-08-05. OMP and Pi are active projects. Pin and test the host versions used for a release.

## Conclusion

An in-process extension can enforce a useful first version:

- activate a deadline for one session;
- persist and restore deadline state;
- inject remaining time before model turns;
- block new tool calls after hard expiry;
- block selected risky work during wrap-up;
- record assignments, progress, shortcuts, skipped validation, and reports;
- observe OMP child lifecycle events;
- abort a child only where the host exposes an abortable child session or task executor.

It cannot universally stop arbitrary in-flight work or make a model finish early from instructions alone. The enforceable seam is the host's pre-tool event and, where available, the host's abort signal. A remote action can continue after the local deadline unless its executor accepts and obeys cancellation.

## Capability matrix

| Capability | Pi | OMP | Enforcement result |
|---|---|---|---|
| Load an extension without changing inactive sessions | Yes: default extension factory and session events | Yes: extension API and session events | Load globally; keep state inactive until activation |
| Activate one session | Yes: `registerCommand`, session-owned state | Yes: command and session-owned state | Enforce only for sessions with active state |
| Inject time before a model turn | Yes: `before_agent_start`; `context` can modify context | Yes: matching extension event surface | Guidance and status; does not stop a turn by itself |
| Block a tool before execution | Yes: `tool_call` returns `{ block: true, reason }` | Yes: extension tool-call interception | Strong pre-action enforcement |
| Observe tool completion | Yes: `tool_result`, `tool_execution_*` | Yes: tool lifecycle events | Record evidence and update state |
| Persist session state | Yes: `sessionManager`, `appendEntry`, session lifecycle | Yes: session lifecycle and extension state mechanisms | Restore when the host restores the session |
| Built-in child-task lifecycle | No built-in task extension API | Yes, through `omp.events.on(...)` with `task:subagent:event`, `task:subagent:progress`, and `task:subagent:lifecycle` | OMP can observe native children directly; progress payloads do not carry the child identifier |
| Create child sessions from extension code | Public SDK exposes `createAgentSession()`; not a simple extension task API | Native `task` tool creates child sessions; no direct `ExtensionAPI.spawnTask()` | Use an adapter; do not assume universal child creation |
| Set a different hard budget per native child | Not available as a native child-task setting | `task.maxRuntimeMs` is not a public per-call task input; the internal executor has a private override | Plugin can gate new work; per-child hard stop needs a supported host seam |
| Abort in-flight child work | SDK `AgentSession.abort()` for an owned session | Hard abort disposes the child; soft budget stops can leave a non-isolated child resumable; custom work depends on its signal | Only claim cancellation for an abort-aware executor |
| Stop arbitrary remote work | No | No | Report as unknown or still running |

## Pi facts

The official [Pi extension documentation](https://pi.dev/docs/latest/extensions) states:

- an extension exports a default factory receiving `ExtensionAPI`;
- `pi.registerCommand(name, { description, handler })` registers a command;
- `session_start` fires on startup, reload, new, resume, or fork;
- `session_shutdown` fires before the runtime is torn down;
- `before_agent_start` can inject a message or modify the system prompt;
- `context` can modify the messages sent to the model;
- `tool_call` runs before tool execution and can block with `{ block: true, reason }`;
- `tool_result` runs after execution and can modify the result;
- built-in tool execution receives an abort signal through the host executor;
- `ctx.sessionManager` exposes persisted session entries and the session file.

The [Pi SDK documentation](https://pi.dev/docs/latest/sdk) exposes `createAgentSession()` and an `AgentSession` with `abort()`. That is enough to build a child-session adapter, but it is not the same as a native extension-level task API.

Important Pi limitation: a `tool_call` handler preflights sibling calls sequentially, but sibling tools can execute concurrently after preflight. A gate can prevent a new call; it cannot retroactively undo a sibling call already admitted.

## OMP facts

The official [OMP task documentation](https://github.com/can1357/oh-my-pi/blob/main/docs/tools/task.md) and task source identify:

- `TaskParams`, `TaskItem`, `AgentDefinition`, and structured subagent output types;
- the native `task` tool for one child or a `tasks[]` batch;
- child execution in `packages/coding-agent/src/task/executor.ts`;
- `task.maxRuntimeMs` as a host-level maximum runtime setting;
- child lifecycle states including started, completed, failed, and aborted;
- event-bus channels `task:subagent:event`, `task:subagent:progress`, and `task:subagent:lifecycle`; lifecycle and raw-event payloads carry a stable child identifier, while progress payloads do not;
- abort behavior that disposes a hard-aborted child session;
- persisted child output and history artifacts.

OMP does not expose a direct `ExtensionAPI.spawnTask()` method in the public extension surface. A plugin can observe the native task path and keep assignment metadata, but exact per-call budget injection requires either a supported host setting or an adapter around the task executor. The plugin must not pretend that a generic extension event changes the native task's maximum runtime.

Primary OMP sources:

- [Extension authoring](https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-extensions.md)
- [Task tool](https://github.com/can1357/oh-my-pi/blob/main/docs/tools/task.md)
- [Task types](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/task/types.ts)
- [Task executor](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/task/executor.ts)
- [Settings](https://github.com/can1357/oh-my-pi/blob/main/docs/settings.md)

## Event-to-behavior map

| Event or command | Behavior |
|---|---|
| `session_start` | Restore the session's deadline, plan, assignments, and reports. For OMP, also handle `session_switch`, `session_branch`, and `session_tree` as applicable. Re-arm only the in-memory status timer. |
| `/wallclock start 30m` or `/wallclock start 5pm` | Parse local time, activate the current session, and persist an activation entry. |
| Main-agent assignment tool | Create an assignment with scope, acceptance target, budget, wrap-up, and report contract. |
| `before_agent_start` / `context` | Inject current phase, remaining time, assignment, and required report fields. |
| `tool_call` | Classify the proposed action and block it when expired, when it cannot fit, or when wrap-up disallows it. |
| `tool_result` | Record completion, failure, evidence, and elapsed time. |
| OMP subagent lifecycle events | Attach child status and reports to the parent assignment when the event supplies a stable child identifier. |
| Pi `agent_settled` / OMP main-session `agent_end` | Ask the main agent to report; do not treat a model response as proof of completed work. For OMP child completion, use the lifecycle channel because `session_stop` is main-session-only. |
| `session_shutdown` | Persist state and clear process-local timers. |

## Assignment and report contract

The first implementation uses this internal shape. It is deliberately small and version-neutral:

```ts
type Assignment = {
  id: string;
  parentSessionId: string;
  parentPlanItemId: string;
  objective: string;
  scope: string[];
  acceptance: string[];
  issuedAt: number;
  hardDeadline: number;
  wrapUpAt: number;
  childSessionId?: string;
  status: "pending" | "active" | "complete" | "partial" | "blocked" | "expired";
};

type ChildReport = {
  assignmentId: string;
  status: "complete" | "partial" | "blocked" | "expired";
  completed: string[];
  evidence: string[];
  partial: string[];
  skipped: string[];
  validation: string[];
  shortcuts: Array<{ choice: string; tradeoff: string }>;
  risks: string[];
  unknowns: string[];
  recommendedParentAction: string;
};
```

The budget is a ceiling. The child should complete as soon as its acceptance target is met. If it compresses work, the resulting work must remain working even if incomplete.

## Enforcement table

| Promise | Host mechanism | Failure mode | Evidence required |
|---|---|---|---|
| No new work after hard expiry | Pre-tool gate | Already-admitted or remote work continues | Unit test plus host event test |
| No risky new work during wrap-up | Pre-tool gate with action classification | Tool is misclassified or host bypasses extension | Classification tests and a host integration test |
| Remaining time is visible to the model | Context injection | Model ignores or misreads it | Context snapshot test; not enforcement |
| Child finishes early | Explicit completion/report operation | Model continues because no host stop path exists | Host-supported completion/abort test; otherwise label guidance |
| Child budget stops child | Host task budget or abort signal | Child executor ignores signal | Host executor test; never infer from timer alone |
| Remote action stops | Remote API cancellation | Provider ignores or lacks cancellation | Provider-specific evidence; otherwise report unknown |
| Inactive sessions are unchanged | Session-keyed state and conditional handlers | State accidentally shared globally | Two-session isolation test |

## Smallest viable plugin

1. A pure `WallClockController` with no host imports.
2. A Pi adapter for commands, session restore, context injection, tool gating, and tool results.
3. An OMP adapter with the same common behavior plus child lifecycle observation.
4. A small set of runtime tools or commands for start, status, assignment, completion, and report.
5. JSON session entries as the durable state format; timers are disposable process state.

Do not add native child spawning, arbitrary cancellation, or remote cancellation until a host-specific test proves the mechanism.

## Tests

- inactive session does not alter prompts or tools;
- two sessions keep independent deadlines;
- local-time and duration activation parse correctly;
- state restores after a simulated reload;
- wrap-up blocks delegation and destructive actions;
- hard expiry blocks new tools;
- a short assignment can complete early without extra work;
- a partial assignment reports working output and skipped validation;
- child reports revise the parent's remaining plan;
- OMP child lifecycle events attach to the correct assignment;
- an already-running action is not falsely reported as cancelled;
- concurrent sibling tool calls are treated as admitted once their preflight passes.

## Open decisions

- Which OMP and Pi versions are supported by the first release?
- Which host-specific event provides a stable child-session identifier?
- Does the first release expose child assignment as a model-callable tool, a user command, or both?
- Which actions are allowed during wrap-up?
- What persistence entry type is safe across host reload and compaction?
- Which host can prove per-child hard cancellation, rather than only parent-side gating?
