# Feature Flags / Geo-Gating / Rollout Domain Checklist

> **Read `reviewer_discipline.md` first.** The two discipline rules (comment-vs-code divergence, cross-file exit-path reasoning) override domain/lens-specific heuristics where they conflict.

Mostly High severity — compliance risk when gates fail open or initial state is permissive.

## Categories

### 1. gate-fails-open-on-error (High)
Geo or feature gate's catch block returns `true` / eligible. API error = user gets access.

**Check:**
- `rg -B 2 -A 5 "catch"` near eligibility / geo / feature-flag code.
- `return true` or `return { eligible: true }` inside a catch → flag HIGH.
- Principle: on error, **default-deny** for gated features.

### 2. hardcoded-initial-state (High)
`useState('NG')` or `useState(true)` for `isEligible` — initial render permits access before gate resolves.

**Check:**
- `rg "useState\(['\"][A-Z]{2}['\"]\)"` — hardcoded country codes.
- `rg "useState\(true\)"` / `useState(false)` on eligibility flags — initial state should be "unknown" / `null`, not "allowed".

### 3. deep-link-bypasses-gate (High)
User lands on a gated route directly; the deep-link effect fires before the gate query resolves, so the redirect / block never triggers.

**Check:**
- Any `useEffect(() => { redirectTo... })` or `router.replace()` that fires on mount without also depending on `gateReady` / `isLoaded`.
- Routes that should be gated must check `gate === 'allowed'`, not `gate !== 'blocked'` (which treats `'loading'` as allowed).

### 4. loading-state-traps-user (Medium)
Geo fetch fails → `isLoading` stays true forever or user lands on a blank page.

**Check:**
- All geo / flag fetchers must have a finite error state distinct from "still loading".
- UI must render a recoverable error (retry button, fallback copy) when the fetch fails.

### 5. feature-flag-payment-bypass (High)
Disabled payment method (Apple Pay, card) is still accessible via deep link when the gate flag is off.

**Check:**
- Any "disabled payment method" check must run on both the method-list UI AND the deep-link entry points.
- `rg "isApplePayEnabled|isCardEnabled"` — usage count should match the count of payment-method entry points.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files.
