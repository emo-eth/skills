# State Dimension Discovery Guide

How to systematically find every independent state axis in a Next.js web3 application.

## The Process

### Step 1: Trace the component tree

For each page route, recursively read every component and catalog:
- Props it accepts (especially boolean flags, enums, union types)
- Hooks it calls (especially `useState`, custom hooks returning status objects)
- Context it reads
- Conditional rendering (`{condition && <Component />}`, ternary operators)
- `data-testid` attributes

### Step 2: Find the independent variables

For each conditional rendering or conditional style, trace back to the **root cause**:
- Is it a prop? → What controls that prop?
- Is it derived from a hook? → What inputs does the hook take?
- Is it from context? → What sets that context value?

Keep tracing until you find the **independent variable** — something the test can directly control (mock config, user action, feature flag).

### Step 3: Group by independence

Two state axes are **independent** if changing one doesn't force the other to change:
- Wallet connection and quote status are independent (you can be connected with no quote)
- CTA button state and form amount are NOT independent (CTA derives from amount)

Dependent states should be modeled as **derived states** within the machine that owns the independent variable, not as separate machines.

### Step 4: Classify each dimension

| Classification | Model as | Example |
|---|---|---|
| Sequential flow (A → B → C) | Single machine with linear states | Bridge UI flow |
| Validation cascade (priority-ordered checks) | Machine with context-guarded transitions | CTA button state |
| Independent toggle | Machine or simple mock config | Buy/sell mode |
| Async lifecycle (request → response) | Scenario-driven tests | Quote loading |
| Feature flag gating | Mock config, not a machine | Funding method visibility |

## Web3-Specific Dimensions

### Wallet states (per chain type)

For each wallet type (EVM, Solana), the testable states are:
- **disconnected** — No wallet connected
- **connected** — Wallet connected, correct network
- **wrong_network** — Wallet connected, wrong chain (EVM only)

**"Connecting" is usually NOT a testable state** in E2E with mocks. Mock wallets connect synchronously via `window.__WALLET_CONTROL__.connect()`. There's no spinner to assert on. Only model it if your app shows a loading UI during connection AND the mock supports delaying the connection.

### Multi-wallet combinations

If your app supports multiple wallet types simultaneously:
```
none          — Neither connected
evm_only      — EVM connected, Solana not
solana_only   — Solana connected, EVM not
both          — Both connected
```

This is a **separate dimension** from individual wallet states because the combination affects token visibility, bridge routes, and CTA behavior in ways the individual states don't capture.

### Balance states

Balances are per-token per-chain, but for testing purposes, the relevant states are:
```
no_wallet     — Can't fetch (no wallet connected)
loading       — API request in flight (use deferred response mock)
loaded        — Has balance data
error         — API returned error
zero          — Balance is 0
insufficient  — Balance < entered amount
```

**Testing "loading"** requires the deferred response pattern — the mock holds the response until the test explicitly resolves it.

### Token selection

Auto-selection logic often has subtle state:
```
default           — Default token for the mode (e.g., USDC for buy)
auto_selected     — Highest-balance token auto-picked on wallet connect
manually_selected — User explicitly picked from selector (persists across reconnects)
```

**Key behavior to test:** Manual selection should persist when the wallet disconnects and reconnects. Auto-selection should only run once per wallet address.

### Destination address

Whether a destination address is required depends on the destination chain:
```
not_required    — Destination chain auto-routes (e.g., HyperCore)
required_empty  — Needs address, none entered
invalid         — Address entered but wrong format
valid           — Valid address for destination chain type
```

### Quote states

```
idle            — No amount entered, no quote requested
loading         — Quote API request in flight
loaded          — Quote received
error           — Quote API failed
below_minimum   — Amount below minimum bridge threshold
```

### CTA validation cascade

The CTA button typically implements a **priority-ordered validation cascade** — the first failing check determines the button state:

1. No wallet → show "Connect Wallet" (enabled)
2. No amount → "Enter an Amount" (disabled)
3. Below minimum → "Minimum $X" (disabled)
4. Exceeds balance → "Insufficient Balance" (disabled)
5. Destination required but empty → "Enter Destination" (disabled)
6. Destination invalid → "Invalid Address" (disabled)
7. Quote error → "Unable to Bridge" (disabled)
8. High price impact → "Confirm" with warning (enabled)
9. All valid → "Continue" / "Confirm" (enabled)

This is best modeled as a machine with **context guards**, not separate events, because the priority order matters and `@xstate/graph` can enumerate context combinations.

### Funding methods

Feature-flagged + locality-filtered:
```
wallet_only   — Only wallet method visible (flag off OR locality restricts)
multiple      — Multiple methods visible (wallet + ACH + Apple Pay)
```

Control via:
- `window.__TEST_SHOW_ADDITIONAL_PAYMENT_METHODS__ = true` (feature flag override)
- Locality cookie/header mock

## What NOT to Model

- **Dev-only tools** — Debug panels, hotkey-activated state overrides
- **Transient animations** — GSAP transitions, crossfades, spring entrances
- **Server-only states** — SSR render states the user never sees
- **Instantaneous mock states** — "Connecting" when mocks connect synchronously
- **Internal component state** — Popover open/closed (unless it affects other dimensions)
