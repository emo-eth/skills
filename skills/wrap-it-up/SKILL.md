---
name: wrap-it-up
disable-model-invocation: true
description: "Finish the active task from its current state: close every reachable loop, run the proof, and return a complete result or a precise blocker."
argument-hint: "[optional finish constraint]"
---

# Wrap It Up

## Glossary

- **Active task**: The user request currently in progress, including its stated result and constraints.
- **Finish line**: The observable result and focused check that prove the active task is ready.
- **Closure pass**: The final sweep for required edits, affected callers, checks, records, and unresolved work before reporting.
- **Reachable work**: Work the agent can complete with the current instructions, files, tools, and access.
- **Blocker**: A missing decision, permission, credential, external result, or unavailable system that the agent cannot resolve with the available tools.

Use this skill only through an explicit `/wrap-it-up` invocation while a task is already in progress. Resume from the current state. Do not restart the task, switch to a new task, or expand the scope.

On a supported native Pi or OMP host with the wall-clock plugin loaded, this
invocation also activates a two-minute host guard with `abort-running`,
bounded delegation through one wall-clock assignment while the phase is active,
and a 12-call ordinary-tool limit. During wrap-up, new delegation and
destructive work remain blocked. Without that native adapter, these
instructions still guide the agent but cannot force a timeout.

## Core rule

Finish the active task, not only the current substep. Continue until the finish line passes or a real blocker stops reachable progress.

A partial implementation, a compile result, one passing test, a changed-file list, or an agent summary is not completion unless the active task defines it as the finish line.

## Operating rules

1. Follow system, repository, safety, and user instructions first. Required state reads, progress tracking, review safeguards, tests, records, commits, and other project rules remain required.
2. Recover the active task from the latest user request, conversation, current task state, tool output, and relevant files. Use the existing evidence; do not ask the user to restate context.
3. Before acting, form one internal finish line: the requested result, every required acceptance condition, and the smallest check that proves it.
4. Inventory the open loops for that result: unfinished implementation, affected callers, tests, documentation, records, cleanup from this task, and required external actions. Classify each as done, reachable work, or blocker.
5. Do all reachable work in the current scope. Keep working through related required items after an intermediate check passes. Do not stop at the first plausible result.
6. Treat optional improvements, adjacent refactors, new ideas, and speculative validation as out of scope. Do not start them while wrapping up.
7. Preserve human work. Do not reset, clean, stash, overwrite, delete, or replace changes or processes that are not required for the active task.
8. Use the narrowest verification that proves the finish line. If it fails and the cause is reachable, diagnose and fix it. Repeat until it passes or the cause is a real blocker.
9. When a blocker appears, finish all other reachable work first. Name the exact missing input or external action and the exact result it must produce. Do not simulate the missing proof or call the task complete.
10. Do not return a new plan, progress report, or list of optional next steps. Return only the completed result, its proof, and any precise blocker.

## Procedure

### 1. Recover the finish line

Read the current request and enough live evidence to identify:

- the result the user asked for;
- the acceptance conditions and constraints;
- what is already complete;
- what remains unfinished;
- the check that proves readiness.

If the active task cannot be recovered from available evidence, ask one concise question for the missing task boundary. Do not perform unrelated work while waiting.

Completion: the finish line and current state are explicit, evidence-backed, and bounded.

### 2. Close the open loops

Check the current task state, changed files, relevant callers, and latest failures. For every required item:

- keep completed items only when their evidence supports completion;
- perform reachable implementation and integration work;
- update the tests, documentation, state records, or review records required by the repository and task;
- leave optional ideas untouched.

A passing intermediate check does not close an item that still needs integration or proof.

Completion: every required item is done, actively reachable, or an explicit blocker.

### 3. Run the closure pass

Review the resulting work against the finish line. Confirm that the requested behavior is present through its real path, all affected callers are accounted for, and no required task item remains open. Remove temporary scaffolding created during this task when it is no longer needed.

Run the focused check named by the finish line. If it fails, fix reachable causes and run it again. If the check needs an unavailable external system, finish local work and record that boundary instead of claiming success.

Completion: the finish-line check passes, or the remaining failure is an evidenced blocker outside the agent's reach.

### 4. Return the result

Use this compact shape:

```text
Result: [what is complete, or what reachable work is complete]
Proof: [the focused check and observed result]
Blocker: [exact blocker and required input/action, or None]
```

Use `Blocker: None` only when the finish line passed. If a blocker remains, say that the task is not complete. Do not hide unfinished reachable work behind a blocker.
