### Autonomous run

**You own the exit condition. Define done, then drive to it without stopping.** For "going to bed", "run until done", or "keep going until X".

1. State the exit condition as a checkable predicate before the first iteration (tests green, repro fixed, all N PRs merged, pixel-diff zero). A vague goal stalls; a predicate lets you stop.
2. Pick an OMP wake mechanism. Use a background `task` for independent work. Use `hub start` for a watcher or process that must survive turns and accept later input. Use `hub wait` only when no other work remains. Prefer event-driven commands such as CI watch or ref watch; use a bounded heartbeat only when no event source exists.
3. Each iteration makes the smallest change the evidence justifies, verifies it against the predicate, commits if it advanced, discards changes that didn't help. Belt-and-suspenders that "might help" gets reverted, not left to ride.
   Sequence the work via the **sequence-verifiable-units** principle skill, verifying each unit before the next instead of batching checks at the end.
4. Mid-run discoveries are yours. Fix broken skills, related bugs, flaky verifiers, review noise, tooling failures, and fixable drift without parking reversible work for the human. Keep unrelated source fixes in separate commits. Use OMP `ask` only for irreversible actions, genuine product or preference calls, or a real dead end. Return to the exit predicate after each side fix.
5. Checkpoint every iteration via the **show-me-your-work** skill, a row for what changed and whether the predicate moved. A run with no trail can't be audited or resumed.
6. Stop when the predicate is met. A plateau is not a stop, so keep going and pivot your approach to push past it. Surface a genuine dead end rather than spinning, and never relax the predicate to declare victory.

**Reply:** the exit condition, iterations run, what landed, what was discarded, final predicate state.
