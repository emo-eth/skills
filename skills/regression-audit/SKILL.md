---
name: regression-audit
disable-model-invocation: true
description: Audit a branch or pull request against a chosen base branch to find and fix behavior that was accidentally lost, narrowed, reverted, or retargeted. Use when the user asks to compare a branch to its base, find regressions or unnecessary churn, verify a refactor or shared-code migration preserved behavior, or restore upstream behavior without disturbing intentional work.
---

# Regression Audit

Compare the current branch with its base, prove what behavior changed, and
restore only behavior that the base still requires. This is a regression audit,
not a generic bug review: new bugs belong to `preflight-bugbash`.

## Base branch

Use `REGRESSION_AUDIT_BASE` when the caller names a base branch. Otherwise use
`origin/main`; fall back to `origin/dev` only when `origin/main` does not exist.
Always record the resolved base ref and merge-base SHA in the run directory.

```bash
base_ref="${REGRESSION_AUDIT_BASE:-origin/main}"
git rev-parse --verify "$base_ref" >/dev/null 2>&1 || base_ref=origin/dev
base_sha="$(git merge-base "$base_ref" HEAD)"
```

## Scope rules

- Read the complete diff against the resolved base, not only the latest commit.
- For every suspected loss, inspect the base version, relevant history, and
  current consumers before calling it a regression.
- Preserve intentional branch behavior and avoid whole-file reverts.
- Do not report a difference merely because it is different from the base.
- Separate confirmed regressions, unnecessary churn, cleared suspicions, and
  intentional drift left in place.

## Domain reviewers

Classify changed files into every matching domain. One file may match several.

| Domain | Typical signals |
|---|---|
| `application` | Application code, handlers, routes, UI, services, commands, or libraries |
| `data` | Schema, migrations, ORM models, indexes, constraints, or persistence code |
| `infrastructure` | Terraform, Kubernetes, Helm, Docker, deployment, environment, or access configuration |
| `automation` | Scripts, CI workflows, build files, release tooling, or scheduled jobs |
| `shared-code` | Shared packages, exported APIs, common types, generated clients, or code-generation output |
| `edge` | DNS, CDN, WAF, reverse proxy, gateway, or edge-worker configuration |

Read the matching `references/domain_<domain>.md` checklist. If no domain
matches, run one solo review using `reviewer_discipline.md` and
`finding_format.md`.

## Run directory

Every invocation gets isolated scratch space:

```bash
run_id="$(date +%s)-$$"
run_dir=".context/regression-audit/runs/$run_id"
mkdir -p "$run_dir/prompts" "$run_dir/outputs"
export REGRESSION_AUDIT_RUN_DIR="$run_dir"
printf '%s\n' "$base_ref" > "$run_dir/base_ref.txt"
printf '%s\n' "$base_sha" > "$run_dir/base_sha.txt"
git diff --name-only "$base_sha"...HEAD > "$run_dir/changed_files.txt"
```

The scratch directory is machine state. Do not commit it.

## Workflow

### 1. Classify the diff

Create one `domain_<domain>.txt` file for each matched domain and
`dispatched.txt` containing the domains that will run.

Early exits:

- No changed files: report that there is nothing to audit.
- One changed file in one domain: use narrow mode in the main context; do not
  pay for a reviewer round trip.
- No matched domain: use the solo reviewer described above.

### 2. Review each matched domain

For each domain, create a prompt containing:

1. `references/reviewer_discipline.md`.
2. `references/finding_format.md`.
3. The domain checklist.
4. The resolved base ref, merge-base SHA, and exact file list.
5. These instructions:

   ```text
   For each file, inspect the diff against the recorded base ref and inspect
   the base version. Search current consumers before treating a removed field,
   branch, check, route, side effect, or configuration value as unused. Emit a
   JSON array of findings. Do not write files. A clean result is [].
   ```

If subagents are available, dispatch matched domains in parallel. Otherwise run
the check inline. The aggregator always stays in the main context.

### 3. Aggregate findings

Deduplicate findings by path, category, and nearby line. Merge domain names when
multiple reviewers identify the same behavior. Rank High, Medium, Low, then
Speculative. A named base commit and a current consumer increase confidence;
an unverified hunch is explicitly speculative.

Present the report and offer a restore scope: `restore all`, `restore high`, or
`restore #<n>`.

### 4. Restore and verify

When the user selects restores:

1. Apply the selected minimal restores in one batch.
2. Re-run every domain reviewer that originally ran.
3. Aggregate a labelled post-restore report.
4. Stop when the selected regressions are restored or ask about any new finding.

Never silently fix unrelated fresh bugs. Hand those to `preflight-bugbash`.

## Evidence commands

Use these commands for every serious suspicion, substituting the recorded base
ref:

```bash
git diff "$base_ref" -- path/to/file
git show "$base_ref:path/to/file"
git log "$base_ref" --oneline -- path/to/file
rg -n "symbol_or_field" .
```

## Reporting

For each finding, state:

- what behavior was lost or narrowed;
- why it matters;
- the current path and line;
- the evidence in the base branch or history;
- affected consumers, if any;
- the smallest restore that preserves intentional branch work.

End with:

- confirmed regressions;
- unnecessary churn;
- cleared suspicions;
- intentional drift left in place;
- which domains ran and whether each was clean.
