# Advisor `when` trigger conditions

## Motivation

Previously, enabled advisor profiles ran secondary review model calls after every completed turn in Pi and Hermes, even when the review was irrelevant (e.g. running vibe checks when no `vibe.md` exists, or running code-quality checks on turns that touched no code).

This change adds `when` trigger conditions so Pi and Hermes skip the review model call unless conditions match, eliminating wasted model calls and latency.

## Contract

An advisor entry in `WATCHDOG.yml` supports an optional `when` mapping:

```yaml
advisors:
  - name: vibe
    enabled: true
    when:
      files:
        - vibe.md
        - docs/vibe.md
    instructions: |
      Enforce @docs/vibe.md on every review.

  - name: code-quality
    enabled: true
    when:
      paths:
        - "src/**"
        - "*.ts"
        - "*.py"
      message_matches: "^(fix|feat|refactor)"
    instructions: |
      Watch for regressions and broken invariants.
```

### Match semantics

- **Missing or empty `when`**: always runs.
- **Present keys**: combined with AND. All present keys must match.
- **`when.files`**: OR list of file paths. Matches if any listed file exists relative to `cwd`, ancestors of `cwd` up to git root or home directory, or loaded `WATCHDOG.yml` directories.
- **`when.paths`**: OR list of small `*` and `**` glob patterns. Matches if any pattern matches any posix-normalized path-like token extracted from the current turn only.
- **`when.message_matches`**: regular expression matched against the latest user message. An invalid regex records a skip reason rather than throwing.
- **Fail closed**: unparseable `when` blocks skip that advisor and emit a warning during roster discovery.

### Evaluation and outcomes

- Pi evaluates `when` in `runAdvisorReviews`/`reviewAdvisor` before calling `resolveModel` or `complete`. The Pi adapter extracts the last user message and current-turn paths from the session branch (from the last user message through the end of the branch).
- Hermes evaluates `when` in `Reviewer._review_advisor` before calling `complete_structured`. The plugin passes `cwd`, `user_message`, and `assistant_response`; path tokens are extracted from the current turn text.
- When conditions do not match, the advisor yields `{ kind: "skipped", reason }` (Python `state="skipped"`). No follow-up is generated.
- `/advisor-profile status` displays the skip reason, and `/advisor-profile list` and status show the configured `when` conditions.

## Host boundaries

- **OMP**: OMP's native advisor subsystem ignores `when` conditions and still runs and spends on all enabled advisors on every turn.
- **Pi and Hermes**: Pi and Hermes adapters enforce `when` conditions before calling secondary models, skipping non-matching advisors with zero model spend.
- **Review deduplication**: Exact note deduplication and `use off` aliases remain preserved across both adapters.
