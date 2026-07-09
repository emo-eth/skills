# Money / Currency / FX Domain Checklist

> **Read `reviewer_discipline.md` first.** The two discipline rules (comment-vs-code divergence, cross-file exit-path reasoning) override domain/lens-specific heuristics where they conflict.

Recurring money/currency patterns, many High severity — wrong amounts ship to users. Dedicated domain because it spans TS + Go and is repeatedly missed by generic reviewers.

## Categories

### 1. eur-as-usd-cents / currency-denomination-mismatch (High)
EUR amount stored in a `usd_cents` column; `types.CurrencyUSD` hardcoded where `SourceCurrency` is dynamic.

**Check:**
- `rg "types\.CurrencyUSD"` — every occurrence must be a field whose currency is genuinely USD.
- `rg "usd_cents|usdCents"` — when stored, verify the value is actually USD cents (not raw EUR major units, not a pointer that always non-nil).

### 2. zero-decimal-currency-handling (Medium/High)
JPY, KRW, VND are zero-decimal. `toFixed(2)` / `/100` breaks them.

**Check:**
- `rg "toFixed\(2\)"` on any value whose currency isn't guaranteed USD/EUR/etc.
- Hardcoded minimums (`< 3`, `=== 3`) — 3 USD is sensible, 3 JPY is not.
- Per-currency decimal maps should be used: check if a `CURRENCY_DECIMALS` table/const exists and the code consults it.

### 3. szdecimals-truncation-missed (High)
HyperCore / Hyperliquid orderbook enforces per-asset `szDecimals`. Order size not truncated rejects the order.

**Check:**
- `rg "szDecimals"` — every downstream consumer of an order size must truncate to the token's szDecimals.

### 4. zero-denominator-inflated-fee (High)
`sourceAmountWithoutFees === 0` divides → Infinity or full-amount fee.

**Check:**
- `rg "sourceAmountWithoutFees"` — guard against 0.
- `rg "/ sourceAmount"` or similar ratio calcs — guard denominator.

### 5. double-conversion (Medium)
`floatToWire(floatToWire(x))` — two conversions in a chain.

**Check:**
- `rg "floatToWire\(floatToWire\(" ` (multiline ok).
- Any amount that passes through two "normalize" helpers in sequence.

### 6. float-for-money (Medium)
`float64` / `Number` used as a money type → precision loss in backfills and display.

**Check:**
- Go: money in `float64` → flag, require `*big.Int` or minor-unit int.
- TS: `Number` used for summing amounts → prefer `bigint` or string-minor-units.

### 7. zero-vs-nullish-fallback (Medium)
`|| 0` or `?? null` where `0` is a legitimate value → defaults mask real zero.

**Check:**
- `rg "\|\| 0"` — is the left operand a valid zero? (e.g. fee = 0).
- `rg "\?\? null"` on numeric types — would `0` accidentally become null?

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files.
