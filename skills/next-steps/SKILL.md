---
name: next-steps
description: "Give a concise human handoff for a task in progress or blocked. Use when the user asks what is going on, what is needed from them, what to do next, how to unblock work, or how to get it finished; also use before handing control back when a user action, decision, access, approval, or test is required."
argument-hint: "[optional task or context]"
---

# Next Steps

Use this skill to turn the current task into a short, executable handoff for the person who must move the work. State what is happening, what the agent needs from the user, the exact user actions in order, and the observable finish line. This is a handoff, not a replacement for work the agent can do.

## Operating rules

- Inspect the available conversation, files, tool output, and external records before asking the user for information. Use a source the agent can reach instead of turning that lookup into a user task.
- Separate verified facts, work in progress, missing information, and blockers. Say `not verified` when evidence is missing. Do not turn an assumption into a status.
- State the smallest user action that unblocks progress. It may be a decision, a value, access, approval, command, test, or other action. If no user action is needed, say `Nothing from you right now` and keep working instead of manufacturing a checklist.
- Give one action per numbered step. Each step names the place, command, value, or decision involved and the result the user should expect. Keep dependencies in order.
- If the user must choose, list the actual options as `A`, `B`, and so on, then add `Recommendation: [choice]` and state the consequence of each option. Do not ask an open-ended question when a bounded choice is enough.
- Put the decision, options, and recommendation under `What I need from you`; put only actions that happen after that decision in the numbered steps.
- Do not ask the user to do work the agent can do with available tools. Do not expose secret values; name the required variable, account, or location without printing the secret.
- Keep the default handoff to one screen: about 120 words and no more than five user steps. Add detail only when a missing dependency requires it.
- End with a concrete finish line: the observable result that proves the task is ready, complete, or unblocked. If the evidence is not known, name the exact check still required. If the check is an agent action, say `I will verify ...`; if it is a user action, put it under `What I need from you` and in the numbered steps. Do not call the task complete before the check.
- Use plain language. Replace vague requests such as `check it`, `look into this`, or `let me know` with a specific action and expected result.

## Procedure

### 1. Establish the current state

Read enough current evidence to name the goal, the present stage, what is already done, and the first thing that prevents the next stage. Completion: the handoff can state the current stage and cite the evidence behind it.

### 2. Find the user dependency

Try the available agent actions first. If the agent can remove the blocker, do that before handing control back. If the user explicitly asked for this handoff, report that action and its evidence; otherwise continue without a user checklist. If the agent cannot remove the blocker, identify the smallest user action that changes the state. Completion: there is one explicit user dependency, or the handoff says that none exists.

### 3. Build the route

Start at the current state and order only the actions required to reach the finish line. For each user step, include the exact place or input, the expected result, and any dependency on an earlier step. Completion: every step changes the work toward the finish line and the last step has observable proof.

### 4. Render the handoff

Use this shape and keep it short:

```text
## What is going on
[One to three sentences: goal, current state, evidence, and blocker if any.]

## What I need from you
[One exact request, or: Nothing from you right now.]

## To get it moving
1. [Action, place or input, and expected result.]
2. [Next action, place or input, and expected result.]

## Finish line
[Observable result. State what the agent will do after the user's last step.]
```

Use `## To get it moving` when the agent will continue the work after the user acts: the requested work has not started, or the agent is blocked mid-task and will resume. Use `## To finish` when the agent has completed its part and the user must complete the remaining steps without the agent. For a complete task with one remaining external action, keep `What is going on`, `What I need from you`, and `## Finish line`; use `## Remaining external action` for the one required action and show the completion evidence. If no external action remains, omit the user-action sections. Include only sections that carry information; never pad an unblocked or complete task.
