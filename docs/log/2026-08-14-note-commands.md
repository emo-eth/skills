# Personal log commands (fear, journal, grasp, do)

## Glossary

- **Note command**: A slash command that appends one JSON record to a personal log file.
- **Note kind**: The category of a note command: `bug`, `fear`, `journal`, `grasp`, or `do`.
- **Home file**: The default Markdown file in the user's home folder that receives records for one note kind.
- **Activity context**: The latest host event, command, tool, skill, and plugin metadata observed for one session.
- **GAP**: A capability or proof boundary that is not established and must not be promised.

## Scope

The user asked for four more commands next to `/bug`: log deep personal fears, general journal notes, concepts to understand, and small personal tasks. The change generalizes the existing `plugins/bug-command/` plugin: one shared record pipeline, five registered commands.

The commands are:

```text
/bug     [--plugin <name>] [--skill <name>] <bug description>   -> ~/BUGS.md    (BUGS_PATH)
/fear    [--plugin <name>] [--skill <name>] <fear>              -> ~/FEARS.md   (FEARS_PATH)
/journal [--plugin <name>] [--skill <name>] <journal note>      -> ~/JOURNAL.md (JOURNAL_PATH)
/grasp   [--plugin <name>] [--skill <name>] <concept>           -> ~/GRASP.md   (GRASP_PATH)
/do      [--plugin <name>] [--skill <name>] <task>              -> ~/DO.md      (DO_PATH)
```

Every command shares the `/bug` behavior: one Markdown list item with one JSON object, a one-line normalized note, and no copied prompt or event payload. Each record's `schema` field is `<kind>.v1`, so `~/BUGS.md` records stay `bug.v1` and new files start at `fear.v1`, `journal.v1`, `grasp.v1`, and `do.v1`.

## Design choices

- All five commands keep the full context capture (repository, branch, session, turn, recent activity). The context is free to collect, machine-filterable, and useful when an agent later reads `~/DO.md` or `~/GRASP.md`. A reader who only wants the note reads the `note` field.
- All five commands accept the same `--plugin` and `--skill` flags. One parser, one usage message shape (`Usage: /<kind> ...`).
- The plugin folder and package keep the `bug-command` name. The name is now narrower than the content; renaming would break the path-based install flow for no functional gain. Revisit if the plugin grows again.

## Implementation

- `src/record.ts`: `NOTE_COMMANDS` table (description, usage noun, notify label, home file, env var), `NoteKind`, per-kind `usage()`, `outputPath(kind)`, and `appendNoteRecord` with `schema: <kind>.v1`.
- `src/host.ts`: `installNoteCommands` registers all five commands from the table over one shared activity tracker.
- `src/pi.ts`, `src/omp.ts`: renamed entry functions, same seams.
- Tests cover per-kind file routing, env overrides, per-kind usage errors, per-kind schema stamps, journal notification text, and native OMP registration of all five commands.

## GAPs

- Same as `/bug` v1: plugin attribution can be null, turn counting can fall back to lifecycle order, and Pi proof is package-level.
- `--plugin` and `--skill` on `/fear` and `/journal` are accepted but rarely meaningful; they exist for parser uniformity.

## Verification

From `plugins/bug-command/`:

- `npm run check`: passed.
- `npm run test:node`: 11 tests passed, 0 failed.
- `npm run test:omp-runner`: 1 native OMP test passed (11 expects), confirming all five commands register in a clean OMP ExtensionRunner and `/bug` still writes a record.
