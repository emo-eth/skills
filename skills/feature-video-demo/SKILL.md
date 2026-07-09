---
name: feature-video-demo
description: This skill should be used when creating Playwright-based video demos of user flows for features, bug reproductions, or compliance demos. It produces deterministic WebM recordings with fake cursors showing realistic user interactions — no QuickTime or OBS required.
---

# Feature Video Demo

Create programmatic video recordings of user flows using Playwright. Each demo is a `.demo.ts` spec that Playwright runs with video capture enabled, producing a WebM file showing a realistic user interaction.

## When to Use

- Recording a demo video of a feature for stakeholders, PRs, or Slack
- Showing what happens when a user hits an error state, block, or edge case
- Creating reproducible visual evidence of a UI flow
- Any time someone says "can we get a video of X"

## Infrastructure Setup

### 1. Create `playwright.demo.config.ts`

Each package that needs demos gets its own config. Use the template in `assets/playwright.demo.config.template.ts` as a starting point. Update the default port to match the package's convention (check existing `playwright.config.ts` or `package.json` scripts).

**Critical**: Do NOT use `testMatch: "**/*.spec.ts"` with `testIgnore` for demos. The `testIgnore` pattern blocks files even when explicitly targeted. A separate config with `testMatch: "**/*.demo.ts"` is the only reliable approach.

### 2. Create shared helpers and demo directory

```
packages/<app>/e2e/demos/
├── demo-helpers.ts      ← copy from assets/demo-helpers.template.ts
└── my-feature.demo.ts   ← demo specs import from demo-helpers
```

Always create `demo-helpers.ts` as a real importable module. Do NOT inline `FAKE_CURSOR_SCRIPT` or `moveCursorUntilVisible` into each spec — this causes duplication across demos.

## Writing Demo Specs

### Fake Cursor

Playwright video does not capture the real mouse cursor. Import `FAKE_CURSOR_SCRIPT` from `demo-helpers.ts` and inject via `page.addInitScript()` — or use the `startDemoScene` helper which does this automatically.

**Critical**: The init script runs before `document.body` exists. The cursor script includes a `DOMContentLoaded` guard. Do NOT remove it — without it, `document.body.appendChild(cursor)` silently fails and no cursor appears.

### Page Warm-up

Next.js dev server compiles pages on first visit, causing 5-10 seconds of white screen. Use the `warmUpPages` helper in `test.beforeAll`:

```typescript
import { warmUpPages } from "./demo-helpers";

const demoBaseUrl = `http://localhost:${process.env.E2E_PORT ?? "3000"}`;

test.beforeAll(async ({ browser }) => {
  await warmUpPages(browser, demoBaseUrl, ["/page-1", "/page-2"]);
});
```

**Critical**: Do NOT use a separate warm-up `test()` — it produces a useless video artifact (white/error screen) in the output directory.

**Critical**: `beforeAll` does not have access to test fixtures like `page`. The `warmUpPages` helper handles this by creating its own page from `browser`.

### Avoiding Blank Screens

- Use `waitForLoadState("domcontentloaded")` after `page.goto()`, NOT `"networkidle"`.
  `networkidle` blocks until ALL pending requests complete. If a mock API has a delay, `networkidle` waits for that delay to elapse — producing a blank screen in the video for the entire duration.
- Follow with a short `waitForTimeout(1000-1200)` to let React hydrate and render.
- Or use `startDemoScene(page, route)` which handles both.

### Telling a Story

**The #1 rule**: Every demo must show a causal flow — visible user actions leading to the outcome. A modal that appears "out of nowhere" on a static page is confusing even to the person who built the feature.

Pattern:

1. Navigate to the page
2. Show the cursor moving, hovering over elements
3. Click through the flow (select options, fill forms, click buttons)
4. The state change appears as a consequence of the user's actions

### Keeping the Cursor Alive

During async waits, the cursor should keep moving so the video looks alive. Use `moveCursorUntilVisible` from `demo-helpers.ts`:

```typescript
import { moveCursorUntilVisible } from "./demo-helpers";

const alert = page.locator('[role="alert"]').filter({ hasText: /flagged/ });
await moveCursorUntilVisible(page, alert, 4_000);
await expect(alert).toBeVisible({ timeout: 8_000 });
```

### Timing Guidelines

| Phase | Duration | Notes |
|-------|----------|-------|
| Page load + render | 1-1.5s | `startDemoScene` handles this |
| Hover/browse | 0.4-0.6s per element | Shows user intent |
| Click + wait for UI | 0.3-0.5s | `force: true` if overlays may intercept |
| Async result wait | Use `moveCursorUntilVisible` | Keeps video alive |
| Hold on final state | 2-3s | Let the viewer read the outcome |
| **Total target** | **8-15s** | Tight, focused videos |

### Tips

- Use `{ force: true }` for clicks — browser extensions can inject invisible overlays that intercept pointer events.
- Filter locators by content (e.g., `.filter({ hasText: /flagged/ })`) to avoid matching elements injected by browser extensions.
- Extract multi-step UI interactions into named helper functions (e.g., `connectWalletFromSelector`) for readability and reuse across tests in the same file.
- A single `.demo.ts` file can contain multiple `test()` blocks, each producing its own video. Name them sequentially (Part 1, Part 2) and ensure `beforeAll` warms up all pages needed by all parts.

## Mock Configuration

Demos use the same `setupMocks` fixture as regular E2E specs (imported from `../fixtures/test-base`). Common configuration keys:

| Key | Purpose |
|-----|---------|
| `evmMockConfig` | `{ autoConnect, address, chainId }` — controls mock wallet behavior |
| `screening` | `{ status, reason }` — mock response for `/api/screening/check` |
| `screeningDelay` | Milliseconds to delay the screening response |
| `balances` | `{ usdcBalance, ethBalance }` — mock token balances |
| `linkedAccounts` | Array of `{ address, name }` — mock linked wallet accounts |

The exact shape varies by package — check the package's `e2e/fixtures/test-base.ts` for the full `MockOptions` interface.

### Preventing Mock Artifacts

**"Connected wallet differs" banner**: This appears when the mock wallet address doesn't match mock linked accounts. Fix by passing `linkedAccounts` with an address matching the mock wallet:

```typescript
const MOCK_LINKED_WALLET = {
  address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // TEST_ADDRESS from wagmi-config
  name: "Demo Wallet",
};

await setupMocks({
  evmMockConfig: { autoConnect: true },
  linkedAccounts: [MOCK_LINKED_WALLET],
  // ...
});
```

## Running Demos

```bash
# From the package directory:
PW_DEV_SERVER=true npx playwright test --config playwright.demo.config.ts

# With headed browser (watch it run):
PW_DEV_SERVER=true npx playwright test --config playwright.demo.config.ts --headed

# Reuse existing dev server (faster iteration):
PW_DEV_SERVER=true PW_REUSE_SERVER=true npx playwright test --config playwright.demo.config.ts
```

Video output lands in `test-results/<test-name>/video.webm`.

## Checklist

Before considering a demo spec complete:

- [ ] Video starts with content visible (no white screen from compilation)
- [ ] Fake cursor is visible and tracks mouse movements throughout
- [ ] User actions are visible before any state change (modal, overlay, error)
- [ ] Cursor keeps moving during async waits (not frozen on static page)
- [ ] Total video length is under 15 seconds
- [ ] No mock-artifact warnings visible (wallet mismatch, etc.)
- [ ] `FAKE_CURSOR_SCRIPT` and `moveCursorUntilVisible` imported from shared `demo-helpers.ts`, not inlined
- [ ] Video file is in test-results/ and plays in Slack/browser
