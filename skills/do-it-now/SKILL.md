---
name: do-it-now
disable-model-invocation: true
description: "Execute one small, explicit request in a narrow fast lane. Prefer one bounded delegated assignment when it can finish independent work faster; skip broad research and adjacent cleanup; stop at the first verified result."
argument-hint: "[small, explicit request]"
---

# Do It Now

## Glossary

- **Fast lane**: A short execution mode for one bounded request.
- **Scope lock**: The exact files, actions, and result allowed for this request.
- **Finish line**: The first observable check that proves the requested result is ready.
- **Side effect**: Any change outside the requested result, including an external
  mutation, new document, cleanup, or process lifecycle change.

- **Host guard**: Native plugin enforcement that limits this lane's time, delegation, and tool calls.

On Pi or OMP with the wall-clock plugin enabled, this explicit invocation also
activates a host guard: a 2-minute hard deadline, `abort-running` cancellation
for supported actions, bounded delegation through one wall-clock assignment,
and a 12-call limit for ordinary tools. Without that native plugin, the skill
instructions still narrow model behavior but cannot force a stop.

Use this skill only through an explicit `/do-it-now` invocation. It is for a
small request that should finish in one focused pass. It is not a general
planning, research, review, refactor, or project-management mode.

## Core rule

Do the named thing now. Do not do adjacent things.

Before the first action, form this internal scope lock:

- **Task**: one sentence using the user's words.
- **Allowed**: only the files, commands, and side effects required for that task.
- **Finish line**: one observable result and one focused check.

Do not print a plan or progress report. Start the first necessary action in the
same turn. Return as soon as the finish line passes.

## Operating rules

1. Follow system, repository, safety, and user instructions first. This skill
   does not waive a required state read, record, review safeguard, or safety
   check. Make the smallest required version of that work.
2. Resolve ordinary ambiguity from the current files and tool output. Choose
   the narrowest reversible interpretation. Ask one concise question only when
   the ambiguity changes the result materially or an irreversible action lacks
   explicit authorization.
3. Read only the files needed to complete the scope lock. Do not browse the
   repository, history, web, or unrelated records for context that cannot
   change the result.
4. Prefer one bounded wall-clock assignment for independent work when it can
   finish the request faster or safer. Create the assignment first and give
   the child one objective, narrow scope, observable acceptance target, and a
   budget below measured remaining time. Do not use batch or nested delegation.
   Do not run optional skills, write a plan, create a decision or review
   artifact, update project taste, refactor nearby code, or clean up unrelated
   files.
5. Do not run a full test suite, formatter, linter, audit, or deployment unless
   the requested result requires it. Run one focused check after the change.
6. Preserve existing human work. Do not reset, clean, stash, overwrite, kill,
   or replace a process or review session unless the current request explicitly
   requires that exact action.
7. Treat a side effect as in scope only when the user explicitly requested it
   or it is the direct mechanism for the named result. Do not infer extra
   ticket closures, status changes, file deletions, commits, pushes, or
   deployments from a request to update or summarize something.
8. Do not add retries, validation layers, abstractions, telemetry, or fallback
   behavior that the request did not name.
9. If a required external action is blocked, stop at that boundary. Report the
   exact blocker and the one input or action needed. Do not spend the turn
   exploring alternatives.

## Review-feedback fast path

When the request is to apply submitted feedback and return an updated artifact:

1. Read the current feedback source once. Use the existing stdout file, export,
   or review record instead of reconstructing feedback from history.
2. Apply every explicit requested change to the named artifact. Keep the same
   filename and location when possible.
3. Do not turn the feedback into a second project. Do not add answer documents,
   decision entries, taste entries, dependency modeling, or broad ticket triage
   unless the user asked for those outcomes or a higher-priority rule requires
   them.
4. If the user asks for a new or refreshed review session, perform only the
   lifecycle steps needed to expose the updated artifact. Preserve drafts as
   required, verify the live target and URL, and stop. Do not redesign the
   document or relaunch unrelated sessions.
5. The finish line is the updated artifact plus the requested review URL or
   other direct handoff. A short read, health check, or process/session lookup
   is enough proof.

## Finish and response

Run the smallest check that proves the named result:

- Text or code change: read the changed section or exercise the changed path.
- File output: verify the file exists and contains the requested result.
- Service or review session: verify the live process or URL and the requested
  target.

Then respond with only:

- what changed;
- the direct result, URL, or handoff;
- the focused check performed;
- one blocker, if any.

Do not claim that this skill alone guarantees a wall-clock duration. With the
wall-clock plugin enabled on a supported native host, the host guard enforces
the stated deadline and cancellation policy. The guard cannot infer semantic
scope from arbitrary tool input, so the model instructions remain responsible
for avoiding unrelated reads, writes, and research.

## Example

```text
/do-it-now apply the five submitted annotations to the ticket list and open a
new Plannotator session
```

Expected behavior: read the feedback, update the list, perform only explicitly
requested side effects, verify the requested session, and return its URL.
