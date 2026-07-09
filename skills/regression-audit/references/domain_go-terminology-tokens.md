# Go, Terminology & Token/Contract Drift Checklist

> **Read `reviewer_discipline.md` first.** The discipline rules override domain-specific heuristics where they conflict.

Three related regression surfaces that share a reviewer budget:
- Go code style/discipline reverts (static log messages, `utils.Must`+`utils.Wrap`, verbose names).
- Terminology regressions ("Hyper" used alone where specific product name is required; USDH misspellings; product-scope conflation).
- Token address / chain ID drift — any change to authoritative constants files must be manually verified.

## Categories

### 1. go-dynamic-log-message-regression
`utils.LogInfo` / `utils.LogError` calls reverted to direct `zap` calls with dynamic message strings, causing Sentry fingerprint spam.

**Check:**
- `git diff origin/dev -- '**/*.go'` for lines containing `zap.L().(Info|Error|Warn)` or `fmt.Sprintf` concatenated into log message arguments.
- Structured fields (`zap.String(...)`, `zap.Error(...)`) are correct; the *message* string must stay static.
- Every regression here is at least Medium severity — Sentry fingerprinting depends on stable messages.

### 2. go-error-wrapping-simplified
`utils.Must(...)` / `utils.Wrap(err, "static message")` chains simplified to bare `return err` or inline `fmt.Errorf` with dynamic values.

**Check:**
- `git diff origin/dev -- '**/*.go'` for removals of `utils.Wrap(` or `utils.Must(`.
- Replacement with `fmt.Errorf("failed to process %s: %w", x, err)` has a dynamic wrap string → Sentry fingerprint churn. Flag.
- Bare `return err` after a Bridge/Clerk/Slack call loses the caller context — regression unless the new call site adds its own wrap.

### 3. go-verbose-name-abbreviated
Variable / parameter names shortened from the project-standard verbose form.

**Check:**
- `git diff origin/dev -- '**/*.go'` for renames: `transferLog` → `tr`, `organizationID` → `orgID`, `userAddress` → `addr`, `customerID` → `cid`.
- Style policy in `CLAUDE.md`: verbose names, no abbreviations. Low/Medium severity on individual renames; Medium if systematic across a file.

### 4. hyperliquid-terminology-regression
`Hyper` used alone where `Hyperliquid`, `HyperCore`, or `HyperEVM` is required.

**Check:**
- `git diff origin/dev -- '**/*'` for newly-introduced strings containing `"Hyper"` as a standalone word (not a prefix).
- In code comments, log messages, user-facing copy, PR title/body, and docs: `Hyper` alone is wrong. The correct names are `Hyperliquid` (ecosystem), `HyperCore` (CLOB L1, chain 1337), `HyperEVM` (EVM L2, chain 999).
- Special offender: env var renames that use `HYPERPC` or `HYPER_` with ambiguous suffix. The canonical name is `HYPER_EVM_RPC_URL` / `NEXT_PUBLIC_HYPER_EVM_RPC_URL`. Any other variation is a regression.

### 5. usdh-product-scope-conflation
`USDH` misspelled (`USDHD`, `USD-H`, `usdh` in prose), or `packages/usdh` (usdh.com) conflated with `packages/usdh-account`.

**Check:**
- `rg -n "USDHD|USD-H"` across diff — every hit is a regression.
- `git diff origin/dev -- '**/*.md' '**/*.ts' '**/*.go'` for references to "usdh" in prose — flag lowercase in user-facing text unless it's a URL or package name.
- Any code or doc change that says "USDH" but means the account app (or vice versa) is a conflation bug. Read surrounding context to confirm which product the change is actually about.

### 6. token-address-or-chain-id-drift
Edits to `packages/common/constants/contracts.go` or `packages/common/tokens/generated_tokens.go`.

**Check:**
- `git diff origin/dev -- packages/common/constants/contracts.go packages/common/tokens/generated_tokens.go` — every address/chain ID line changed must be independently verified.
- Authoritative values (must not change without explicit rationale):
  - USDH on HyperEVM: `0x111111a1a0667d36bD57c0A9f569b98057111111`
  - USDC on HyperEVM: `0xb88339CB7199b77E23DB6E890353E22632Ba630f`
  - HyperCore router: `0xd296d76984212cf0719d13c9d2f0d3ca3e78d0b7`
  - HyperCore token IDs: USDH=`USDH:0x54e00a5988577cb0b0c9ab0cb6ef7f4b`, USDC=`USDC:0x6d1e7cde53ba9467b783cb7c530ce054`
- Any diff here that doesn't exactly match an authoritative source is a High-severity regression. Never trust AI-generated or auto-completed addresses.
- `generated_tokens.go` is generated — manual edits are a regression per the shared-package checklist, not this one.

### 7. common-log-util-silenced
`utils.LogInfo` / `utils.LogError` calls removed entirely (not replaced with worse forms, just deleted).

**Check:**
- `git diff origin/dev -- '**/*.go'` for net-removed `utils.Log(Info|Error|Warn)` lines.
- If the log was covering a decision point (transfer routed, alert fired, job completed), the removal blinds observability for that path.
- Lower severity if the surrounding function is itself removed; higher if the function remains and the log was the only signal.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files. See `finding_format.md`.

Only report regressions actually present in the current branch vs. `origin/dev`. Token/contract drift is always High severity — cross-check the authoritative list before emitting the finding.
