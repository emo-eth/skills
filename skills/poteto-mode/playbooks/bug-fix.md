### Bug fix

**You own this task. Plan, review, verify.** Delegate investigation and the fix to subagents, stay in the lead.

Be scientific. Every shipped line traces to runtime evidence. Belt-and-suspenders that "might help" is a hypothesis, not a fix; it does not ship. When evidence refutes a hypothesis, revert what it motivated. The smallest change the evidence justifies ships, nothing more. Same discipline for Perf, where the evidence is the trace.

1. Reproduce it yourself on the matching real surface. Use OMP `browser` for web UI, the actual program and PTY for CLI/TUI, and `debug` or instrumentation for program state. Drive as far as tools allow before asking the user. If direct reproduction fails, synthesize the trigger, tighten conditions, or instrument until it fires. A bug you cannot reproduce cannot be proved fixed.
2. Binary-search the cause. Form candidate hypotheses and take the split that removes the most possibilities. Seed them with `how` over the subsystem and **why** for regression history. Add temporary instrumentation when state is unclear. Use the Autonomous run playbook and OMP `hub` watchers for a stubborn hunt. Confirm the surviving mechanism with runtime evidence before architecture or review fan-out.
3. Plan the fix. If it crosses a function boundary, run `architect`. Delegate the specific implementation only after the cause is proven. Use `bug-fix` from `~/.config/pstack/omp-agents.json`, or omit `agent` by default. Review the diff yourself.
4. Verify on the same surface; the original repro now passes. "Inconclusive" or wrong-surface is not a pass; flag it. Unit tests show branch behavior, not bug absence.
5. Stage the commits so the failing repro lands before the fix in git history; the diff tells the story. See the **pstack-tdd** skill for the failing-test-first cadence when the bug has a cheap local test path; skip it when the test would be expensive, integration-heavy, or unclear.
   This is the canonical **sequence-verifiable-units** principle skill, the failing test first and the fix on top.
6. Run **Opening a PR** only when the user asked for a PR or shipping.

Run `how` and `why` in parallel only when they are independent slices.

**Reply:** what was broken, root cause, fix, how you verified. Paste failing-then-passing repro output verbatim.
