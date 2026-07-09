# Permissions / Secrets / Scope Domain Checklist

> **Read `reviewer_discipline.md` first.** The two discipline rules (comment-vs-code divergence, cross-file exit-path reasoning) override domain/lens-specific heuristics where they conflict.

Highest-severity cluster spanning auth, webhooks, secrets, and PII. Many of these are High severity — pay attention.

## Categories

### 1. tenant-org-isolation-break (High)
Queries load or match records without an `organization_id` predicate; OR-precedence mistakes widen scope across tenants.

**Check:**
- `rg "GetAll|ListAll|FindAll" packages/api` without `.Where("organization_id"` nearby.
- `rg -E "\.Where\(.*OR "` — OR groups MUST be wrapped in parens or use expression builders. Missing parens = cross-org leak.
- New handlers under `packages/api/internal/api/routes/**` missing the standard org middleware/context extraction.

### 2. webhook-signature-handling (High)
Wrong signing algorithm, PII logging in signature path, 500 on unsignable traffic instead of graceful skip.

**Check:**
- `rg "sha256|hmac|Signature-Hex" packages/api/internal/api/routes/*_webhooks/` — compare against provider's official spec. Bridge is single-SHA-256, not double.
- `body_b64`, `body_sha256`, full-digest log fields in webhook paths → HIGH, remove before merge.
- `rg "bridge_webhooks|stripe_webhooks|meld_webhooks"` — inspect diff for new debug fields.

### 3. bootstrap-login-auth-misuse (High)
Public bootstrap endpoint reuses a non-auth secret for authN, lacks rate limiting, or uses fragile error-string matching for account existence.

**Check:**
- `rg "bootstrap" packages/api/internal/api/routes/usdh_login/ packages/usdh-account/src/app/api/login/`.
- Every `/api/login/*` route must have a `rateLimit*` wrapper.
- `rg "QuoteSecret|QUOTE_SECRET"` — a "quote" secret being used for authN is a smell.

### 4. internal-auth-token-static-frontend-secret (Medium)
`fetchInternalAuthToken` duplicated between services; no prod guard on static shared secret that could be bundled into frontend; dead invalidation helpers.

**Check:**
- `rg "fetchInternalAuthToken|INTERNAL_AUTH" packages/usdh/ packages/usdh-account/`.
- Any frontend-reachable file must NOT import server-only secret constants (`"use server"` or `/src/lib/server/` segmentation).
- Static-secret branches must be gated by `if (process.env.NODE_ENV === 'production')`.

### 5. waf-bypass-rules (High)
Unanchored regex, method-agnostic allow, priority fallthrough on WAF bypass rules. See terraform domain for full checklist.

### 6. secrets-credentials-in-source (Medium)
Hardcoded dev creds, real emails, swapped GCP secret refs, missing TF wiring for declared secrets, secret fan-out to services that don't need it.

**Check:**
- `rg -E "API_KEY|SECRET|TOKEN|PASSWORD" packages/*/Makefile scripts/ .env.sample`.
- `rg "google_secret_manager_secret_version" packages/*/terraform/` — every reference must have a consumer.
- Real `@` email domains in `packages/jobs/internal/*/handler.go` → flag.

### 7. suspicious-new-surfaces (High when applicable)
Classifier flags diffs that add new *surfaces* — exported identifiers, new route files, new env var reads, new exported config. These are the places where permission/secret mistakes most commonly get introduced. For each flagged surface, apply judgment:

**Check each new surface for:**
- **New exported Go identifier** (`func Foo(`, `var Foo`, `const Foo` at package level, starting capital): is it safe to call from any tenant context? Does it internally enforce `organization_id`? Does it read a secret / env var? Could a caller from another package accidentally bypass scoping?
- **New exported TS identifier** (`export function`, `export const`, `export class`): if it's server-only, is it in `/src/lib/server/` or a `"use server"` module? Could it be accidentally imported client-side?
- **New route file** (`app/api/**/route.ts`, `packages/api/internal/api/routes/**/handler.go`): does the handler extract `organization_id`/tenant from auth context BEFORE any DB query? Does it have rate-limit middleware? Does it validate every user input reaching a DB/HTTP sink?
- **New `process.env.X` or `os.Getenv("X")` read**: is X a secret? If yes — is it read from Google Secret Manager / proper secret store, not committed? If X is prefixed `NEXT_PUBLIC_`, is it actually safe to ship to browsers? Is the fallback value safe when X is unset in dev?

This is LLM-judgment work. The classifier casts a wide net ("here's every new exported surface"); you apply reasoning to decide which are actually risky. Err on the side of flagging — a false positive the user dismisses costs nothing; a missed tenant leak is High severity.

### 8. pii-leakage-in-logs (High)
Log redaction exemptions too broad; temporary debug logs committed to prod.

**Check:**
- `rg "bank_|SSN|email" packages/common/utils/http_client_logging.go`.
- `rg "body_b64|Raw|fmt\.Sprintf\(\"%\+v\""` on request/response bodies in handlers.

## Hot files to watch

- `packages/api/internal/api/routes/bridge_webhooks/*`
- `packages/deploy/modules/lb/main.tf`
- `packages/usdh/src/lib/server/internal-auth.ts`
- Any new route under `packages/api/internal/api/routes/**`
- `packages/common/utils/http_client_logging.go`

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files.
