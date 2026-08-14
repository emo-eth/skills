---
name: agent-plugin
description: Build or extend a native Agent Plugin for Pi and OMP, especially command-only tools like /yearn, /skiterate, and /bug. Use when the user asks to create a Pi or OMP plugin, native slash command, host adapter, or context-aware logger.
argument-hint: "[what the plugin should do]"
---

# Agent Plugin

## Glossary

- **Agent Plugin**: A package that a host loads through its native extension system.
- **Native adapter**: The thin Pi or OMP entry point that passes the host to shared plugin code.
- **Host seam**: A host callback such as `registerCommand` or `on` that the plugin can use without owning the host process.
- **Vertical slice**: The smallest path from a native command or hook to a real observable result.
- **Context record**: A bounded record of host, repository, session, turn, and recent activity metadata.
- **Live proof**: An action through a newly started host process, separate from source tests.
- **GAP**: A capability or proof boundary that is not established and must not be promised.

Use this skill for small native Pi and OMP tools. It is the fast path for
command-and-record plugins like Yearn, Skiterate, and bug capture. It also
covers hook and tool plugins when they use the same package and adapter shape.

## Operating contract

Build one working vertical slice before adding context, controls, or extra host
features. Reuse the nearest existing plugin. Keep Pi and OMP adapters thin and
put behavior in one shared module. A command-only plugin does not need a skill
wrapper, MCP operation, model call, or UI unless the request requires one.

Do not make the user write a full specification for a small tool. Resolve
ordinary ambiguity from the request and repository. State the chosen command,
record path, fields, and proof boundary in the dated evidence log. Ask only
when a persistent shape will have external consumers, an irreversible side
effect needs an owner decision, or two reasonable behaviors change the result.

For a small plugin, the scope lock and dated evidence log replace a PRD,
proposal, or review plan. Do not add a second planning artifact or run a
project-wide review unless the request explicitly needs one.

For an externally consumed data shape, stop before implementation and present
the fields, one concrete example, and a state diagram when lifecycle matters.
Resume only after owner sign-off.

## 1. Lock the smallest contract

Write this internal scope lock before browsing widely:

- **Command or hook**: the exact native entry point, for example `/bug`.
- **Input**: the smallest accepted arguments and explicit override flags.
- **Result**: the observable side effect, file, status, or returned value.
- **Context**: only metadata needed to diagnose the requested behavior.
- **Finish line**: one focused test and one real host smoke action when the host
  is available.

For a command-and-record tool with no stated destination, use these defaults:

- package: `plugins/<command>/`;
- command: `/<command>`;
- output: `~/<UPPER_COMMAND>.md`, overridden by `<UPPER_COMMAND>_PATH`;
- format: one Markdown list item containing one JSON object per invocation;
- baseline fields: schema, ID, ISO timestamp, host, repository, worktree,
  branch, current folder, agent, model, and note;
- diagnostic fields: session ID/file, turn number, latest event, latest
  command/tool, plugin, and skill when the host exposes them.

Do not record full prompts, full event payloads, tokens, credentials, or copied
logs. Missing host data is `null` or an explicit GAP, not a guessed value.

## 2. Read only the useful pattern

Read these in order:

1. `docs/STATE.md` and the repository's local instructions.
2. The nearest package: `plugins/turn-summary/` for a minimal command/context
   seam, `plugins/bug-command/` for a context-rich recorder, or
   `plugins/wall-clock/` for deeper host lifecycle handling.
3. `skills/omp-plugin-iteration/SKILL.md` when the result must reach a running
   OMP profile.
4. The package's existing tests and exact host versions in `package.json`.

Do not begin with a repository-wide search or external API research. Existing
native tests are the first host contract. Extend them only when the requested
behavior needs a seam they do not cover.

## 3. Build the package in one pass

Create or update the conventional package files:

```text
plugins/<command>/
  plugin.json
  package.json
  package-lock.json
  tsconfig.json
  .gitignore
  src/
    host.ts       # shared behavior and host seam
    pi.ts         # thin Pi adapter
    omp.ts        # thin OMP adapter
  tests/
```

Use the current Pi and OMP versions from the nearest package. Declare both
native extension paths in `package.json`, export both adapters, and keep the
plugin manifest name aligned with the directory and command.

Implement the shared module in this order:

1. Register the command or hook and prove the minimal result.
2. Normalize user input and return a useful usage error for empty input.
3. Add the requested side effect behind a small test seam.
4. Add bounded context metadata. Use safe reads for optional host fields and
   let the command work when lifecycle hooks are unavailable.
5. Add explicit flags when automatic host metadata is incomplete. Explicit
   values override inferred values.

Use `unknown` at the native host seam. Do not duplicate Pi and OMP logic to
work around unverified host types. Catch notification failures separately from
the main result. A logging failure must report an error without corrupting a
successful host process.

## 4. Prove both adapters

Add focused tests before broad cleanup:

- recorder or core tests for parsing, normalization, output override, metadata,
  and the exact record shape;
- one fake-host test for Pi and one for OMP, including the actual command name;
- one native OMP ExtensionRunner test when the pinned OMP dependency is
  available;
- a live Pi smoke test only when a clean Pi process is available. Otherwise
  document package-level Pi proof and the GAP.

Run the changed package, not the whole repository:

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm pack --dry-run --json
```

For a direct OMP proof, load the exact adapter in a clean process with the
changed command and an isolated session directory. Inspect the resulting file
or host response. Source tests and a clean process are separate evidence.

## 5. Record the boundary

Create `docs/log/YYYY-MM-DD-<name>.md` with a glossary before the body. Record:

- the chosen command and output contract;
- the fields captured and the privacy boundary;
- Pi and OMP seams used;
- source checks and live smoke results;
- every unproven host capability as a GAP.

Update `docs/STATE.md` in the same change. Add a decision entry only when the
new plugin establishes a repository-wide contract, naming decision, or lasting
tradeoff. Keep the state index short and point to the dated evidence log.

## 6. Reach a clean handoff

Before returning:

1. Read the changed skill/package sections once after edits.
2. Check that every declared package entry point exists and the package dry run
   contains the manifest and adapters.
3. Run the focused check again after documentation or merge conflict edits.
4. Commit the complete change and push it to `main`. If working on a branch,
   merge or fast-forward the current `main` checkout rather than leaving the
   skill or plugin only on the branch. Preserve uncommitted work in any other
   checkout.
5. For an installed OMP plugin, follow `omp-plugin-iteration`: install the
   pushed checkout, tell the user a full OMP restart is required, and report
   post-restart smoke evidence separately.

Return only:

- what package and command changed;
- the pushed commit and install/restart handoff, if applicable;
- focused source and live proof;
- one explicit GAP or `None`.

Do not claim that a fake host test proves a live host load. Do not claim that
installation changed an already-running OMP process.
