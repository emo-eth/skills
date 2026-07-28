# Reviewer Discipline

These rules apply to every reviewer and the aggregator.

## 1. Read behavior, not labels

A commit called refactor, cleanup, migration, or simplify is a claim. Read the
deletion and replacement hunks. For every removed branch, field, check, side
effect, or configuration value, ask what it did on the base branch and whether
anything still consumes it.

## 2. Compare against the recorded base

Do not reason from the branch alone. For every suspicion:

1. inspect `git diff "$base_ref" -- <path>`;
2. inspect `git show "$base_ref:<path>"` when the path exists on the base;
3. inspect relevant base history with `git log "$base_ref" -- <path>`;
4. search current consumers with `rg`.

The base branch is evidence of prior behavior, not proof that every old line
must remain. The finding must explain why the removed behavior is still needed.

## 3. Regressions versus fresh bugs

This skill reports behavior lost relative to the base. A newly introduced bug
belongs to `preflight-bugbash`; mention it only as an incidental observation.

## 4. Confidence and severity

- High: the base behavior is load-bearing and a current consumer or production
  path is named.
- Medium: the base behavior is clear but the consumer or impact needs checking.
- Low or Speculative: the difference looks suspicious without proof.

Do not pad a report. An empty result is correct when the branch preserved the
base behavior.

## 5. Output discipline

Subagents return only the JSON array required by `finding_format.md`. They do
not write files, modify code, or invent a restore without evidence.
