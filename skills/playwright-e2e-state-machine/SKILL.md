---
name: playwright-e2e-state-machine
description: Create comprehensive Playwright E2E tests for Next.js web3 applications by modeling all user-facing state dimensions as XState v5 machines, then generating tests that achieve meaningful coverage of declared states. The skill enforces depth-first completion — each machine should have tests for all its testable states before moving to the next. Triggers on "playwright tests", "e2e tests", "test all states", "validate user flows", "state machine tests", or when comprehensive UI test coverage is needed. Use this skill whenever the user wants E2E browser tests, even if they don't mention state machines.
---

# Playwright E2E State Machine Testing

Generate comprehensive Playwright tests for Next.js web3 applications by modeling all user-facing state dimensions as XState v5 state machines, then writing tests that achieve meaningful coverage of all testable states.

## Dependencies

```bash
bun add -D xstate @xstate/graph @playwright/test
```

## The Coverage Trap

The natural tendency is to go wide: discover all pages, model all dimensions, create all machines, write happy-path tests for each, declare done. This consistently produces ~50% coverage because:

- **Happy paths are easy, alternative paths are work.** A swap execution machine with 12 states gets one happy-path test covering 5 states. The approval flow, chain switch, signature flow, and error recovery each need their own scenario. That's where the other 7 states live.
- **Machines feel like progress, tests are the actual deliverable.** Machines with no tests covering their states are documentation, not test infrastructure.
- **Graph reachability ≠ test coverage.** A `coverage.test.ts` that verifies all states are reachable via `@xstate/graph` proves the machine is well-formed. It does NOT prove any Playwright spec exercises those states in a browser.

The key discipline: **finish each machine to meaningful depth before starting the next.** A machine with 6 states and 5 tested (plus 1 documented as untestable) is worth more than 3 machines with 18 states and 9 tested.

## Workflow Overview

Eight phases:

1. **Discover Pages** — Identify all routes and their component trees
2. **Map State Dimensions** — For each page, enumerate every independent axis of state the user can see
3. **Model Machines** — One XState v5 machine per dimension, cross-referenced against production code
4. **Validate Reachability** — Use `@xstate/graph` to verify all states reachable, all events exercised
5. **Build Mocks** — Create scenario configs that produce each state — one scenario per state minimum
6. **Write Tests** — Depth-first: complete all testable states for one machine before starting the next
7. **Coverage Matrix** — Produce a concrete state→test mapping showing what's tested and what's skipped
8. **Self-Audit** — Review the matrix, identify gaps, fill them before declaring done

## Phase 1: Discover Pages

Find all page routes:

```bash
find src/app -name "page.tsx" -o -name "page.ts" | sort
```

For each page, trace the **full component tree** recursively:
1. Read the page file → identify imported components
2. For each component → identify props, hooks, context providers, sub-components
3. For each hook → identify what state it reads/writes
4. For each component → note `data-testid` attributes (these become locator targets)

**Output:** A document listing every component on each page with what it renders, what state controls it, and what test IDs it exposes. Don't skip this — you can't model states you haven't found.

## Phase 2: Map State Dimensions

**Critical insight: State dimensions, not components.** A "dimension" is an independent axis of variation that changes what the user sees.

For each element on the page, ask: What controls whether this is visible? Enabled? What text/style it shows? Group answers by their **independent variable**. Each independent variable is a dimension.

See `references/state-dimension-guide.md` for detailed patterns in web3 apps (wallet states, balances, quotes, CTA cascades, destination addresses, etc.).

**What is NOT a dimension:** Synchronous mock states with no visible spinner, dev-only tools, transient animations, server-only states, legacy UI groupings.

**Output:** For each dimension: name, states, source hook/component, what UI changes, what it's independent of.

## Phase 3: Model XState v5 Machines

One machine per dimension in `e2e/machines/`.

### Cross-reference every state against production code

This prevents machine bugs — states that exist in the model but can't be reached because the machine doesn't model the conditions needed to produce them.

For every state:

1. **Find the production code path that produces it.** Search for the state's visible output (button text, UI element, error message) in the source. Trace back to the hook that decides when this state is active. Note the exact conditions.

2. **Verify the machine models those conditions.** If production checks `destinationAddressStatus.isRequired && !hasValue`, the machine must have `hasDestination` in its context with a corresponding guard. If the machine doesn't model the condition, the state is unreachable — a bug.

3. **Document the production source in `meta`:**
```typescript
[STATE.destinationRequired]: {
  meta: {
    ui: "CTA shows 'Enter Destination Address', disabled",
    source: "use-button-state.ts:103-118",
  },
}
```

**Why this matters:** Without cross-referencing, machines get modeled from generic patterns rather than what the production code actually does. The result is states that look right but can't be reached because the machine's context is missing the variables production uses. This is exactly how 3 CTA states (`ready-warning`, `destination-required`, `destination-invalid`) became unreachable in a real rollout — the machine had no `hasDestination` or `hasPriceImpactWarning` context properties, so guards could never route to those states, even though production code uses them.

### Machine rules

Every machine must export `MACHINE_STATE`, `MACHINE_EVENT` (as const), `MACHINE_STATE_IDS`, `MACHINE_EVENT_TYPES`, and the machine itself. Every state must have `meta.ui` and `meta.source`.

See `references/xstate-graph-pitfalls.md` for critical rules: avoid event-param guards (use separate events), context-based guards are fine, use `type: "final"` for terminal states, document cycles explicitly.

See `references/code-templates.md` for the cascade machine pattern (CTA button) and machine export boilerplate.

## Phase 4: Validate Reachability

Run coverage tests via `bun test` (NOT Playwright) — these are pure `@xstate/graph` computations, no browser needed. Keep them under `e2e/machines/__tests__/`.

See `references/code-templates.md` for the `describeMachineCoverage` factory that checks all states are reachable and all events are exercised.

**If states are unreachable:** Re-check Phase 3's cross-referencing — the machine may be missing context properties. Add the missing context, add the guard, re-run.

## Phase 5: Build Mocks

### The scenario budget rule

**A machine with N states needs enough scenarios to cover every testable state.** Work through states systematically — for each one, identify which scenario exercises it. States along the same path share a scenario (e.g., `loading` and `loaded` in the happy path), so a 12-state machine might need only 5 distinct scenarios. But every testable state must appear in at least one test.

**If you can't identify a scenario for a state, that's a signal.** Either the state is unreachable (machine bug — back to Phase 3) or you haven't understood the production code well enough.

See `references/code-templates.md` for scenario config examples showing happy path, approval flow, chain switch, signature flow, and error recovery — each exercising different machine paths.

See `references/mock-patterns.md` for mock layer architecture (page.route, addInitScript, transaction mocks, deferred responses, error sequences).

## Phase 6: Write Tests — Depth-First

### The depth-first rule

Complete all testable states for one machine before moving to the next. The natural temptation is to write happy-path tests for every machine first. Resist it — that's how you end up at 50% coverage.

**Work order for each machine:**
1. Write the happy-path test first (exercises the main flow)
2. List all states NOT covered by the happy path
3. For each uncovered state, write a test using its scenario from Phase 5
4. Verify: every testable state appears in at least one test. Document any states you skip and why.
5. Move to the next machine

### What tests look like

**Happy path:** One scenario, exercises the main flow start-to-finish.

**Alternative paths — just as important as the happy path:**
- Approval flow: `setupMocks(scenarios.getWithApproval)` → approval step appears → confirm → swap continues
- Chain switch: `setupMocks(scenarios.getWrongChain)` → chain switch prompt → switch → swap continues
- Signature flow: `setupMocks(scenarios.getSignatureFlow)` → EIP-712 prompt → sign → success
- Error + recovery: `setupMocks(scenarios.transactionFailed)` → error message → retry → back to ready

**Error states for data-fetching machines:** Every machine with an `error` state needs a scenario that produces it. Don't skip these because "they're simple" — they're the states most likely to have no test.

**Interactive states:** Edit dialogs, delete confirmations, form submissions all need tests exercising the UI interaction that enters and exits the state.

See `references/code-templates.md` for full test examples.

### File structure

```
e2e/
├── machines/           # XState machines (test-only)
├── fixtures/           # test-base.ts, scenarios.ts, mock-data.ts, transaction-mocks.ts
├── pages/              # Page objects with locators + actions + assertions
└── feature-name/       # Specs: happy-path, validation, alternative-flows, edge-cases
```

## Phase 7: Coverage Matrix

After writing tests, produce a concrete coverage matrix mapping every state to its test.

### Format

For each machine, a table: State | Tested | Spec File | Test Name (or `skipped` with reason).

### What "tested" means

A state is "tested" when a Playwright spec navigates to a page with mocks configured to produce that state AND makes at least one assertion that would fail if the state weren't rendered.

NOT tested just because: graph coverage passes, a scenario exists but no spec uses it, or the state is a transient step with no assertion.

### When to mark a state as "skipped"

Valid reasons:
- **Third-party iframe** — e.g., Persona KYC. Can verify presence but not interaction.
- **Architectural limitation** — e.g., retry button broken due to parent-managed state.
- **Requires external service** — state only appears after real webhook callback.
- **Transient timing** — resolves in <100ms with mocks, assertions would be flaky.

Not valid reasons:
- "It's just an error state" — create an error scenario.
- "The happy path is enough" — alternative paths are testable with different mock configs.
- "I'd need to add a new scenario" — that's the job.
- "It would take too long" — depth-first means doing the work.

## Phase 8: Self-Audit

Before declaring done:

1. **Coverage completeness** — For each untested state: testable but missing → write the test. Genuinely untestable → document why and mark as `skipped`. The goal is no *unexplained* gaps.

2. **Machine-production alignment** — Are there production states the machine doesn't model (missing coverage)? Machine states production can't produce (dead states)?

3. **Scenario completeness** — Every scenario in `scenarios.ts` should be used by at least one spec. Unused scenarios suggest planned-but-never-written tests.

4. **Commonly-missed scenarios** — Error states for data-fetching machines, error recovery flows, interactive states (edit/delete dialogs), validation edge cases that differ between similar flows, alternative execution paths.

### The completion gate

- [ ] Every machine state is either tested or documented as intentionally skipped (with reason)
- [ ] Every scenario in `scenarios.ts` is used by at least one spec
- [ ] The self-audit gap report is empty
- [ ] Graph-only coverage tests pass under the unit-test runner
- [ ] Package-wide Playwright suite passes (no regressions)

## Priority Order for New Machines

Prioritize by coverage ROI:

1. **CTA/validation machines** — Synthesize multiple inputs into one visible output
2. **Core flow machines** — Main user journey
3. **Wallet/connection machines** — Affect everything downstream
4. **Data-dependent machines** — Need mock infrastructure
5. **Configuration machines** — Lower risk, fewer states

Depth first. Finish one machine completely before starting the next, regardless of priority.

## Reference Files

- `references/state-dimension-guide.md` — How to find state dimensions in web3 apps (wallet, balance, quote, CTA, destination patterns)
- `references/xstate-graph-pitfalls.md` — Event-param guard issues, cycle handling, path explosion, parallel state guidance
- `references/mock-patterns.md` — Mock layer architecture, deferred responses, error sequences, transaction mocks, wallet injection
- `references/code-templates.md` — Machine boilerplate, coverage factory, scenario configs, test examples, page object pattern
- `references/learnings.md` — Hard-won debugging tips from production rollouts (click interception, hydration races, revamp boundary issues, retry button pitfalls)
