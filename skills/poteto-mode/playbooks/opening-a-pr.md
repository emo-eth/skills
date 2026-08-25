### Opening a PR

Run only when the user asked to ship, push, or create a PR.

**Worktree.** Preserve the user's current work. OMP task agents share the parent checkout unless explicitly isolated through a supported agent API. Give concurrent writers disjoint file ownership. Create separate worktrees before fan-out when branches must diverge. Never reset, stash, or discard unrelated work.

**Commits.** Commit liberally; rebase into small, ordered commits before opening PRs. Each commit is a future PR: landable, ordered to tell the story. Amend when the fix belongs in a just-made commit; new commit when separable.

**PRs.** Run `/no-comments` before review. Write the title, description, and commit body through `/technical-writing`, then `/unslop`. Apply every technical-writing layer except Diataxis.

**Titles.** Use Conventional Commits in the form `type(scope): subject`. Use `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, or `perf` as the type. Use the changed area, such as `pstack` or `poteto-mode`, as the scope. Keep the subject short and imperative. Apply the same `/technical-writing` and `/unslop` pass as the body. Name a real symbol when one carries the change. For example, `fix(pstack): retarget opening-a-pr babysit trigger`. Do not add a trailing period.

**Descriptions.** Use these sections in order. Drop a section when it is empty.

- `## Why`. State the intent and why this approach fits.
- `## Scope`. State facts from the diff. Name real symbols and paths. Name both sides of a rename or retarget. State what is in and out when the boundary matters.
- `## Tradeoffs`. State real choices only. Skip this section when there are none.
- `## Blast Radius`. State who and what the change touches. Explain why the change is safe or risky. If main is red without the fix, name the continuing cost.
- `## Verification`. State the exact command or real-surface action and its outcome. Name OMP `browser`, the actual CLI/TUI run, debugger evidence, or focused tests as applicable.

After these sections, attach videos or screenshots when they prove a claim. Do not use `## Summary` or `## Test plan` boilerplate. A commit body does not restate its subject.

**Size and stacks.** Prefer five narrow PRs to one large PR. Stack follow-ups with Graphite (`gt`), and keep the ordered stack visible to reviewers. Branch from main only for independent work. Rebase on `main` before substantial stack work.

**Readiness.** Open every PR ready unless the user asked for a draft. Use `gh pr ready <number>` when needed. Read the PR state before reporting it.

**Babysit.** Opening a PR does not start a babysit. Post the URL and keep building. Finish the phase or stack first. Run a separate babysit pass only when the user asks for one after the whole stack exists. A babysit for each new PR stalls the build and spends checks on commits that later waves restart. Push back when feedback drifts from intent.

A delegated PR owner runs `interrogate` when contested and `/no-comments` before review. It returns the URL and does not babysit unless that was part of the user's request.
