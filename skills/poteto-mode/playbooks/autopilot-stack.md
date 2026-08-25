### Autopilot stack

**You own the build and verification. The user owns landing.** Use when the user asks for a fully built linear stack but reserves merge control.

1. **Prepare one owner worktree per PR.** Launch independent owners in one OMP `task` batch. Each owner builds, registers its PR, proves the real surface, triages Bugbot, runs `/no-comments`, drives Babysit to green, keeps a `decisions.tsv` trail, and reports `STACK-READY` with the exact head SHA.
2. **Run the root watch with OMP.** Drain `hub jobs` and `hub inbox`. Use `hub start` for event watchers. Re-read this playbook and current queue state after each wake. Do not rely on memory or a fixed sleep loop.
3. **Hold user gates.** Stating a plan is not permission to execute. On explicit go, create OMP `todo` items for each queue entry and verification gate. On stop, broadcast a zero-writes hold to every owner with `hub send`.
4. **Verify at STACK-READY.** Use **swarm** to rerun focused gates at the exact SHA, exercise the real surface with OMP tools, and audit receipts and diff. Return one pinned verdict. Send findings to the owner; nothing enters the stack without a clean verdict.
5. **Append; never ship.** No owner merges, arms auto-merge, or closes a PR. A clean verdict appends the PR to one linear Graphite stack in verified or user-specified order.
6. **Keep one topology writer.** Owners push only their branches and report tips plus intended parents. The root alone runs Graphite topology commands. Re-check remote refs before any force-with-lease update. A new SHA invalidates its verdict unless patch identity is unchanged.
7. **Hand back the stack.** Confirm the parent chain, current SHAs, and verdicts. The user lands it.

**Reply:** stack order, each owner and SHA, pinned verdicts, topology changes, open gates, and decision-trail paths.
