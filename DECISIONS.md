# Decisions: linear-capture (EMO-542)

## 2026-10-09: Plugin Architecture
- Adopted the plugin structure of `plugins/no-code-comments/` (`package.json`, `plugin.json`, `src/host.ts`, `src/pi.ts`, `src/omp.ts`).
- `src/host.ts` remains host-agnostic, handling command parsing, model prompt generation for drafting the 7-question spec, optional interview loops, structural checking via offline VDD evaluator (`python3 /Users/emo/dev/vdd/packages/tickets/evaluator.py`), and dispatching issue creation via `linear issue create`.
- `src/pi.ts` and `src/omp.ts` act as thin adapters to hook into the runtime host (`registerCommand`).

## 2026-10-09: Interview Strategy
- Support `--no-interview` flag to skip the interview entirely.
- When drafting is incomplete or ambiguous, generate at most 3 targeted clarifying questions only for missing or underspecified sections.
- Query using `ctx.ui.input` or host question facility when available, falling back to follow-up messaging or prompt if in headless/non-interactive mode.

## 2026-10-09: Verification & Linear CLI Execution
- Run offline VDD evaluator via subprocess `PYTHONPATH=/Users/emo/dev/vdd/packages/tickets python3 /Users/emo/dev/vdd/packages/tickets/evaluator.py --json --offline -`.
- If deficiencies are found (or if completed-look contains "tests pass"), present the critique and prompt the user to confirm whether to fix or post anyway.
- Execute Linear issue creation using `linear issue create --team EMO --project <project> --description-file <file> --title <title> --no-interactive`.
- Never post without explicit user confirmation of the drafted spec.
