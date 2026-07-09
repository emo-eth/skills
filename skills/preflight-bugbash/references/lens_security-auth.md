# Security / Auth Lens

> **Read `reviewer_discipline.md` first.** The two discipline rules (comment-vs-code divergence, cross-file exit-path reasoning) override domain/lens-specific heuristics where they conflict.

Cross-cutting security review. Overlaps with `permissions-secrets` domain but broader — includes input validation, trust boundaries, crypto misuse, supply chain.

## Focus areas

### 1. Trust boundary violations
User input reaching a sensitive sink without validation/escaping. SQL injection via raw `.Where("... " + userInput)`. Shell injection via `exec(cmd + userInput)`. SSRF via user-controlled URL in server-side fetch.

**Check:** Trace every user input (request body, query param, URL) through the diff to its sink. Every hop should have validation or a safe API.

### 2. Authentication vs authorization
`withAuth` middleware applied, but handler doesn't check the authenticated user owns the resource being read/modified. "Logged in" ≠ "allowed to access this record".

**Check:** Every handler diff that reads `resourceId` from URL — verify an ownership check (`organization_id = user.orgID`) exists.

### 3. Crypto misuse
`Math.random()` for token generation; `MD5`/`SHA1` for security-sensitive hashing; constant-time comparison missing on HMAC verify; IV reuse in symmetric encryption.

**Check:** `rg -E "Math\.random\(|MD5|SHA1|hmac"` in security-relevant code. Verify `crypto.timingSafeEqual` (or equivalent) on signature compare.

### 4. Secrets in wrong place
Env vars prefixed `NEXT_PUBLIC_` that shouldn't be public; secrets in error messages / responses; secrets logged; secrets committed.

**Check:** `rg "NEXT_PUBLIC_" ` — is any of these a value that should be server-only? Error responses that interpolate `process.env`? Logs with full credentials?

### 5. Open redirects / CSRF / CORS
`res.redirect(req.query.returnTo)` with no allowlist; `Access-Control-Allow-Origin: *` on an authenticated endpoint; state-changing GET requests.

**Check:** Redirect targets must be allowlisted. CORS wildcards on auth'd routes = flag. GET handlers that mutate state = flag.

### 6. Dependency / supply chain
`package.json` / `go.mod` changes — new dependency with low downloads, typo-squat name, maintainer change, major-version downgrade.

**Check:** For each added dep, spot-check the name (typo?), registry age, weekly downloads. Pinning vs floating version.

### 7. Rate limiting & DoS
New public endpoint without rate limit; new job/loop that fetches per-user data without bounded concurrency; regex with catastrophic backtracking on user input.

**Check:** `app/api/**/route.ts` diffs — verify rate-limit wrapper. Any new `for (const user of allUsers)` doing HTTP per iteration.

### 8. PII in the wrong places
PII in URL path/query (logged by every proxy); PII in cookies without `HttpOnly`/`Secure`; PII in Sentry payloads.

**Check:** Redaction before Sentry. Cookies set with proper flags. PII never in GET query strings.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files. Use `domain: "lens-security"`.

## Mandate

Complement `permissions-secrets` domain, don't duplicate. Focus on cross-cutting security posture: input validation, crypto, trust boundaries, supply chain, DoS.
