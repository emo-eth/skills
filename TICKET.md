# EMO-542: linear-capture: OMP command and plugin for quick issue capture with 7-item spec and optional interview

Linear: [EMO-542](https://linear.app/emo-eth/issue/EMO-542/linear-capture-omp-command-and-plugin-for-quick-issue-capture-with-7)

## What problem are you trying to solve?

Operators working inside terminal sessions frequently identify issues, bugs, and new feature requirements in real time, but capturing them currently requires context-switching into a browser or manually drafting complex Markdown files. There is no fast terminal command or OMP plugin to quickly capture raw issue intent from the prompt, structure it into the canonical 7-question spec, optionally conduct a 2-turn clarifying interview, and push it directly to Linear.

## Why is it important?

Ideas and bug observations are fleeting. Friction in ticket capture causes critical product nuances to be lost or dumped as unstructured notes without deliverables, feel standards, or validation steps. A fast terminal-native capture command keeps the operator in flow while ensuring all captured work arrives pre-specified.

## What does it feel like in use?

An intuitive terminal slash-command `/linear [raw intent]` or interactive capture prompt. The operator types a one-line thought (e.g. `/linear search results feel sluggish when typing fast`). The plugin immediately drafts the 7 canonical questions. If crucial context is ambiguous, it initiates an optional, rapid 1-3 question interactive interview to resolve nuance, presents the formatted spec for instant confirmation, and posts the issue directly to Linear with a clickable HTTPS link.

## Deliverables

* OMP command/plugin in `plugins/linear-capture/` (exposing `pi` and `omp` extensions).
* Interactive interview engine that asks targeted clarifying questions for missing sections.
* Linear API client formatting the canonical 7-question spec with Team EMO and project association.
* Unit and integration test suite (`bun test`).
* Sub-issue (Implementation): [EMO-601: linear-capture: Core plugin implementation and unit tests](https://linear.app/emo-eth/issue/EMO-601/linear-capture-core-plugin-implementation-and-unit-tests)
* Sub-issue (Verification): [EMO-602: linear-capture: Live OMP session smoke verification in Linear](https://linear.app/emo-eth/issue/EMO-602/linear-capture-live-omp-session-smoke-verification-in-linear)

## What does completed look like?

Running the command `/linear` with a raw thought drafts the 7-question specification, optionally probes for missing nuance, confirms with the operator, and immediately outputs a clickable `https://linear.app/emo-eth/issue/...` link with all 7 questions properly populated.

## Validation steps for reviewers

`cd plugins/linear-capture && bun test` passes (all tests pass).
Running `/linear "test issue creation"` creates an issue in Team EMO, verifies all 7 canonical sections are present, and returns the issue URL.

## Environment limits & User Validation needs

Requires valid `LINEAR_API_KEY` or authenticated Linear CLI environment. Live API verification tracked in sub-issue: [EMO-602](https://linear.app/emo-eth/issue/EMO-602/linear-capture-live-omp-session-smoke-verification-in-linear).
