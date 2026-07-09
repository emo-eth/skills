# Dispatch Rules

Source of truth for the classifier (`scripts/classify_diff.sh`). Document the rules here so they can be audited without reading shell.

## Domains

### go
- Any file matching `*.go`.

### typescript-next
- `*.ts`, `*.tsx`, `*.jsx`, `*.svelte`
- Any file under `packages/usdh/`, `packages/usdh-account/`, `packages/dashboard/`, `packages/nativemarkets.com/`

### terraform
- `*.tf`, `*.tfvars`
- Any file under `packages/deploy/` or any `terraform/` directory

### database
Path-based:
- `packages/db/**`
- `*/queries/*.go`
- `*.sql`
- `*/migrations/**`

Content-based (added lines in hunk match):
- `WithTx`, `Unscoped`, `GORM`, `.Where(`, `COALESCE`, `ON CONFLICT`, `Preload(`

### permissions-secrets
Path-based:
- `packages/api/internal/api/routes/**`
- Any path containing `middleware` or `/auth/`
- `.env*` files
- `packages/deploy/**`
- New route files: `*/app/api/*/route.ts(x)`, `packages/api/internal/api/routes/*/*.go`

Content-based — literal keywords:
- `secret`, `SECRET`, `token`, `TOKEN`, `credential`
- `organization_id`
- `OR ` inside a `Where(` call
- `webhook`, `signature`, `HMAC`, `sha256`
- `NEXT_PUBLIC_`

Content-based — new surfaces (wide net, subagent judges):
- New exported Go identifier: `^+(func|var|const|type) [A-Z]`
- New exported TS/JS identifier: `^+export (const|function|class|let|var|async function|default) `
- New env var read: `process.env.*`, `os.Getenv(`, `os.LookupEnv(`

### money-currency
Content-based only:
- `AmountToCents`, `CurrencyUSD`, `szDecimals`, `floatToWire`, `toFixed`
- `ParseFloat`, `decimals`, `Decimals`
- `?? 0` or `|| 0` (nullish/zero fallbacks)
- word `cents`

### feature-flags-geo
Content-based only:
- `featureFlag`, `isFeatureEnabled`
- `geo`, `eligibility`, `isEligible`
- `allowedCountries`, `blockedCountries`
- `GrowthBook`
- `posthog.*feature`

### analytics-observability
Content-based only:
- `posthog.capture`, `PostHog`, `registerSuper`, `setPersonProperties`
- `Sentry`, `captureException`
- `log.debug`, `log.info`, `log.warn`, `log.error`
- `super*propert` (super properties)

### idempotency-webhooks
Path-based:
- Any path containing `webhook` / `Webhook`
- `packages/api/internal/api/routes/*/webhook*`
- `packages/jobs/*/webhook*`

Content-based:
- `webhook`, `Webhook`
- `WithTx`, `Transaction(`, `BeginTx`
- `HMAC`, `X-Signature`, `signature`
- `idempoten`, `retryable`

### test-fixture-drift
Path-based only:
- `*_test.go`, `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`
- `e2e/fixtures/**`, `**/__mocks__/**`
- `.github/workflows/**`, `.pre-commit-scripts/**`, `scripts/ci-*`

## Always-on lenses (no classification)

These three lens subagents run on **every** non-trivial diff regardless of what files changed:
- `lens_staff-eng-correctness` — holistic senior-engineer correctness review (contract drift, edge cases, invariants, migration ordering)
- `lens_security-auth` — cross-cutting security posture (trust boundaries, crypto, CORS, supply chain, DoS)
- `lens_performance-cost` — N+1s, unbounded fanout, over-eager preload, cloud-spend

They complement the pattern-matching domain subagents and catch issues orthogonal to any single area.

## Always-on vs conditional domains

- On any non-trivial diff: `permissions-secrets` runs (even if only matched by path/content signals lightly) — most High-severity BugBot findings live here.
- If the diff contains any Go: `go` runs.
- If the diff contains any TS/TSX/Svelte: `typescript-next` runs.
- `terraform`, `database`, `money-currency`, `feature-flags-geo`, `analytics-observability`, `idempotency-webhooks`, `test-fixture-drift` run strictly when matched.

## Why content-based matters

Many domains don't cleanly map to file extensions. A Go handler file might also be a money/currency file if the hunk touches `AmountToCents`. A TS component might trigger the feature-flags-geo domain only when the hunk mentions `isFeatureEnabled`. Classifying on extension alone would miss these — that's how historical BugBot findings slipped through human review.

## How content-based classification reads the diff

Classifier extracts each file's added lines (`^+` lines, excluding `^+++` metadata) from `git diff <base>...HEAD` and from `git diff HEAD` (uncommitted). For each pattern, if any added line in a file matches, that file is added to the relevant domain bucket.

This deliberately ignores removed lines — the PR author is adding a bug, not removing one.
