# `packages/cloudflare` Drift Checklist

> **Read `reviewer_discipline.md` first.** The discipline rules override domain-specific heuristics where they conflict.

`packages/cloudflare` is Terraform-managed DNS, WAF, cache rules, and the privacy-preserving PostHog proxy worker. Regressions here are especially dangerous because they can silently permit traffic from sanctioned regions, disable analytics, or break caching at the edge.

## Categories

### 1. waf-sanctions-rule-change
WAF sanctions-blocking rules weakened, removed, or scoped narrower.

**Check:**
- `git diff origin/dev -- 'packages/cloudflare/**/*.tf'` for `cloudflare_ruleset`, `cloudflare_waf_*`, or `cloudflare_firewall_rule` blocks.
- Flag any removal or narrowing of country-code blocklists. Cross-check against `packages/cloudflare/README.md` or the compliance-referenced commit.
- Any change that narrows from "block all" → "block except X" requires explicit justification.

### 2. posthog-proxy-worker-behavior
PostHog proxy worker behavior changes (route changes, header handling, fetch behavior).

**Check:**
- `git diff origin/dev -- 'packages/cloudflare/workers/**' 'packages/cloudflare/**/posthog*'` for worker source and route bindings.
- Privacy-preserving behavior is load-bearing: requests rewritten to strip client IP, sanitized event payloads, cache exemptions. Any simplification that removes these transforms is a regression.
- `/ingest/*` → PostHog proxy route bindings dropped → analytics silently disabled.

### 3. cache-rule-regression
Cache rules loosened (longer TTLs, broader caching) or behavior reversed.

**Check:**
- `git diff origin/dev -- 'packages/cloudflare/**/*.tf'` for `cloudflare_ruleset` of kind `http_request_cache_settings`.
- A previously `bypass_cache` rule flipped to `eligible_for_cache` is High severity — auth-dependent or per-user pages must not be cached.
- TTL increases on API routes are suspect — `packages/api` responses typically must not be edge-cached.

### 4. dns-record-drift
DNS records removed, redirected, or repointed to different origins.

**Check:**
- `git diff origin/dev -- 'packages/cloudflare/**/*.tf'` for `cloudflare_record` resources.
- Flag any `value` or `type` change. A CNAME repointing without an accompanying origin-side change can cause silent downtime.
- Removal of a record that downstream services reference is a regression even if the TF file compiles.

### 5. origin-rules-or-page-rules-simplification
Origin rules / Page rules simplified in a way that changes request routing.

**Check:**
- `git diff origin/dev -- 'packages/cloudflare/**/*.tf'` for `cloudflare_origin_rule` or legacy `cloudflare_page_rule` blocks.
- Hostname rewrites, path rewrites, and header-forwarding changes are all load-bearing. Do not treat these as cosmetic.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files. See `finding_format.md`.

Only report regressions actually present in the current branch vs. `origin/dev`. Prefer High severity for any sanctions-rule, WAF, or cache-behavior regression — compliance and cache-poisoning failure modes are not gold-platable.
