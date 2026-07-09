# Hard-Won Learnings From Production Rollouts

Read this when tests fail unexpectedly, when debugging mock issues, or when a UI redesign breaks existing tests.

## Table of Contents

- [Test Infrastructure](#test-infrastructure)
- [Mock & Timing Issues](#mock--timing-issues)
- [UI Redesign Pitfalls](#ui-redesign-pitfalls)
- [Component Architecture Gotchas](#component-architecture-gotchas)

## Test Infrastructure

### Keep coverage tests out of Playwright discovery

Pure machine coverage tests belong in the unit-test runner (Jest/Bun), not Playwright. Put them under `e2e/machines/__tests__/` and configure Playwright to only collect `**/*.spec.ts`. Otherwise Playwright will collect `coverage.test.ts` and fail on globals like `describe`.

### Wire machine constants into specs — but only where used

Import machine state/event enums into spec files for traceability and typo prevention. But don't force unused imports — strict `no-unused-vars` lint rules will break CI. Use constants in test names:
```typescript
test(`${STATE.loaded}: dashboard loads with data`, async ({...
```

### Prefer scenario-driven tests over createTestModel

`createTestModel` auto-generates tests from machine paths but is overengineering for most real-world machines where events don't map 1:1 to browser actions, async timing needs specific mock configs, and the same browser action can trigger multiple events. Default to scenario-driven manual tests.

### Add a package-wide stabilization pass

After a feature-local suite passes, run the package-wide Playwright suite. State-machine work often exposes stale tests outside the immediate folder that still encode pre-redesign assumptions.

## Mock & Timing Issues

### Mock timing — use deferred responses

For loading states, use the deferred response pattern (not `setTimeout`). This lets you assert loading state before resolving. See `mock-patterns.md` for the implementation.

### Static error mocks block recovery testing

Boolean error flags (`balanceError: true`) make ALL requests return errors. To test error→recovery, use error sequences that advance per request:
```typescript
quoteErrorSequence: [
  { status: 500, message: "Quote service unavailable" },
  null,  // second request succeeds
]
```
Last entry repeats. See `mock-patterns.md` for the full pattern.

### Configuration contract propagation

When `requiresApproval` (or similar) affects multiple mock layers, it must propagate consistently: quote response includes approval_txns → transaction mock treats first tx as approval → page assertions expect approval step. Document this chain. Mismatches cause the mock to treat bridge tx as approval (or vice versa).

### Wallet hydration race

Always `await page.waitForFunction(() => !!window.__EVM_WALLET_CONTROL__)` before calling wallet methods. The React app needs to hydrate and mount test wallet controls first.

## UI Redesign Pitfalls

### Model user-visible boundaries, not legacy implementation boundaries

When a UI is redesigned, the old conceptual boundary is often wrong. A "bridge UI" machine should stop where the visible UI stops changing. Success/error outcomes may belong to a separate machine. Prefer the boundary that matches what a user can currently see.

### Machine states can diverge from redesigned UI

A machine may model states the UI no longer renders (e.g., `enter_amount` as a disabled button when the redesign hides it entirely). Always verify assertions against the real UI. When you find divergence: write the test to match reality, update the machine's `meta.ui`, document it.

### Revamps invalidate old test boundaries

When a redesign changes modal vs inline structure, old test grouping may be wrong. Update machine boundary and page object to match the new visible UX before rewriting assertions.

### Missing test IDs slow everything down

Add `data-testid` attributes early. Trying to finish coverage without stable test IDs creates brittle selectors and wasted debugging time.

### Stable test hooks are part of the product contract

Inline revamps often remove old modal hooks. Treat test IDs as first-class requirements: add `data-testid` for progress, receipt, error, and selected-token surfaces. When a redesign removes a hook, replace it — don't force brittle locators.

## Component Architecture Gotchas

### Hidden overlay click interception is usually an app bug

If Playwright can't click a visible control because a hidden layer intercepts pointer events, inspect the app first: opacity-only hiding, animated absolute-positioned layers. Fix with `pointer-events: none` or visibility toggles before using forceful Playwright patterns.

### Parent-managed state can break child retry buttons

When a parent fetches data and passes `balancesOverride` to a child, the child's own hook gets disabled (`enabled: false`). Its retry button calls `refetch()` on the disabled hook — a no-op. This is a real UI bug, not a test infrastructure issue.

### Different APIs have different recovery mechanisms

| API | Recovery mechanism | Testable? |
|-----|-------------------|-----------|
| Quote | User changes amount → new query key | Yes — use `quoteErrorSequence` |
| Balance (values) | Refetch interval picks up new values | Yes — use `balanceSequence` |
| Balance (errors) | Refetch stops on error; retry button broken in composed context | No — architectural limitation |

Understand the recovery mechanism before writing the test.

### Don't model transient states

If a state exists for <100ms and has no assertable UI (e.g., "connecting" when mocks are synchronous), don't include it in the machine.
