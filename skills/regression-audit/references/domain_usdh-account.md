# `usdh-account` Partial-Revert Checklist

> **Read `reviewer_discipline.md` first.** The discipline rules (message-vs-code divergence, `origin/dev` cross-check, regressions-not-fresh-bugs) override domain-specific heuristics where they conflict.

`packages/usdh-account` (the customer portfolio app at `localhost:4100`) is the highest-frequency source of silent partial reverts. Branches in this package that are labeled "cleanup", "shared-package migration", or "refactor" routinely drop analytics, KYC wiring, or route fields. For each category: what to grep and what to verify against `origin/dev`.

## Categories

### 1. analytics-capture-removed
PostHog event constants or capture sites removed, typically under "shared migration" framing.

**Check:**
- `git diff origin/dev -- packages/usdh-account/src/lib/analytics/events.ts` — any deleted `export const` line is a candidate.
- `git diff origin/dev -- 'packages/usdh-account/**/*.tsx' 'packages/usdh-account/**/*.ts'` filtered for removed `posthog.capture(` calls.
- Cross-check: `rg -n "<CONSTANT_NAME>"` in working tree for consumers that still reference the removed constant.
- `usdh-account` funnel instrumentation (sign-up → KYC submitted → KYC approved → first deposit) is load-bearing for growth reporting. Do NOT silently drop.

### 2. kyc-field-dropped
Bridge KYC status fields removed from hooks or types, breaking downstream KYC UI.

**Check:**
- `git show origin/dev:packages/usdh-account/src/hooks/use-onboarding-status.ts` vs branch — flag removal of `bridge_kyc_status_updated_at`, `bridge_customer_status`, or `rejected_reasons`.
- `rg -n "bridge_kyc_status_updated_at|bridge_customer_status"` for consumers expecting these fields.
- Any switch to a shared `@nm/ts-common/*` type that narrows the interface is suspect.

### 3. kyc-copy-or-state-removed
KYC rejection copy, grace-period, or funnel-entry components removed.

**Check:**
- `git diff origin/dev -- packages/usdh-account/src/lib/ui-text-constants.ts` for deleted rejection / grace-period strings.
- `git log origin/dev --oneline -- packages/usdh-account/src/components/kyc/` — look for recent adds the branch reverts.
- Flag removal of rejected-state banners, grace-period countdowns, KYC funnel-entry CTAs.

### 4. portfolio-route-field-drop
`/api/portfolio` or `/api/earn/earnings` route fields dropped.

**Check:**
- `git diff origin/dev -- packages/usdh-account/src/app/api/portfolio/route.ts` — flag removed fields (HyperCore spot balances, HyperEVM base-token balances, earn positions, prices).
- `git diff origin/dev -- packages/usdh-account/src/app/api/earn/earnings/route.ts` — any returned-field removal is High severity; the client expects them.
- Cross-check the client: `rg -n "useQuery.*portfolio|useQuery.*earnings"` for destructuring that will silently see `undefined`.

### 5. zerion-reintroduction
Zerion being re-added to `/api/portfolio`. This was intentionally removed — DO NOT re-add.

**Check:**
- `rg -n "ZERION_API_KEY|zerion" packages/usdh-account/src/app/api/portfolio/`
- Zerion belongs only in non-Hyperliquid chain balance fetching paths within `usdh-account`, not in `/api/portfolio`.
- If reintroduced, High severity and name the commit that originally removed it (search `git log --all --oneline --grep=zerion` for context).

### 6. secret-symmetry-break
Mismatched secret env vars between `packages/api` and `packages/usdh-account`.

**Check:**
- `git diff origin/dev -- packages/usdh-account/.env.sample packages/usdh-account/src/**` for `USDH_QUOTE_SECRET` or `ONCHAIN_ACTIVITY_SECRET` changes.
- Flag any asymmetric change: if `packages/usdh-account` expects `ONCHAIN_ACTIVITY_SECRET` but `packages/api`'s handling of it is unchanged on the branch (or vice versa), the pair is broken.
- These secrets must match across both packages' env files.

### 7. clerk-auth-boundary-change
Clerk-authed route boundaries weakened or bypassed.

**Check:**
- `git diff origin/dev -- packages/usdh-account/src/app/api/**/route.ts` for removed `auth()` / `currentUser()` checks.
- `middleware.ts` changes that widen public matchers.
- Any route that was previously Clerk-authed becoming public is High severity.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files. See `finding_format.md`.

Only report regressions actually present in the current branch vs. `origin/dev`. Don't flag fresh bugs or upstream code you merely read while investigating.
