# Code Templates

Boilerplate and examples for state machine E2E tests. Read this when implementing machines, scenarios, or tests.

## Table of Contents

- [Machine Export Boilerplate](#machine-export-boilerplate)
- [Cascade Machine Pattern (CTA Button)](#cascade-machine-pattern)
- [Coverage Factory](#coverage-factory)
- [Scenario Config Examples](#scenario-config-examples)
- [Test Examples](#test-examples)
- [Page Object Pattern](#page-object-pattern)

## Machine Export Boilerplate

Every machine must export these:

```typescript
export const MACHINE_STATE = {
  idle: "idle",
  loading: "loading",
  loaded: "loaded",
  error: "error",
} as const;

export const MACHINE_EVENT = {
  LOAD: "LOAD",
  LOAD_SUCCESS: "LOAD_SUCCESS",
  LOAD_ERROR: "LOAD_ERROR",
} as const;

export const MACHINE_STATE_IDS = Object.values(MACHINE_STATE);
export const MACHINE_EVENT_TYPES = Object.values(MACHINE_EVENT);

export const myMachine = setup({
  types: { context: {} as MyContext, events: {} as MyEvent },
  // ...
}).createMachine({ /* ... */ });
```

## Cascade Machine Pattern

For validation cascades (CTA buttons) where a priority-ordered set of guards determines the current state:

```typescript
// Guard cascade — SINGLE SOURCE OF TRUTH for priority order
// Each entry's guard must be cross-referenced against production code
const GUARD_CASCADE: Array<{ target: CtaState; guard: string }> = [
  { target: "ready", guard: "shouldBeReady_NoWallet" },         // P0: no wallet
  { target: "enter-amount", guard: "shouldBeEnterAmount" },     // P1
  { target: "minimum-amount", guard: "shouldBeMinimumAmount" }, // P2
  { target: "insufficient-balance", guard: "shouldBeInsufficient" }, // P3
  { target: "destination-required", guard: "shouldBeDestRequired" }, // P4
  { target: "destination-invalid", guard: "shouldBeDestInvalid" },  // P5
  { target: "quote-error", guard: "shouldBeQuoteError" },       // P6
  { target: "ready-warning", guard: "shouldBeReadyWarning" },   // P7
  { target: "ready", guard: "shouldBeReady_Connected" },        // P8: fallthrough
];

// Generate always array per state (excluding self-transitions)
function alwaysTransitionsFor(selfState: CtaState) {
  return GUARD_CASCADE.filter((entry) => entry.target !== selfState);
}

// Generate all states programmatically
const states = Object.fromEntries(
  STATE_IDS.map((id) => [
    id,
    {
      meta: { description: STATE_DESCRIPTIONS[id] },
      on: sharedEvents,
      always: alwaysTransitionsFor(id),
    },
  ]),
);
```

Guards must be **fully qualified** — each checks the FULL condition path, not just its own check. Simplified guards create incorrect transitions when `always` arrays exclude self-transitions.

## Coverage Factory

Shared coverage test utility — run via `bun test`, NOT Playwright:

```typescript
// e2e/machines/__tests__/coverage-utils.ts
import { getShortestPaths, getSimplePaths } from "@xstate/graph";
import type { AnyStateMachine } from "xstate";
import { describe, test, expect } from "bun:test";

export function describeMachineCoverage(
  name: string,
  machine: AnyStateMachine,
  stateIds: string[],
  eventTypes: string[],
  opts?: { expectedUncoveredEvents?: string[] },
) {
  describe(`${name}: Machine Coverage`, () => {
    test("all states are reachable via shortest paths", () => {
      const paths = getShortestPaths(machine);
      const reachable = new Set(paths.map((p) => String(p.state.value)));
      for (const stateId of stateIds) {
        expect(reachable.has(stateId)).toBe(true);
      }
    });

    test("all events are exercised via simple paths", () => {
      const paths = getSimplePaths(machine);
      const covered = new Set<string>();
      for (const path of paths) {
        for (const step of path.steps) {
          if (step.event.type !== "xstate.init") covered.add(String(step.event.type));
        }
      }
      const uncovered = new Set(opts?.expectedUncoveredEvents ?? []);
      for (const eventType of eventTypes) {
        if (uncovered.has(eventType)) continue;
        expect(covered.has(eventType)).toBe(true);
      }
    });
  });
}
```

Usage:
```typescript
// e2e/machines/__tests__/coverage.test.ts
describeMachineCoverage("CTA button", ctaButtonMachine, CTA_STATE_IDS, CTA_EVENT_TYPES);
describeMachineCoverage("Swap execution", swapExecutionMachine, SWAP_STATE_IDS, SWAP_EVENT_TYPES,
  { expectedUncoveredEvents: ["RESET"] });
```

## Scenario Config Examples

Each scenario exercises a different path through the machine. Together they cover all testable states:

```typescript
export const scenarios = {
  // Happy path — covers: idle → awaiting-swap → swap-pending → bridging → success
  happyPathPreApproved: {
    balances: createMockBalances({ usdcBalance: "1000000000" }),
    requiresApproval: false,
    bridgeProvider: "across",
    bridgeStatusSequence: ["pending", "filled"],
    transactionFlow: { bridgeOutcome: "success" },
  } satisfies MockOptions,

  // Approval flow — covers: awaiting-approval → approval-pending → ready-for-swap
  getWithApproval: {
    balances: createMockBalances({ usdcBalance: "1000000000" }),
    requiresApproval: true,
    bridgeProvider: "across",
    bridgeStatusSequence: ["pending", "filled"],
    transactionFlow: { bridgeOutcome: "success", approvalOutcome: "success" },
  } satisfies MockOptions,

  // Chain switch — covers: awaiting-chain-switch
  getWrongChain: {
    balances: createMockBalances({ usdcBalance: "1000000000" }),
    initialChainId: "0xa4b1",  // Start on Arbitrum, need to switch
    transactionFlow: { bridgeOutcome: "success" },
  } satisfies MockOptions,

  // Signature flow — covers: awaiting-signature → signature-pending
  getSignatureFlow: {
    balances: createMockBalances({ usdcBalance: "1000000000" }),
    isSignatureFlow: true,
    bridgeProvider: "relay",
    transactionFlow: { bridgeOutcome: "success", signatureOutcome: "success" },
  } satisfies MockOptions,

  // Error + recovery — covers: error state and RESET transition
  transactionFailed: {
    balances: createMockBalances({ usdcBalance: "1000000000" }),
    transactionFlow: { bridgeOutcome: "error" },
  } satisfies MockOptions,
};
```

Use `satisfies MockOptions` for type safety without widening. Name scenarios after the state they produce, not the test that uses them.

## Test Examples

### Alternative path tests

```typescript
// Approval flow
test("approval required → approve → swap → success", async ({ setupMocks, page }) => {
  await setupMocks(scenarios.getWithApproval);
  await page.goto("/get");
  await page.enterAmountAndWaitForQuote("100");
  await page.startSwap();
  await expect(page.approvalStep).toBeVisible();
  await page.confirmApproval();
  await page.confirmSwap();
  await page.waitForSuccess();
});

// Chain switch flow
test("wrong chain → switch → swap → success", async ({ setupMocks, page }) => {
  await setupMocks(scenarios.getWrongChain);
  await page.goto("/get");
  await page.enterAmountAndWaitForQuote("100");
  await page.startSwap();
  await expect(page.chainSwitchPrompt).toBeVisible();
  await page.confirmChainSwitch();
  await page.confirmSwap();
  await page.waitForSuccess();
});

// Signature flow
test("relay permit → sign EIP-712 → swap → success", async ({ setupMocks, page }) => {
  await setupMocks(scenarios.getSignatureFlow);
  await page.goto("/get");
  await page.enterAmountAndWaitForQuote("100");
  await page.startSwap();
  await expect(page.signaturePrompt).toBeVisible();
  await page.confirmSignature();
  await page.waitForSuccess();
});

// Error + recovery
test("transaction error → reset → retry", async ({ setupMocks, page }) => {
  await setupMocks(scenarios.transactionFailed);
  await page.goto("/get");
  await page.enterAmountAndWaitForQuote("100");
  await page.startSwap();
  await page.confirmSwap();
  await expect(page.errorMessage).toBeVisible();
  await page.clickRetry();
  await expect(page.swapButton).toBeVisible();
});
```

### Error state tests (data-fetching machines)

```typescript
test("API error shows error state with retry", async ({ setupMocks, page }) => {
  await setupMocks(scenarios.overviewError);
  await page.goto("/");
  await expect(page.errorMessage).toBeVisible();
  await expect(page.retryButton).toBeVisible();
});
```

### Interactive state tests

```typescript
test("edit wallet name → save", async ({ setupMocks, page }) => {
  await setupMocks(scenarios.accountsWithWallets);
  await page.goto("/accounts");
  await page.clickEditOnFirstWallet();
  await expect(page.editDialog).toBeVisible();
  await page.fillWalletName("My Wallet");
  await page.saveEdit();
  await expect(page.editDialog).not.toBeVisible();
});
```

## Page Object Pattern

```typescript
export class BridgePage {
  readonly page: Page;
  readonly ctaButton: Locator;
  readonly backButton: Locator;

  constructor(page: Page, mode: "buy" | "sell") {
    this.page = page;
    const card = page.locator(`[data-bridge-card][data-mode="${mode}"]`);
    this.ctaButton = card.locator('[data-testid="swap-cta-button"]');
  }

  async goto() { /* navigate + hydration gate */ }
  async enterReceiveAmount(amount: string) { /* fill input */ }
  async connectEvmWallet(opts?: { force: boolean }) { /* window.__EVM_WALLET_CONTROL__ */ }
  async expectButtonState(state: CTAButtonState) { /* data-state assertion */ }
  async waitForSuccess() { /* wait for success indicators */ }
}
```

**Guidance:**
- Prefer `data-testid` locators over visible text
- Add helper methods for repeated setup transitions
- Put UX assumptions in one page object method, not across specs
- When a flow changes from modal to inline, update the page object first
