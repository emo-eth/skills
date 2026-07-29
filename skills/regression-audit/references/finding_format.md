# Subagent Output Contract

Each domain reviewer returns a JSON array. An empty result is `[]`.

```json
{
  "domain": "application",
  "category": "authorization-check-removed",
  "severity": "High",
  "path": "src/api/route.ts",
  "line": 42,
  "title": "Restore the authorization check",
  "evidence": "The base branch checks the caller before loading the record; the branch removed the check.",
  "upstream_sha": "abc1234",
  "consumers": ["src/ui/RecordPage.tsx"],
  "restore_recommendation": "Reintroduce the check while preserving the branch's new response shape.",
  "confidence": "high"
}
```

Fields:

- `domain`: one of the domain tags in the parent skill;
- `category`: a concise kebab-case behavior category;
- `severity`: `High`, `Medium`, `Low`, or `Speculative`;
- `path` and `line`: the current location of the lost behavior;
- `title`: imperative, specific, and under 80 characters;
- `evidence`: what the base branch or history proves;
- `upstream_sha`: optional base commit that added the behavior;
- `consumers`: optional current callers, readers, or affected services;
- `restore_recommendation`: the smallest safe correction;
- `confidence`: `high`, `medium`, or `low`.

Only report regressions visible in the current diff against the recorded base.
Do not report a fresh bug or a stylistic difference as a regression.
