### Worktree and simulator cleanup

**You own the disk and the safety gate.** Prune merged or abandoned git worktrees and stale iOS simulators to reclaim space. Deletion is irreversible, so every step guards against deleting something in use or holding uncommitted work.

1. Snapshot and audit. Record `df -h /`, then run `skill://poteto-mode/scripts/worktree-audit.sh`. It reads `git worktree list`, including OMP or Herdr worktrees outside the repo, and classifies size, age, merge state, uncommitted work, PR state, and recent OMP sessions.
2. Treat buckets as advice. Cross-check `hub jobs`, `hub list`, current branches, and relevant OMP sessions through `agent-conv`. Active work always wins over a `safe` label.
3. For every `verify-recent-chat` row, launch read-only `scout` tasks in one batch to identify active sessions and touched worktrees.
4. Pause on every possible data loss. Tracked edits, untracked files, in-use worktrees, force removal, and cache deletion require an explicit user choice after showing exact paths and diffs.
5. Remove only the approved set with `git worktree remove <path>`. Use `--force` or `rm -rf` only after separate explicit approval for that path. Then run `git worktree prune`, re-list, and record `df -h /`.
6. Treat simulators and caches as a separate gate. Inventory Xcode simulators, DerivedData, DeviceSupport, and package caches. Delete only the exact categories the user selects. OMP session history is evidence, not a cache; do not delete it in this playbook.

This is the one playbook that deletes user state with no code review to catch a slip, so the gates above are the review.

**Reply:** `df -h /` before and after with space reclaimed, the worktrees pruned, and a one-line reason for each held back (in-use by which chat, or uncommitted work).
