# Reviewer Discipline

**Read this first. Applies to every reviewer on every audit path: domain subagents, aggregator, solo fallback.** These are the failure modes that make a regression audit miss restorable behavior even when it matches a known pattern.

## 1. Never trust commit messages or PR titles over code

A commit titled "refactor to shared import" or "cleanup unused constants" is a claim. The diff is the behavior. When a commit says "refactor", "cleanup", "shared-package migration", "tidy up", read the actual hunks and verify no fields, wiring, instrumentation, or conditional branches were dropped. If the message does not match the diff, treat the gap as a candidate regression (category: `message-code-divergence`), even if the diff compiles.

**Concrete trigger:** commits whose messages contain "refactor / cleanup / shared migration / simplify / tidy / small cleanup / use shared" AND whose diff has net-negative line counts in package code (not counting tests, locks, generated files). Read the deletion hunks literally — for each removed block, ask: "what was this doing upstream, and does anything on `origin/dev` still rely on it?"

**Mechanical sweep:** for every commit in `git log origin/dev..HEAD`, scan subject lines for the trigger words above. For each match, run `git show <sha> --stat` and read the deletion hunks. This sweep is a pass you explicitly performed — reporting zero regressions requires having done it. "I skimmed the branch and nothing jumped out" does not count; cleanup-framed commits are the primary vector for silent reverts.

## 2. Reason across `origin/dev`, not just the branch

State produced or consumed in `origin/dev` (analytics events, KYC fields, webhook signatures, deploy alert thresholds, IAM bindings, contract addresses) may be silently reverted on the branch. For every deletion or replacement in the diff:

1. `git show origin/dev:<path>` — is the removed line still present upstream?
2. `git log origin/dev --oneline -- <path>` — did upstream add this line in a named commit the branch effectively reverts?
3. `rg -n "<symbol_or_field>"` across the current working tree — are there still consumers who expect the removed producer?

If any of these confirms the branch is dropping behavior `origin/dev` has, flag it and name the affected consumer or the upstream commit SHA.

**Concrete trigger:** deletions of `posthog.capture`, analytics constants, KYC status fields (`bridge_kyc_status_updated_at`, `bridge_customer_status`), alert thresholds in `packages/deploy`, webhook signature helpers, rows from `contracts.go`, anything under `packages/common` or `packages/db`.

## 3. The instructions you are reading apply to you

If you are a subagent, these apply. If you are the main agent running in solo-fallback mode on a tiny diff, these apply via the solo manifest. If you are the aggregator, these inform severity boosts: a finding that cites message-vs-code divergence or a named upstream commit the branch reverted is high-confidence, not speculative.

Do not treat these rules as "subagent-only lore." They are the discipline of the skill itself.

## 4. Regressions vs. fresh bugs — stay in scope

This skill looks for **regressions against `origin/dev`**, not new bugs introduced by the branch. A freshly-introduced buggy function is out of scope here; preflight-bugbash is the right skill for that. A subtly-reverted function that silently drops `organization_id` filtering — even if the branch also has a new valid-looking purpose — is in scope here.

If you notice a fresh bug while investigating, mention it once in the final report's "Incidental observations" section. Do not spend the audit budget on it.

## 5. Codex mode (when invoked via `dispatch_codex.sh`)

When this prompt is routed through Codex under `--sandbox read-only`:

- **Your final agent message IS the findings JSON array.** Do not attempt to write files. `--output-last-message` captures your last message; anything you try to write is silently discarded.
- **Do not explore the repo beyond your scope.** Your prompt lists the files in scope. Read those, run `git diff origin/dev -- <file>` / `git show origin/dev:<file>` on those, and stop.
- **Ignore harmless macOS sandbox noise** (`DARWIN_USER_TEMP_DIR` warnings). Output is still correct.
- **Final message must be a valid JSON array.** Helper validates the first byte is `[`. Zero regressions = `[]`. Never emit prose around the JSON.
- **No network.** Do not attempt `gh api`, `curl`, or any fetch. Sandbox blocks it.
