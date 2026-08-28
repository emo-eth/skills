### Autopilot full

**You own the queue through merge.** Use only when the user explicitly asks for full autopilot or authorizes every named PR to merge.

1. **Hold operator-owned items.** Items the user reserves stay out of agent writes and merges. A request to state the protocol is not permission to start. On explicit go, create one OMP `todo` item per queue entry and one root-verification item per PR.
2. **Prepare one owner worktree per PR.** Give each owner a complete brief and disjoint branch. Launch all independent owners in one OMP `task` batch. Each owner builds, proves the real surface, triages Bugbot, runs `/no-comments`, restacks on current trunk, drives Babysit to green, and reports the exact merge-ready head SHA.
3. **Keep topology separate.** Independent PRs branch from trunk. Dependent work merges before its child starts. One writer owns each branch. The root owns any shared stack topology.
4. **Swarm-verify every merge-ready head.** Use the **swarm** skill. At the reported SHA, independent verifiers rerun focused gates, exercise the real surface with OMP tools, and audit the diff and receipts. The root returns one `PASS`, `PASS+NOTES`, or `FAIL` verdict pinned to that SHA.
5. **Merge only a clean, current head.** The owner restacks on current trunk before verification. A new head invalidates the verdict unless `git patch-id` proves the patch is unchanged. On a clean verdict, the authorized owner squash-merges and takes the next independent queue item.
6. **Run the root watch with OMP.** Use `hub jobs` and `hub inbox` to drain completions. Use an event watcher through `hub start` for CI or merge changes. Use `hub wait` only when no other action remains. Record countersigns for any new pinned gate or budget value only after verifier evidence.
7. **Stand down on stop.** Send a zero-writes message to every live owner with `hub send`. Do not start or merge more work until the user releases the hold.

**Reply:** queue state, each owner and head SHA, each pinned verdict, merged PRs, open user gates, and decision-trail paths.
