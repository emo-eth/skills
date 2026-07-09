# Subagent Output Contract

**Before writing findings, read `reviewer_discipline.md`.** It defines the two failure modes (message-vs-code divergence, single-branch reasoning without `origin/dev` cross-check) that cause regression auditors to miss restorable behavior they already know how to find. The discipline applies to every reviewer; this file is only the output shape.

## Finding format

Each domain subagent emits findings as a JSON array. Delivery depends on backend:

- **Codex backend** (default): your final agent message IS the array. Do not write files. `dispatch_codex.sh --output-last-message` captures your final message to the output path. Empty result = `[]`.
- **Claude Agent backend**: your final agent message is the array; the main thread writes it to `$run_dir/outputs/findings_<domain>.json`.

Both backends read the same prompt and produce the same JSON shape; only transport differs. Each finding is an object:

```json
{
  "domain": "usdh-account",
  "category": "analytics-capture-removed",
  "severity": "High",
  "path": "packages/usdh-account/src/lib/analytics/events.ts",
  "line": 42,
  "title": "KYC_REJECTED_VIEWED event constant removed",
  "evidence": "`git show origin/dev:packages/usdh-account/src/lib/analytics/events.ts` still exports KYC_REJECTED_VIEWED; branch removed it in abc1234",
  "upstream_sha": "abc1234",
  "consumers": ["packages/usdh-account/src/components/kyc/RejectedBanner.tsx"],
  "restore_recommendation": "Reintroduce the constant and its capture call site; branch's shared-package migration dropped both",
  "confidence": "high"
}
```

Field guide:
- **domain**: one of the 6 tags (`usdh-account`, `deploy-modules`, `cloudflare`, `scripts`, `shared-package`, `go-terminology-tokens`)
- **category**: kebab-case name matching the domain reference file's category list
- **severity**: `High` (restore before merge — lost behavior `origin/dev` depends on), `Medium` (should restore or justify — behavior drift without clear intent), `Low` (nit — stylistic or cosmetic reverts)
- **path / line**: exact location in the current working tree (the site of the deletion or the most relevant consumer)
- **title**: <= 80 chars, imperative, names the regressed behavior
- **evidence**: short quote or description citing `origin/dev` state. When relevant, include the `git show origin/dev:<path>` snippet or `git log origin/dev` output.
- **upstream_sha**: optional — the `origin/dev` commit the branch effectively reverts, if identifiable. Increases aggregator severity boost.
- **consumers**: optional array of file paths still depending on the removed behavior. One or more found → high confidence; zero consumers found → downgrade to Medium/Low or mark as intentional.
- **restore_recommendation**: concrete fix — what to reintroduce, where, and why. Prefer minimal restore over whole-file revert.
- **confidence**: `high` (named upstream SHA + named consumer), `medium` (upstream present, consumers unclear), `low` (speculative — branch differs but no evidence of lost behavior)

Rules:
- Only report regressions visible in the current diff vs. `origin/dev`. If you notice an older bug while reading upstream, ignore it — scope is the branch diff.
- Don't pad. Empty array is a valid and useful result — a clean branch deserves a clean finding list.
- If `confidence=low`, mark it explicitly; the aggregator will demote these.
- One finding per regressed behavior; if the same revert shows in N files, prefer one finding listing all paths in `path` as a comma-joined string and set `line` to the primary.
- Do not report fresh bugs the branch introduced. That is preflight-bugbash territory.
