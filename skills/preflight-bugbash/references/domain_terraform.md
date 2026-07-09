# Terraform Domain Checklist

> **Read `reviewer_discipline.md` first.** The two discipline rules (comment-vs-code divergence, cross-file exit-path reasoning) override domain/lens-specific heuristics where they conflict.

Recurring terraform patterns. Most are *consistency-across-co-varying-surfaces* issues.

## Categories

### 1. secret-env-wiring-mismatch — dominant
Secret added in code (`process.env.X`) but not in TF `secret_envs` / `env`, or vice versa. Shared TF module adds a secret not present in every env's Secret Manager.

**Check:**
- For every new `process.env.FOO` in the diff, verify the same package's `terraform/main.tf` has a matching `secret_envs` entry (or plain `env` entry for non-secret).
- When a secret is added to a shared `modules/*` TF, verify every consuming env's Secret Manager already has the secret.
- Sibling packages sharing code (`usdh`, `usdh-account`) should be updated together.

### 2. waf-cloudarmor-rule-correctness
WAF exclusion rules for monitoring / Sentry — unanchored regex, missing method scoping, fallthrough to a more general rule, or claimed priorities absent from diff.

**Check:**
- `google_compute_security_policy` changes: confirm path match uses `==` or anchored regex (`^/x$`), not bare `matches('/x')`.
- Method scoping (`request.method == 'POST'`) when only one method is the target.
- Priority ladder: walk rules in priority order — does a lower-priority rule re-match & deny what the new rule intended to allow?
- Verify PR body's claims (e.g. "priority 950 allow rule") actually appear in the diff.

### 3. unrelated-infra-toggle
Unrelated operational switch flipped (e.g. `deploy_disabled` to `terraform.workspace == "prod"`) with no mention in PR body.

**Check:**
- Diff `deploy_disabled`, `count`, `for_each`, `enabled`, workspace-conditional expressions — every change must be justified in PR body.

### 4. stale-depends-on
`secret_envs` entry removed, but `depends_on` still references the corresponding `_secret_version`.

**Check:**
- For every secret removed from `secret_envs`, grep the same file's `depends_on` blocks for the matching `_secret_version`.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files.
