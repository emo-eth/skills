# TypeScript / Next.js Domain Checklist

> **Read `reviewer_discipline.md` first.** The two discipline rules (comment-vs-code divergence, cross-file exit-path reasoning) override domain/lens-specific heuristics where they conflict.

Recurring TS/TSX patterns. Covers both pure TS logic and React/Next-specific bugs.

## Pure TS categories

### nullish-vs-or-fallback
`||` instead of `??` on numeric/zero paths drops valid zero; removed hardcoded default leaves `undefined`.

**Check:**
- `rg "\|\| "` in diff hunks — flag if left operand can legitimately be `0` or `""`.
- Removed fallback constants: compare deleted-lines side of diff for defaults, ensure replacement keeps a safe default.

### duplicated-logic-across-packages — BIGGEST TS PATTERN
Same helper copied into `usdh`, `usdh-account`, `dashboard`, etc. Drift is inevitable.

**Check:**
- For every new helper/constant in `packages/*/src/`, `rg <symbol>` across `packages/` — if it appears in 2+ packages, flag.
- Common culprits: `getCurrencyFamily`, `hypercore-api`, `trace-log-fields`, `wagmi-config`, country lists.

### currency-amount-math
Hardcoded minimums (`< 3`), `toFixed(2)` on JPY, `floatToWire` double-conversion, szDecimals truncation missed.

**Check:**
- `rg "=== 3|< 3|toFixed\(2\)"` — flag when near non-USD currency paths.
- `rg "floatToWire"` — verify not called twice in a chain.
- `rg "sourceAmountWithoutFees"` — must guard zero denominator.

### schema-and-validation-misuse
Zod `superRefine` inside `z.discriminatedUnion` silently breaks discrimination; schemas require US-only fields for non-US paths.

**Check:**
- `rg -A 5 "discriminatedUnion"` — if any arm has `superRefine`, flag.
- Required `state` / `zip` fields on schemas that also accept non-US addresses.

### route-matching-and-dedup
`.find(` / `.filter(` on route/transfer records comparing partial key sets.

**Check:**
- `rg "\.find\(|\.filter\(" ` in `*route*.ts` or `*transfer*.ts`. Verify all required keys (rail, reference, destination) are in the predicate.

### server-config-hardcoded-urls
`https://` literal in `src/lib/server/*.ts`; REST endpoint added to RPC array.

**Check:**
- `rg "https://" src/lib/server/` — must be env-based.
- RPC arrays (`viem` / `wagmi` configs) should only contain RPC endpoints, not `/api/` or `/info` paths.

### error-handling-and-logging-regressions
`catch` overwrites retry error with original; Sentry init dropped; `status: 'complete'` reported on failure.

**Check:**
- `rg "Sentry\.init"` in `packages/*/src/` — if removed in diff, flag HIGH.
- Status-reporting code: success literal fired from a caught-failure branch.

### missing-auth-or-rate-limit
Public route creates resources without rate-limiter; static secret lacks prod guard.

**Check:**
- New files under `app/api/**/route.ts` / `src/routes/api/**` — must have a `rateLimit*` wrapper if they POST/create.
- `process.env.*_SECRET` without `if (process.env.NODE_ENV === 'production')` guard.

## React / Next.js categories

### hook-rules-violations
Hooks after conditional early return; `useMemo`/`useEffect` with unstable deps.

**Check:**
- Search diff for `return null` or `return <.../>` above a `useXxx(` call — classic violation.
- `useMemo(..., [obj])` where `obj` is a new object literal → always recomputes.

### stale-closure-in-polling-or-async
`setInterval`/`setTimeout` reading state not in deps; refetch result dropped, stale value sent.

**Check:**
- `rg "setInterval|setTimeout"` inside hook bodies. Verify all captured state is in deps.
- Refetch that returns a Promise but the caller awaits then uses prior value.

### effect-cleanup-missing-abort
`useEffect` with `await`/`fetch` but no `AbortController` or stale-guard; cleanup unregisters still-active state.

**Check:**
- `useEffect` body with `async` / `fetch(` and no `return () =>` or `controller.abort()`.
- Cleanup calling `unregister`, `setPersonProperties(null)` during active flows.

### invalid-dom-and-nested-interactive
`<button>` inside `<button>`; `stopPropagation` breaks parent selection; nested modals.

**Check:**
- `rg "<Button.*<Button|<button.*<button"` with multiline.
- `onClick={(e) => e.stopPropagation()` inside a row/card that's itself clickable.

### geo-gate-and-feature-flag-race — HIGHEST-SEV CLUSTER
Loading / error states allow deep-link bypass; default-permissive initial state; gate catch returns `true`.

**Check:**
- Initial state literals (`useState('NG')`, `useState(true)` for `isEligible`).
- Catch blocks that `return true` (fail-open).
- Deep-link `useEffect` firing before gate query resolved.

### client-only-api-in-wrong-boundary
`ip: false` (deprecated PostHog browser option); client-side `log.debug` never fires; server constants imported into `'use client'` files.

**Check:**
- `rg "ip: false"` in PostHog init — deprecated.
- `rg "log\.debug\(" ` in files with `'use client'` directive.
- Imports of `@/lib/server/*` in client components.

### ui-state-not-reset-between-flows
New `useState` added but `resetFlow`/`onClose` not updated; success UI fires on timeout/error.

**Check:**
- Diff added `useState(` in a flow component; verify `resetFlow` / `onClose` / `onDismiss` also updated.
- `confetti` / success animations fired from a caught-error or timeout branch.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files. See `finding_format.md`.
