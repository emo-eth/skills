# Mock Patterns for Playwright Web3 Testing

Established patterns for mocking in Playwright E2E tests for Next.js web3 apps. All patterns use Playwright's built-in capabilities — no external mock servers.

## Architecture

```
┌─────────────────────────────────────┐
│  Spec File (*.spec.ts)              │  Uses setupMocks + page objects
├─────────────────────────────────────┤
│  Test Base (test-base.ts)           │  Extends Playwright, provides fixtures
├─────────────────────────────────────┤
│  Scenarios (scenarios.ts)           │  Pre-configured MockOptions
│  Mock Data (mock-data.ts)           │  Factories for deterministic data
├─────────────────────────────────────┤
│  page.route()                       │  HTTP API interception
│  page.addInitScript()               │  Wallet/RPC provider injection
│  Transaction Mocks                  │  Stateful RPC state machine
└─────────────────────────────────────┘
```

## Layer 1: HTTP API Mocking (page.route)

### Basic pattern

```typescript
await page.route("**/api/quote", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(createMockQuote()),
  });
});
```

### Sequential responses (for polling)

```typescript
let callCount = 0;
const responses = ["pending", "pending", "filled"];
await page.route("**/api/bridge-status**", async (route) => {
  const status = responses[Math.min(callCount++, responses.length - 1)];
  await route.fulfill({
    body: JSON.stringify({ status }),
  });
});
```

### Deferred responses (for testing loading states)

This pattern lets you assert the loading state exists before the response arrives:

```typescript
function createDeferredRoute() {
  let resolve!: (value: { status: number; body: string }) => void;
  const promise = new Promise<{ status: number; body: string }>((r) => { resolve = r; });
  return { promise, resolve };
}

// In test:
const deferred = createDeferredRoute();
await page.route("**/api/wallet-balances**", async (route) => {
  const response = await deferred.promise;
  await route.fulfill({
    status: response.status,
    contentType: "application/json",
    body: response.body,
  });
});

await bridgePage.goto();
// Assert loading skeleton is visible
await expect(bridgePage.balanceSkeleton).toBeVisible();

// Now resolve
deferred.resolve({ status: 200, body: JSON.stringify(mockBalances) });
// Assert loaded state
await expect(bridgePage.balanceDisplay).toBeVisible();
```

### Conditional routing by request params

```typescript
await page.route("**/api/wallet-balances**", async (route) => {
  const url = new URL(route.request().url());
  const address = url.searchParams.get("address");

  if (address?.startsWith("0x")) {
    await route.fulfill({ body: JSON.stringify(evmBalances) });
  } else {
    await route.fulfill({ body: JSON.stringify(solanaBalances) });
  }
});
```

## Layer 2: Wallet Provider Injection (page.addInitScript)

### EVM wallet mock

```typescript
await page.addInitScript((config) => {
  window.__EVM_MOCK_CONFIG__ = config;
}, { autoConnect: true });
```

The app reads `window.__EVM_MOCK_CONFIG__` and uses a mock wagmi connector that:
- Auto-connects if `autoConnect: true`
- Exposes `window.__EVM_WALLET_CONTROL__` after React hydration with `{ connect(), disconnect(), switchChain() }`

### Solana wallet mock

```typescript
await page.addInitScript((config) => {
  window.__SOLANA_MOCK_CONFIG__ = config;
}, { publicKey: "SoL...", autoConnect: true, signTransactionOutcome: "success" });
```

### Feature flag overrides

```typescript
await page.addInitScript(() => {
  window.__TEST_SHOW_ADDITIONAL_PAYMENT_METHODS__ = true;
});
```

### Hydration gate

**Always wait for wallet controls before interacting:**

```typescript
async goto() {
  await this.page.goto("/");
  await this.page.waitForFunction(() => !!window.__EVM_WALLET_CONTROL__);
}
```

This ensures React has hydrated and the test wallet control interface is mounted.

## Layer 3: Stateful Transaction Mocks

For multi-step transaction flows (approve → send → receipt), use a stateful mock:

```typescript
interface MockTxState {
  txCounter: number;
  isApprovalDone: boolean;
  pendingTxs: Map<string, { blockNumber: number }>;
  blockNumber: number;
  currentChainId: string;
}

function createTransactionMock(opts: { requiresApproval: boolean }) {
  const state: MockTxState = {
    txCounter: 0,
    isApprovalDone: false,
    pendingTxs: new Map(),
    blockNumber: 100,
    currentChainId: "0xa4b1", // Arbitrum
  };

  return {
    handleRpcRequest: async (method: string, params: any[]) => {
      switch (method) {
        case "eth_sendTransaction": {
          const isApproval = opts.requiresApproval && !state.isApprovalDone;
          const txHash = `0x${(++state.txCounter).toString(16).padStart(64, "0")}`;
          state.pendingTxs.set(txHash, { blockNumber: ++state.blockNumber });
          if (isApproval) state.isApprovalDone = true;
          return txHash;
        }
        case "eth_getTransactionReceipt": {
          const txHash = params[0];
          const pending = state.pendingTxs.get(txHash);
          if (!pending) return null;
          return { status: "0x1", blockNumber: `0x${pending.blockNumber.toString(16)}` };
        }
        // ... other methods
      }
    },
  };
}
```

### Configuration contract

When `requiresApproval` (or similar config) affects multiple layers, it must propagate consistently:

```
MockOptions.requiresApproval
  → setupApiMocks() → quote response includes approval_txns
  → setupTransactionMocks() → first eth_sendTransaction treated as approval
  → BridgePage assertions → approval step expected before swap step
```

Document this propagation chain. Mismatches cause the mock to treat the bridge tx as an approval (or vice versa).

## Layer 4: Mock Data Factories

```typescript
export function createMockQuote(overrides?: Partial<QuoteResponse>): QuoteResponse {
  return {
    from_token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    to_token: "0x...",
    from_amount: "1000000000",
    to_amount: "999500000",
    price_impact: 0.001,
    estimated_time: 120,
    provider: "across",
    fees: { total_usd: "0.50", gas_usd: "0.10" },
    ...overrides,
  };
}

export function createMockBalances(overrides?: Partial<BalanceConfig>): WalletBalance[] {
  const config = { usdcBalance: "1000000000", ethBalance: "1000000000000000000", ...overrides };
  return [
    { symbol: "USDC", balance: config.usdcBalance, chainId: 42161, /* ... */ },
    { symbol: "ETH", balance: config.ethBalance, chainId: 42161, /* ... */ },
  ];
}
```

### Edge case factories

```typescript
export function createMockBalancesEmpty(): WalletBalance[] { return []; }
export function createMockBalancesZero(): WalletBalance[] {
  return createMockBalances({ usdcBalance: "0", ethBalance: "0" });
}
```

## Layer 5: Scenario Presets

```typescript
export const scenarios = {
  happyPathPreApproved: {
    balances: createMockBalances({ usdcBalance: "1000000000" }),
    requiresApproval: false,
    bridgeProvider: "across",
    bridgeStatusSequence: ["pending", "filled"],
    transactionFlow: { bridgeOutcome: "success" },
  } satisfies MockOptions,

  insufficientBalance: {
    balances: createMockBalances({ usdcBalance: "100" }),
  } satisfies MockOptions,

  quoteError: {
    quoteResponse: "error",
  } satisfies MockOptions,

  // ... one scenario per testable state combination
};
```

**Convention:** Use `satisfies MockOptions` for type safety. Name scenarios after the state they produce, not the test that uses them.

## Error Sequence Pattern (for recovery testing)

Static error flags (`balanceError: { status: 500 }`) make ALL requests return errors. To test error→recovery, use sequences that advance per request.

### MockOptions additions

```typescript
interface MockOptions {
  // ... existing fields ...

  /** Ordered sequence of error-or-success for balance requests.
   *  null = success, object = error. Last entry repeats. */
  balanceErrorSequence?: Array<{ status: number; message: string } | null>;

  /** Ordered sequence of error-or-success for quote requests.
   *  null = success, object = error. Last entry repeats. */
  quoteErrorSequence?: Array<{ status: number; message: string } | null>;
}
```

### Route handler implementation

```typescript
const balanceErrorSequence = options.balanceErrorSequence;
let balanceErrorSeqIndex = 0;

await page.route("**/api/wallet-balances*", async (route) => {
  // Error sequence takes precedence over static error flag
  if (balanceErrorSequence) {
    const entry =
      balanceErrorSequence[
        Math.min(balanceErrorSeqIndex, balanceErrorSequence.length - 1)
      ];
    if (balanceErrorSeqIndex < balanceErrorSequence.length - 1) {
      balanceErrorSeqIndex += 1;
    }
    if (entry !== null) {
      await route.fulfill({
        status: entry.status,
        contentType: "application/json",
        body: JSON.stringify({ detail: entry.message }),
      });
      return;
    }
    // entry is null → fall through to success response
  } else if (options.balanceError) {
    // Static error flag — all requests fail
    await route.fulfill({ status: options.balanceError.status, ... });
    return;
  }

  // Success response...
});
```

### Usage in tests

```typescript
// Quote error → recovery by changing amount
test("quote error recovers when user changes amount", async ({
  setupMocks, bridgeBuyPage,
}) => {
  await setupMocks({
    ...scenarios.happyPathPreApproved,
    quoteErrorSequence: [
      { status: 500, message: "Quote service unavailable" },
      null, // second request succeeds
    ],
  });

  await bridgeBuyPage.goto();
  await bridgeBuyPage.connectEvmWallet({ force: true });
  await bridgeBuyPage.enterReceiveAmount("100");  // → 500 error
  await bridgeBuyPage.expectButtonState(CTA_BUTTON_STATE.QUOTE_ERROR);

  await bridgeBuyPage.enterReceiveAmount("120");  // → new query key → success
  await bridgeBuyPage.waitForQuote();
  await bridgeBuyPage.expectButtonState(CTA_BUTTON_STATE.READY);
});
```

### When error sequences DON'T work: parent-managed state

Error sequences fix the **mock layer** but won't help when the **component architecture** prevents recovery. Example:

1. Bridge interface fetches balances at its own level via `useWalletBalances`
2. Passes results as `balancesOverride` to `TokenSelector`
3. `TokenSelector` sees override → disables its own balance hook
4. Retry button in `TokenSelector` calls `refetch()` on the disabled hook → no-op
5. Error state driven by `__TEST_BALANCE_ERROR__` window flag, not actual API response

In this case, even with a perfect error sequence mock, the retry button won't trigger a new API call. The recovery path is architecturally broken.

**How to identify this:** If your test clicks a retry button and the error state persists despite the mock being ready to return success, trace the data flow from the API through hooks to the component. Look for `enabled: false` on the hook that `refetch()` targets.

**What to do:** File a real bug. The retry mechanism doesn't work in the composed context, even if it works in the component's standalone tests.
