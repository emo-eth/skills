---
name: plannotator-review
description: Launch a Plannotator review session that survives agent turns, retrieve submitted annotations reliably, and never destroy a human's unsubmitted comments. Use when sending docs/plans to a human for annotation review, when the user says "open X in plannotator", or when retrieving feedback after a session ("pull up the annotations"). Handles single files, multi-doc folder bundles, and diff-based re-review.
---

# Plannotator Review

Two load-bearing facts, learned the hard way:

1. **Submitted feedback is written to the plannotator process's STDOUT.**
   Keep the stdout, and retrieval is `cat`. Lose it, and you are doing
   archaeology.
2. **Unsubmitted comments live in `~/.plannotator/drafts/<key>.json`,
   keyed by review target.** They SURVIVE the process dying; what
   destroys them is launching a NEW session over the same target, which
   resets the draft to a `{"draftGeneration":N}` tombstone.

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
- Three outcomes: `The user approved.` (acknowledge, stop); empty or
  dismissed (acknowledge, stop); numbered feedback (process it).

No stdout file (launched wrong, or by someone else)? Last resorts, in
order: the drafts snapshot; `plannotator last` (flaky — sometimes
reprints the previous session, sometimes starts a new server); ask the
human to export from the UI.

## Process the feedback

- Address EVERY numbered item, in the human's numbering, stating where
  each fix landed (reply or answers doc, per project convention). Items
  you disagree with get a stated reason — never silence.
- After applying a round: refresh the bundle copies (same session, no
  relaunch) and tell the human it's ready for the next pass.

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
