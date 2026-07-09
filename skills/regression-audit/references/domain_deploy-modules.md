# `packages/deploy` Drift Checklist

> **Read `reviewer_discipline.md` first.** The discipline rules override domain-specific heuristics where they conflict.

`packages/deploy/modules` is a shared Terraform module tree consumed by multiple environments. Drift here is particularly costly because one module change affects every Cloud Run service using it. Branches labeled "small cleanup", "tidy deploy", or "simplify module" are the usual vectors.

## Categories

### 1. alert-threshold-change
Alert thresholds widened, narrowed, or aligner semantics changed.

**Check:**
- `git diff origin/dev -- 'packages/deploy/modules/**/*.tf'` for `threshold`, `alignment_period`, `per_series_aligner`, `cross_series_reducer`.
- Flag `ALIGN_SUM` → `ALIGN_RATE` flips (and vice versa) — they change what the metric means, not just the aggregation window.
- Thresholds doubled or halved without context are suspect; cross-check `git log origin/dev --oneline -- <path>` for the last threshold change and its justification.

### 2. probe-semantics-change
Health/startup probe config altered — timeouts shortened, paths changed, endpoints dropped.

**Check:**
- `git diff origin/dev -- 'packages/deploy/modules/cloud_run/**/*.tf'` for `startup_probe`, `liveness_probe`, `readiness_probe` block changes.
- Removed `initial_delay_seconds` or shortened `period_seconds` can cause cold-start restart loops.
- A probe endpoint path change (e.g. `/healthz` → `/health`) without a matching service-code change is a regression.

### 3. cloud-run-wiring-altered
Cloud Run module arguments changed in ways that alter behavior vs. just restructure.

**Check:**
- Env var block deletions: `git diff origin/dev -- 'packages/deploy/modules/**/*.tf'` filtered for `env {` blocks.
- `min_instances` / `max_instances` changes — flag any reduction (cost-driven reductions should be explicit in the commit message, not silently "tidied").
- VPC connector, CPU throttling, or container concurrency changes.

### 4. iam-binding-removed-or-widened
IAM bindings dropped or scope widened (e.g. specific SA → `allUsers`).

**Check:**
- `git diff origin/dev -- 'packages/deploy/modules/**/*.tf'` for `google_cloud_run_service_iam_*` resources.
- Any removal of a bound service account is High severity — identify the service and confirm it no longer needs the role.
- Any binding widened to `allUsers` or `allAuthenticatedUsers` is High severity unless explicitly justified.

### 5. module-restructure-masking-removal
Module input/output renames or restructures that silently drop a previously-wired field.

**Check:**
- `git diff origin/dev -- 'packages/deploy/modules/**/variables.tf' 'packages/deploy/modules/**/outputs.tf'`
- For every renamed variable, confirm the consumer (`packages/deploy/envs/*`) was updated. A renamed variable with no consumer update means the consumer is using the default — which may differ from the old explicit value.
- Outputs removed without consumer updates can cause downstream `terraform plan` to drift silently.

### 6. alert-channel-change
Notification channels swapped or removed from alert policies.

**Check:**
- `git diff origin/dev -- 'packages/deploy/modules/**/*.tf'` for `notification_channels` field.
- A Slack channel silenced in staging alerting config may mean an alert just stopped firing — that is still a behavior change.

## Output

Return findings as a JSON array. Your final agent message IS the findings (captured by `dispatch_codex.sh --output-last-message`). Do not write files. See `finding_format.md`.

Only report regressions actually present in the current branch vs. `origin/dev`. When flagging a deploy-module change, prefer to surface the specific downstream consumer (env, service) likely affected.
