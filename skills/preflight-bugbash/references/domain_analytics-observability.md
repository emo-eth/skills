# Analytics / Observability Domain Checklist

> **Read `reviewer_discipline.md` first.** The two discipline rules (comment-vs-code divergence, cross-file exit-path reasoning) override domain/lens-specific heuristics where they conflict.

Covers PostHog lifecycle, named-constant drift, Sentry regressions, and PII.

## Categories

### 1. posthog-super-property-lifecycle (High)
Super properties registered during a flow but cleanup `unregister`s them while the flow is still active; `setPersonProperties(null)` on unmount mid-swap.

**Check:**
- `useEffect` cleanups calling `posthog.unregister(...)`, `setPersonProperties(null)`, `reset()` — verify the flow has ended, not just the component unmounted.
- Long-running flows (swap, transfer) should register super props at flow start and unregister at flow end, not component mount/unmount.

### 2. event-named-constants (Medium)
Inline string event names drift across callers; `KYC_FLOW_STARTED` missing documented `return_to` property.

**Check:**
- `rg "posthog\.capture\(['\"]"` — inline strings, no named constant → flag.
- Every event should have a documented property contract; missing a documented property = flag.

### 3. stale-closure-in-analytics (Medium)
`transfer_completed` event captures a closed-over `false` from initial render.

**Check:**
- `posthog.capture(...)` inside `setInterval` / `setTimeout` / async polling, reading state not in deps.

### 4. sentry-integration-regressed (High)
`Sentry.init(...)` removed or never wired in a package; errors silently disappear.

**Check:**
- In diff, any *removal* of `Sentry.init` or `withSentry` → flag HIGH.
- New entry points (server, edge, worker) must have Sentry initialized.

### 5. client-log-never-fires (Low/Medium)
`log.debug` on a client entry point in a logger that only forwards to a server sink.

**Check:**
- `rg "log\.debug\("` in files with `'use client'`.
- Verify the logger library actually ships client-side events (PostHog logger vs server-only logger).

### 6. pii-in-logs / verbose-payloads (High)
Serializing large request/response objects per transaction; `body_b64` debug field; `bank_` prefix redaction exemption.

**Check:**
- `rg "fmt\.Sprintf\(\"%\+v\""` in handlers — full struct dumps leak PII.
- `body_b64` / `body_sha256` full digest fields in webhook paths.
- Redaction allowlists with overly broad prefixes (`bank_`, `user_`).

### 7. false-success-analytics (Medium)
Event with `success: true` fires from a catch/failure branch.

**Check:**
- Search for event names with `_completed` / `_success` — trace the caller; ensure it only fires on the success path.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files.
