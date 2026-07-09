# Reviewer Discipline

**Read this first. Applies to every reviewer on every review path: domain subagents, lens subagents, solo-reviewer subagent, aggregator.** These are the two failure modes that make reviewers miss bugs even when they match a known pattern.

## 1. Never trust comments over code

A comment is a claim about behavior; the code is the behavior. When a comment says "filter X", "validates Y", "safe because Z", read the surrounding code and verify the claim. If the code does not match the comment, that is a finding (category: `comment-code-divergence`), regardless of which side is wrong — both waste the next reader's time.

Crypto auditors sometimes strip comments entirely before auditing to avoid anchoring on author intent. Emulate that mindset: for every comment in the diff, ask "does the code under this comment actually do what the comment says?"

**Concrete trigger:** any comment of the form "filter / validate / skip / ignore / exclude / ensure / safe because / see below" above code that doesn't obviously implement that claim.

**Mechanical sweep (do this, don't just "keep it in mind"):** for every file in the diff, grep the hunks for `filter|skip|ignore|exclude|validate|ensure|safe because|sanitize|dedupe|normalize` in comment lines. For each match, read the next 1–5 lines of code and answer literally: "does this code do what the comment says?" If the comment says "filter deletions" and the code is `cat ... | sort -u` with no `git diff --diff-filter=d` or equivalent filter, that is a finding. Track this as a pass you explicitly performed — if you report zero comment-code findings, you must have done the sweep. "I read the file and nothing jumped out" does not count; reviewers anchor on intent and miss the gap. The sweep breaks the anchor.

## 2. Reason across all files, walk every exit path

State produced in one file (files written, env vars, timestamps, cached values, flags, artifacts) is consumed by others. For every state-producing line in the diff:

1. Identify every consumer. Grep the whole repo, not just the diff.
2. Walk every exit path in the producer — including:
   - Early `return` / `exit 0` / `continue`
   - Error branches (`if err != nil { return }`)
   - Swallowed errors (`|| true`, `catch {}`, `rescue nil`)
   - Conditional short-circuits

If any exit path skips the state write while consumers still expect it, flag it and name the affected consumer.

**Concrete trigger:** file writes, `.last_*` markers, env exports, cache sets, DB inserts. Every one has a corresponding reader somewhere — find it and check it survives every early exit.

## 3. The instructions you are reading apply to you

If you are a subagent, these apply. If you are the main agent executing the skill in narrow mode with a solo-reviewer dispatch, these still apply — via the solo-reviewer manifest. If you are the aggregator, these inform severity boosts: a finding that cites comment-vs-code divergence or cross-file exit-path skip is high-confidence, not speculative.

Do not treat these rules as "subagent-only lore." They are the discipline of the skill itself.

## 4. Codex mode (when invoked via `dispatch_codex.sh`)

When this prompt is routed through Codex under `--sandbox read-only`, the following additional rules apply. They replace any instruction in the legacy Agent-tool flow that told you to write findings to a path.

- **Your final agent message IS the findings JSON.** Do not attempt to write files. `--output-last-message` captures your last message to the output path; anything you try to write is silently discarded because the sandbox is read-only.
- **Do not explore the repo beyond your scope.** Your prompt lists the files in scope. Read those, run `git diff` / `git show` on those, and stop.
- **Ignore harmless macOS sandbox noise.** `git` may emit `confstr() failed ... DARWIN_USER_TEMP_DIR` warnings on stderr when running under the read-only sandbox. Output is still correct — do not fail the review because of these warnings.
- **Final message must be a valid JSON array.** The helper validates the first byte is `[`. If you have zero findings, emit `[]`. Never emit prose around the JSON.
- **No network.** Do not attempt `gh api`, `curl`, or any fetch. The sandbox blocks it; retrying wastes turns.
