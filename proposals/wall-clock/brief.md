# Wall Clock Plan and Subagent Plugin: Research Brief

## Glossary

- **Wall clock**: Real elapsed time measured against a deadline or a duration window.
- **OMP**: Oh My Pi, a fork of Pi that supports extensions.
- **Pi**: The Pi coding-agent runtime that supports TypeScript extensions.
- **Session**: One agent conversation with its own persisted history and runtime state.
- **Main session**: The session that owns the overall plan and may create child assignments.
- **Plan**: The ordered set of outcomes that the parent session wants to achieve.
- **Task**: One bounded unit of work in the plan.
- **Assignment**: A task subset given to one subagent or child session.
- **Subagent**: A child agent session that works on an assignment for a parent session.
- **Budget**: The maximum time available to a session or assignment. It is a ceiling, not a target.
- **Wrap-up**: The point where the agent stops starting new work and prepares a result.
- **Compression**: Reducing scope, validation, or output so the remaining work fits the budget.
- **Shortcut**: A deliberate reduction in scope or method, with its tradeoff recorded.
- **Final state**: A report of completed, partial, skipped, blocked, and uncertain work.

## Purpose

Research whether one in-process plugin for OMP and Pi can provide wall-clock control for plan-driven, subagent-heavy work.

The user wants to give a parent session a local-time deadline such as 5:00pm or a duration such as 30 minutes. The parent session has a plan. It assigns subsets of that plan to subagents. Each subagent receives its own assignment and time budget, tries to complete it, and reports back.

As time decreases, the parent and subagents should reduce scope and update their plans to fit the remaining time. They should report shortcuts, skipped validation, changed assumptions, and other tradeoffs. Any compressed result should remain working even when it is incomplete.

The intended implementation is an in-process OMP or Pi plugin.

## Required behavior

1. The plugin is installed but inactive by default.
2. A user activates wall-clock control for the main session, and the main-session agent can enable bounded control for its child assignments.
3. The plugin stores the deadline and plan state with that session.
4. The parent plan can contain assignments for child sessions.
5. Each assignment has a scope, acceptance target, budget, and reporting contract.
6. The child session receives its assignment and remaining budget as runtime context and instructions. The budget tells the child when it must stop; it must not encourage the child to use time that the work does not need.
7. Before tool calls, the plugin can check the assignment state and block work that no longer fits the budget.
8. During the assignment, the child can record progress, scope reductions, shortcuts, and risks.
9. The child reports a structured result to the parent session.
10. The parent can revise its remaining plan based on child reports.
11. The plugin preserves state through reload, resume, compaction, and restart where the host allows it.
12. A session that is not explicitly activated is unchanged.
13. A child that finishes its acceptance target early can finish early and return control to the parent; the plugin must not turn unused budget into extra work.

## Time behavior to investigate

The design must distinguish:

- the parent session deadline;
- an assignment budget;
- the child session's remaining time;
- the wrap-up point;
- the hard expiry point.

The research must determine whether a child budget is a fixed slice, a maximum based on the parent's remaining time, or a value that the parent can reallocate.

It must also determine what happens when:

- the child finishes early;
- the child needs more time;
- the parent changes the plan;
- the parent session is idle at expiry;
- a child tool call is still running at expiry;
- the child is forked, resumed, compacted, or restarted;
- a remote action cannot be cancelled.

The research must also determine how early completion and time contraction are enforced. It must identify the exact host boundary that can stop or block new work, and must state when the result is only model guidance because no host boundary can enforce it. A timer or injected instruction is not proof that a child will stop.

Every claim that a child will finish early must name its mechanism, such as an acceptance-target completion signal, a parent-mediated stop, a pre-tool gate, or executor cancellation. If no such mechanism exists, the report must classify early completion as model guidance only.

## Plan and report behavior to investigate

The research should determine whether the plugin can maintain a plan as durable runtime state or only inject instructions and messages.

Each assignment should be able to communicate at least:

- assignment identifier;
- parent plan item;
- allowed scope;
- acceptance target;
- time budget and wrap-up point;
- current status;
- completed work and evidence;
- shortcuts and their tradeoffs;
- skipped work and validation;
- risks and unknowns;
- recommended change to the parent plan.

The research must separate:

- facts the plugin can enforce;
- instructions the model may follow;
- facts the parent can infer from child reports;
- claims that remain impossible without host support.

## OMP and Pi research questions

Research the current primary documentation and source for both runtimes.

### Session and activation

- What is the stable identity of one session?
- Can a plugin register a user command that activates a deadline for only the current session?
- Can the plugin remain loaded globally while remaining inert for sessions without an active budget?
- Can the plugin persist activation state in the session history or another session-owned store?

### Plan and subagent control

- Can a plugin observe, create, or modify a plan or task list?
- Can it observe child-agent creation and completion?
- Can it pass an assignment and budget into a child session without relying only on model instructions?
- Can it receive a structured child report and attach it to the parent plan?
- Can a child inherit a parent deadline or assignment subset?
- Can the parent revise or cancel a child assignment?
- Can the main-session agent enable, change, or end wall-clock control for a child assignment without changing unrelated sessions?

### Time context

- Where can the plugin inject current elapsed and remaining time before every model request?
- Can it update a visible status display without adding noisy model context?
- Can it schedule a deadline callback while the session is idle?
- Can it restore the deadline after reload, resume, compaction, and restart?

### Action enforcement

- Can the plugin block a tool before execution?
- Can it distinguish reads, writes, destructive actions, delegation, and finalization?
- Can it observe tool completion, failure, and cancellation?
- Can it stop an in-flight built-in tool?
- Can it stop a custom tool, child session, background job, or remote action?
- What happens when multiple tools run in parallel?
- What mechanism, if any, makes a child finish as soon as its acceptance target is met instead of continuing until its budget expires?

### Distribution

- What package manifest and installation command does each runtime use?
- Can one package expose shared code with separate OMP and Pi entry points?
- What version matrix must be tested?
- What trust and permission prompts apply to global and project-local installation?
- How can a user run one temporary activation without changing global behavior?

## Research output required

Return a research report with:

1. A capability matrix for OMP and Pi.
2. Primary-source links and exact API names for every capability claim.
3. A proposed event-to-behavior map for the parent session and child sessions.
4. A proposed assignment and child-report contract.
5. A clear separation between enforceable behavior and model guidance.
6. The smallest viable plugin design.
7. Tests that prove session isolation, deadline restoration, plan revision, subagent budgeting, time contraction, shortcut reporting, and tool gating.
8. A complete list of unresolved decisions requiring human sign-off.
9. An enforcement table for each promised behavior, naming the host mechanism, the failure mode, and the evidence that the mechanism works.

Do not implement code yet. Do not treat a prompt or skill as enforcement. Do not claim that a plugin can cancel a running action unless the host API and the specific action executor prove it.
