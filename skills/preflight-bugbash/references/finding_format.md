# Subagent Output Contract

**Before writing findings, read `reviewer_discipline.md`.** It defines the two failure modes (comment-vs-code divergence, single-file reasoning) that cause reviewers to miss bugs they already know how to find. The discipline applies to every reviewer; this file is only the output shape.

## Finding format

Each domain subagent emits findings as a JSON array. Delivery depends on backend:

- **Codex backend** (default): your final agent message IS the array. Do not write files. `dispatch_codex.sh --output-last-message` captures your final message to the output path. Empty result = `[]`.
- **Claude Agent backend**: your final agent message is the array; the main thread writes it to `$run_dir/outputs/findings_<domain>.json`.

Both backends read the same prompt and produce the same JSON shape; only transport differs. Each finding is an object:

```json
{
  "domain": "go",
  "category": "missing-tenant-filter",
  "severity": "High",
  "path": "packages/api/internal/api/routes/foo/handler.go",
  "line": 42,
  "title": "Query drops organization_id predicate",
  "evidence": "`store.Foo.GetAll(ctx, nil)` has no Where clause",
  "recommendation": "Add `.Where(\"organization_id = ?\", orgID)` or use the scoped helper",
  "confidence": "high",
  "related_pr": "1273"
}
```

Field guide:
- **domain**: one of the 8 tags
- **category**: kebab-case name matching the domain reference file's category list
- **severity**: `High` (fix before merge), `Medium` (should fix or justify), `Low` (nit)
- **path / line**: exact location in the current working tree
- **title**: <= 80 chars, imperative, matches the pattern name
- **evidence**: short quote or description of what you saw
- **recommendation**: concrete fix (diff-style if short)
- **confidence**: `high` (pattern match + context confirm), `medium` (pattern match only), `low` (speculative)
- **related_pr**: optional — historical BugBot PR# that flagged this same pattern

Rules:
- Only report findings that are in the current diff. If you notice an older bug while reading, ignore it — scope is the diff.
- Don't pad. Empty array is a valid and useful result.
- If `confidence=low`, mark it explicitly; the aggregator will demote these.
- One finding per issue; if the same bug shows in N files, prefer one finding listing all paths in `path` as a comma-joined string and set `line` to the primary.
