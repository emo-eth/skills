# Session reopen and continuation

A completed RPC session can reopen in a fresh process with the same saved history and continue without repeating an earlier tool effect.

## Sub-features

- `session-reopen` restores the saved messages and last assistant text in a fresh process.
- `session-continue` accepts a new prompt after reopen and preserves the earlier file effect.

## How to get to it (user POV)

- Reopen a saved session from an RPC client and continue the conversation.

## Driving it with the verification helper

Preconditions:

- `bash scripts/verify.sh doctor PACKAGE_ROOT` reports `ready`.
- Start with a fresh helper run so the fixture owns its session directory.

- **Create and reopen history.** Run `bash scripts/verify.sh full PACKAGE_ROOT`. The full fixture stops the first client, launches a fresh RPC client process, and reads the saved history.
- **Confirm continuation.** In the result JSON, require `mode: full`, `status: passed`, and the reopen checks. The fixture checks that the fresh process restores the same messages and final text, completes a new prompt, and does not repeat the saved file effect.

## Gotchas

- The fixture shares the full conversation workflow so reopen is checked against real saved tool history.
- This proves normal reopen after completion. It does not prove recovery after a crash or forced termination.
