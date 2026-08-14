---
name: omp-plugin-iteration
description: Use when changing an OMP runtime plugin, reinstalling a local OMP plugin, validating a plugin after source changes, or handing the user a restart step. Reinstalls the exact pushed checkout into an OMP profile and keeps live-process claims separate from source verification.
---

# OMP plugin iteration

## Glossary

- **OMP**: Oh My Pi, the host that loads runtime plugins.
- **Runtime plugin**: A package loaded by OMP at process start to add commands, hooks, or tools.
- **Checkout**: The local repository directory containing the plugin source.
- **OMP profile**: The named OMP installation profile that owns a plugin install.
- **Live process**: The already-running OMP process; it keeps the plugin code loaded at startup.
- **Restart**: Fully quit and relaunch OMP so it loads the newly installed plugin.
- **Smoke test**: One focused live action that exercises the changed behavior.

## Operating contract

Use this workflow when source changes must reach a running OMP installation. The agent owns source verification, commit, push, and reinstall. The user only needs to fully restart OMP.

Never claim that the live process has the change before the user restarts OMP. A successful install changes the profile on disk; it does not replace code already loaded in the live process. `/reload-plugins` is not sufficient for a newly installed npm plugin in OMP 17.2.15.

Do not install a runtime plugin with `npx skills`. Skills and OMP runtime plugins use different packaging and loading paths.

## Iteration steps

1. Read `docs/STATE.md` and the plugin's local instructions before editing. Reuse the repository's tests, package scripts, and host adapters.
2. Make the smallest source and test changes that satisfy the requested behavior. Update project state when the change alters the repository's current understanding.
3. Run the focused tests for the changed plugin, then its TypeScript or package check. Do not report live behavior from source tests alone.
4. Commit the complete change and push it to `main`. If the remote `main` advanced, fetch, rebase, and push again. Do not leave a skill or plugin change only in a local worktree.
5. Reinstall the pushed checkout into the requested OMP profile:

   ```sh
   omp --profile <profile> plugin install /absolute/path/to/plugin
   ```

   Use the exact checkout containing the pushed commit. Do not add `--scope` for a local path.
6. Tell the user the pushed commit, the profile installed, and that OMP must be fully restarted. Do not ask the user to reinstall what the agent can reinstall.
7. After the user restarts OMP, run one smoke test through the changed command, hook, or tool. Report the observed live result separately from source-test results.

## Failure handling

- If the plugin path is not a package OMP can load, inspect its `package.json` extension declarations before installing.
- If installation fails, keep the source commit and report the exact installer error. Do not claim the profile changed.
- If the source tests pass but the live smoke test fails after restart, treat that as an integration failure. Inspect the loaded profile and process logs before changing source.
- If the user has uncommitted work in a separate main checkout, never stash, overwrite, or discard it to make the install work. Install from the pushed worktree instead.

## Completion criteria

The iteration is complete only when all are true:

- the focused source tests and checks pass;
- the complete change is committed and pushed to `main`;
- the pushed checkout is installed into the requested OMP profile;
- the user has been told that a full OMP restart is required;
- after restart, a smoke test confirms the changed live behavior.
