---
name: annotation-review
description: Launch a Plannotator annotation session that survives agent turns, retrieve submitted annotations reliably, and never destroy a human's unsubmitted comments. Use when the user wants to review any substantial document produced by the agent, including plans, proposals, specifications, research notes, design docs, implementation summaries, or other written deliverables; when the user says "let me review this", "I want to review this", or "open this for review"; when sending agent documents to a human for annotation review; when the user says "open X in plannotator"; or when retrieving feedback after a session ("pull up the annotations"). Handles single documents, multi-document bundles, and diff-based re-review. Do not trigger for code review unless the user explicitly asks for it.
---

# Annotation Review

## Human review requests

When the user asks to review any substantial agent-produced document, always
use Plannotator as the review surface. This includes plans, proposals,
specifications, research notes, design docs, implementation summaries, and
other written deliverables. Code review is out of scope unless the user
explicitly asks for it. For example, "let me review this" means:

1. Locate the current work product or write it to a durable review file if it
   exists only in the conversation or console.
2. Launch or reuse the appropriate Plannotator session for that file.
3. Give the user the Plannotator URL.

Do not make the user review pasted console output. The console may contain a
short status message and the URL, but it is not the review surface. If the
request names no file, infer the current document from context before
asking for clarification.

Two load-bearing facts, learned the hard way:

1. **Submitted feedback is written to the plannotator process's STDOUT.**
   Keep the stdout, and retrieval is `cat`. Lose it, and you are doing
   archaeology.
2. **Unsubmitted comments live in `~/.plannotator/drafts/<key>.json`,
   keyed by review target.** They SURVIVE the process dying; what
   destroys them is launching a NEW session over the same target, which
   resets the draft to a `{"draftGeneration":N}` tombstone.
3. **An annotate session EXITS after the human submits its round.**
   Observed 3/3 times on 2026-08-13: each folder session died right after
   collecting its submission. A dead session after a submitted round is
   the normal lifecycle, not a crash or a reaper - the feedback is in the
   stdout file; retrieve it, don't panic-relaunch. Relaunch only when the
   human is owed another round. (One unsubmitted single-file session was
   also seen dying unexplained; drafts survived. Snapshot drafts before
   any relaunch regardless.)

## THE PRIME RULE: never destroy unsubmitted human work

- Before ANY session lifecycle operation (launch, relaunch, kill):
  `mkdir -p /tmp/pdrafts-$(date +%s) && cp ~/.plannotator/drafts/*.json /tmp/pdrafts-*/ 2>/dev/null`
  — snapshot costs nothing and makes every clobber recoverable.
- NEVER kill/restart a live session to "fix" naming, bundles, or
  anything else mid-review. Improvements wait for the next round.
- Before killing ANY plannotator process, ask the human to submit or
  export first, and name the URL that is about to die.
- A session is "stale" only when the human confirmed they're done or its
  round was submitted AND processed. Age alone is not staleness.
- After an accidental clobber: check the drafts dir IMMEDIATELY — the
  content persists until the next same-target launch. Recover BEFORE
  relaunching anything.

## Prepare documents for review: SELF-CONTAINED, always

Every document or document bundle entering a session must stand alone — the reviewer will not
context-switch to other files, ever (assume they can't; that's the
accommodation, not a preference):

- Glossary at the top defining every coined term and abbreviation.
- Acronyms expanded on first use: "V7 (judgment labeled as judgment)",
  never bare "V7".
- No references to documents that aren't loaded in the same session; if
  a reference is essential, either inline the needed content or ask to
  add the referenced doc to the bundle.
- Cross-references by bare number ("#9", "R4") must quote the thing they
  point at.

Violating this converts a review into a comprehension interrogation —
the annotations come back as "what is X?" instead of decisions, and the
round is wasted.

## Standing session (the durable answer to rug-pulls)

Prefer ONE long-lived session on a DURABLE folder (e.g. `~/simon-review/`,
never `/tmp` — reboots eat it). Changed docs are updated IN PLACE (same
filename: the live session picks it up and native diff keeps working).
Adding a brand-new file requires a restart — so it requires the human's
explicit ok first. Enforce the contract with a harness hook, not
discipline: a PreToolUse guard that exits 2 on lifecycle operations
against live sessions (process termination, or a fresh launch while one
is live), overridable only by a token the human grants in chat.
Instructions bend under pressure; hooks don't — this skill's own history
proves both halves.

## Launch

Always detached (harness-tracked background tasks get reaped between
turns and kill the human's browser mid-review), always with a named
stdout file (it IS the retrieval mechanism):

    nohup plannotator annotate path/to/doc.md > /tmp/plannotator-REVIEW.out 2>&1 & disown

Multi-doc: plannotator takes ONE target, so build a folder of REAL
COPIES (symlinks are silently ignored) with ORIGINAL FILENAMES
(history/diff is keyed by filename; renaming to 01-a.md silently kills
the native diff view on re-review):

    rm -rf /tmp/review-bundle && mkdir -p /tmp/review-bundle
    cp docs/a.md docs/b.md /tmp/review-bundle/
    nohup plannotator annotate /tmp/review-bundle/ > /tmp/plannotator-REVIEW.out 2>&1 & disown

(`rm -rf` the whole dir, never `rm dir/*.md` — a glob on an empty dir
aborts the chain under common zsh configs, half-building the bundle.)

Note the repo commit each bundle was built from; re-review needs it.

If docs change mid-review (a feedback round was applied), copy updated
files over the bundle copies — the live session picks them up on reload.
Do NOT relaunch for this.

## Give the human the URL

The launch prints nothing useful. Find the URL and say it explicitly
(auto-open may not fire):

    cat ~/.plannotator/sessions/*.json   # each live session: {pid, port, url}
    # or: lsof -nP -iTCP -sTCP:LISTEN | grep plannot

If several sessions are listening, match yours by pid; handle others per
the prime rule, not by age.

## Retrieve the feedback

    cat /tmp/plannotator-REVIEW.out

- Header only (`Folder:`/`Resolved:`): not submitted yet — say the
  session is still open; never conclude "no feedback".
- Header + markdown body: that body is the feedback, verbatim. Before
  processing, CONFIRM it's from the current round — quoted lines must
  match the current docs (a stale buffer from an earlier round reads
  plausibly and will send you fixing the wrong version).
- `# File/Folder Feedback` sections carry numbered items anchored to
  quoted lines; a `Linked Document Feedback` section often repeats the
  same items — dedupe by content before counting.
- Three outcomes: `The user approved.`; empty or dismissed; numbered
  feedback. All three run `lc-review-capture` — approvals and empty rounds
  are cheap passes, numbered rounds are full ones.

No stdout file (launched wrong, or by someone else)? Last resorts, in
order: the drafts snapshot; `plannotator last` (flaky — sometimes
reprints the previous session, sometimes starts a new server); ask the
human to export from the UI.

## Process the feedback

- Hand the round to `lc-review-capture` — every submitted round, without
  exception, INCLUDING approval rounds. Its pass owns the order:
  snapshot the raw feedback FIRST, then apply, then record. Applying
  feedback without persisting it is how the same review happens three
  times.
- Address EVERY numbered item (as part of that pass), in the human's
  numbering, stating where each fix landed. Items you disagree with get
  a stated reason — never silence.
- After the pass: refresh the bundle copies (same session, no relaunch)
  and tell the human it's ready for the next pass.

## Re-review as a DIFF

Native: plannotator snapshots every reviewed file under
`~/.plannotator/history/<project>/annotate-<filename>-<hash>/NNN.md` and
offers diff-vs-last-reviewed when the SAME FILENAME is annotated again
from the same project directory. This is why bundles keep original
names. Diff view missing = the filename key broke; check the history
dir for the name it knows.

Fallback (doc last reviewed outside plannotator, different machine):
`plannotator review --git` renders working-tree changes as an
annotatable diff. Throwaway worktree; `git show <last-reviewed-sha>:path
> path` per doc; commit as base; copy current versions over; launch
`review --git` there; `git worktree remove --force` after the round.

## Hygiene

- When a round is fully processed AND the human confirms done, kill that
  session (`kill <pid>`, pids in `~/.plannotator/sessions/*.json`) —
  after the prime rule's drafts snapshot.
- Orphaned session json files can outlive their processes; verify with
  `ps -p <pid>` before treating a listing as live.
