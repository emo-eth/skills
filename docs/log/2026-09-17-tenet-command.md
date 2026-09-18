# Tenet command evidence

## Glossary

- **Agent Plugin**: A package that a host loads through its native extension system.
- **Native adapter**: The thin Pi or OMP entry point that passes the host to shared plugin code.
- **Tenet**: A standing invariant that should remain true about the harness, computer, or setup.
- **Tenet record**: One append-only JSON object recording a tenet along with host and session context.
- **Host seam**: A host callback such as `registerCommand` that the plugin uses to expose functionality.
- **Vertical slice**: The smallest path from a native slash command to an appended log record.
- **GAP**: A capability or proof boundary that is not established and must not be promised.

## Command and output contract

The plugin is `@emo-eth/tenet-extension` v0.1.0 at `plugins/tenet/`. It registers the native slash command:

```text
/tenet <standing invariant>
```

- Description: `Record a standing invariant that should remain true`
- Empty input usage error: `Usage: /tenet <standing invariant>` (error notification; creates no file)
- Successful recording notification: `Tenet recorded in ${path}` (info notification)
- Failure notification: `Tenet could not be recorded: ${message}` (error notification)
- Destination: `~/.tenet/tenets.ndjson`, overridden by environment variable `TENETS_PATH`
- File format: Append-only newline-delimited JSON (NDJSON)
- Filesystem permissions: Directory mode `0o700`, file mode `0o600`

## Fields

Each record conforms to schema `tenet.v1` and contains:

- `schema`: literal `"tenet.v1"`
- `id`: UUID v4 string
- `recordedAt`: ISO-8601 UTC timestamp
- `tenet`: normalized invariant string
- `host`: `"omp"` or `"pi"`
- `cwd`: current working directory from host context or process fallback
- `sessionId`: optional host session ID when exposed by `sessionManager.getSessionId()`
- `sessionName`: optional host session name when exposed by `sessionManager.getSessionName()`
- `model`: optional model ID string when exposed by host context

## Privacy boundary

The command records only the user's explicit invariant text and ambient environment metadata (cwd, host runtime, session identity, model identifier). It never records prompt text, conversation history, event payloads, tool call payloads, API keys, tokens, or credentials.

## Pi and OMP seams

- `plugins/tenet/src/pi.ts`: default export `tenetPiExtension(api)` calls `installTenetExtension(api, "pi")`.
- `plugins/tenet/src/omp.ts`: default export `tenetOmpExtension(api)` calls `installTenetExtension(api, "omp")`.
- `plugins/tenet/src/index.ts`: shared implementation calls `api.registerCommand("tenet", ...)`.
- Notifications use `ctx.ui?.notify?.(message, level)`. Notification failures are caught and swallowed so a broken UI notification does not fail or abort a successful log write.

## Source checks

From `plugins/tenet/`:

- `npm install --ignore-scripts --no-audit --no-fund`: added 3 packages in 255ms.
- `npm run check` (`tsc -p tsconfig.json`): passed with 0 errors.
- `npm test` (`node --experimental-strip-types --test tests/*.test.ts`): 4 tests passed, 0 failed:
  - Pi and OMP entrypoints both register the local command
  - tenet records a standing invariant with host and session metadata
  - tenet rejects empty input without creating a record
  - tenet uses the default global path when no override is set
- `npm pack --dry-run --json`: includes `package.json`, `src/index.ts`, `src/omp.ts`, `src/pi.ts`, `tests/index.test.ts`, `tsconfig.json`.
- Invariant validation: empty `/tenet` creates no file and returns usage error; nonempty appends one JSON line with `schema: "tenet.v1"` and field `tenet`.

## Live capture

The first live `tenet.v1` record was written through `installTenetExtension` into `~/.tenet/tenets.ndjson` (id `fe2f11a1-8a16-44a2-97cf-17f917c389ef`, 2026-09-18T03:13:24.895Z). Text: always be able to open files in Cursor remotely when SSH'd or Herdr'd to tailnet devices. This is adapter-handler proof, not a restarted OMP `/tenet` invocation.

## GAPs

- **Live OMP/Pi command unproven**: package tests and a direct adapter-handler append cover recording. A restarted OMP/Pi process has not yet executed `/tenet`.
- **Chezmoi log-sync is implemented in the chezmoi source tree, not yet applied as part of this skills commit**: `dot_tenet/tenets.ndjson`, union merge, ignore rules, reconcile/assimilate, `omp_sources`, and Pi package path. Fleet apply still needs the plugin on `origin/main` plus a chezmoi commit.
- **Papercut two-machine e2e**: `test_spark_chezmoiignore_rules` passed. `test_full_two_machine_offline_sync_and_race_prevention` failed here with `chezmoi: timeout obtaining persistent state lock`; treat as environment, not a tenet-schema failure.
- **Recording does not verify or repair the invariant**: `/tenet` is capture only.
