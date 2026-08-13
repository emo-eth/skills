# Wrap-it-up expiry guard

Date: 2026-08-12

## Symptom

The OMP session in a local session log continued tool work after the two-minute wrap-it-up deadline.

The transcript shows a bash call blocked at 23:39:29 after expiry. At 23:39:42 the persisted wall-clock state was stopped. A `todo` call then ran at 23:39:49, although the original guard had expired.

## Cause

`plugins/wall-clock/src/host.ts` stopped every fast lane during `agent_end`. When the wrap-it-up lane had already expired, this changed the controller to an inactive, stopped state. Inactive states intentionally allow control decisions, so later post-run tool calls bypassed the expired-work gate.

## Fix

The `agent_end` handler now stops a fast lane only when its session is not expired. An expired lane remains active and continues to reject new work through the normal controller decision path. Non-expired lanes keep their existing end-of-run cleanup.

## Proof

Added `expired wrap-it-up guard remains enforced after agent end` to `plugins/wall-clock/tests/host.test.ts`.

- Before the fix, the test reproduced the bug: the post-expiry tool call returned no block decision.
- After the fix, the focused test passed with one passing test and zero failures:
  `node --experimental-strip-types --test --test-name-pattern='expired wrap-it-up guard remains enforced after agent end' tests/host.test.ts`
