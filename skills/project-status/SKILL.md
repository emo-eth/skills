---
name: project-status
description: "Read-only project briefing: what shipped, what's left for a milestone, what's blocked on the human, what needs their review, and what's most pressing — ranked, with staleness and evidence tiers preserved. Use when the user asks 'what did we just ship', 'what's left for v0', 'what's blocked on me', 'what should I review', 'what's most pressing', or wants a standup-style read of where the project stands. Reads docs/STATE.md, docs/DECISIONS.md, docs/log/, git, and open PRs. Never writes — when the map is stale it says so and hands off to project-state sync."
argument-hint: "[milestone, e.g. v0] (defaults: the milestone STATE.md names as current)"
---

# Project Status

The failure this skill defends against: a confident briefing assembled from
`git log` and vibes. Commits tell you what changed, never what it *meant*, what
it unblocked, or what is now waiting on the human — so a status answer derived
from them reads authoritative and is quietly fiction. The fix is to answer only
from artifacts that record intent, tag every claim with how stale it is, and
say "I don't know" where the artifacts are silent.

This skill answers five questions and nothing else:

1. What shipped since the last briefing
2. What's left for the milestone
3. What's blocked on the human
4. What's awaiting the human's review
5. What's most pressing, ranked, with the reason for the rank

Read this whole file before acting.

## Standing rules

These override any impulse to the contrary.

- **Read-only. Write nothing.** No file edits, no `git mv`, no commits, no
  "while I'm here" map fixes. If `docs/STATE.md` is wrong, *report* that and
  point at `project-state sync` — do not fix it. A read tool that mutates is a
  tool nobody can run safely mid-session, which defeats the point of having it.
- **Never invent a queue.** If nothing is blocked on the human, the answer is
  "nothing needs you." Manufacturing plausible-sounding action items to fill
  the section is the worst possible failure here — it spends the user's
  attention on fiction.
- **Staleness is the headline, not a footnote.** If the map is behind the code,
  that fact outranks everything else in the briefing, because it determines
  whether the rest can be trusted at all.
- **Tiers survive to the output.** An `inferred` row in the topic index is
  relayed as inferred. Never launder a weak claim into a confident status line
  by dropping its tag.
- **Distinguish blocked-on-human from blocked-on-work.** This is the whole
  value of the skill. "Needs a decision from you" and "needs someone to write
  the code" are different queues; collapsing them makes both useless.
- **Cap it at one screen.** This is a briefing you re-read daily, not a report.
  Detail lives in the artifacts; the briefing points.

---

## 1. Establish what's readable

Find which inputs exist before planning around them. In a repo maintained by
`project-state` and `review-capture` you'll have most of these; in any other
repo you'll have few, and the honest answer degrades with them.

| Input | What it supplies |
| --- | --- |
| `docs/STATE.md` | current phase, priorities, proven/open/deferred, topic index + tiers |
| `docs/DECISIONS.md` | `Scope:` per decision, `Status: deferred` + `Revisit:`, `Load-bearing: yes` |
| `docs/taste.md` | standing principles, so a "pressing" item isn't proposed against known taste |
| `docs/log/YYYY-MM-DD-*.md` | dated session artifacts — the trail of what actually happened |
| `docs/review/*-answers.md` | each ends with a collected list of items still needing human input |
| `.context/review/` | snapshots of review rounds; a recent one with no answers doc means a round stalled |
| git | commit and merge history, working tree state |
| `gh` | open PRs, and which await this user's review |

Then locate the milestone. Use the argument if given; otherwise take the
current phase/milestone from STATE.md's "Where we are." If neither names one,
say so and answer without milestone scoping rather than guessing at "v0."

Completion: a written list of which inputs exist and which are absent, plus the
milestone in force.

## 2. Run the staleness gate — before anything else

Establish whether the map still describes the code. This gates the entire
briefing's trustworthiness.

```sh
git log -1 --format='%H %cI' -- docs/STATE.md         # when the map was last touched
git log --oneline <that-sha>..HEAD -- <paths from the topic index>
```

Take the code paths from STATE.md's topic index. Any row whose code changed
after the map's last touch is a row whose claims — especially `verified-live` —
are now unverified regardless of what the tier says.

Three outcomes, and they change how you present everything below:

- **Map current** — no code moved under any row since the map's last touch.
  Brief normally.
- **Map behind** — code moved under N rows. Lead with this, name the rows, mark
  every affected claim unverified, and recommend `project-state sync`.
- **No map** — `docs/STATE.md` doesn't exist. Say plainly that the repo isn't
  bootstrapped, that what follows is inference from git and nothing more, and
  recommend `project-state bootstrap`. Do not produce a confident briefing off
  commits alone; that is the exact failure this skill exists to prevent.

Completion: one of the three outcomes is determined, with the affected topic
rows named if the map is behind.

## 3. Gather the five answers

Work from artifacts of intent first, git second. Git is corroboration for what
a doc claims, not a substitute for it.

**Shipped.** Bound the window at the last briefing or the most recent
`docs/log/` artifact, whichever is later; if neither exists, use the last
milestone-ish marker (tag, release commit). Prefer merges and the log trail
over raw commit counts — `git log --merges --oneline` plus the dated artifacts
tells you what landed as *units of work*. Name what it unblocked when an
artifact says so; don't infer causation from adjacency.

**Left for the milestone.** Union of: STATE.md "Open"; `DECISIONS.md` entries
with `Scope: <milestone>` and `Status: active` that aren't yet implemented; and
any tracker items if the repo uses one. Honor the planning-time rule from
`review-capture`: when the milestone is v0, **ignore** `v1+` and `deferred`
entries — pulling them in is how a milestone silently doubles.

**Blocked on the human.** Only real signals, each cited:

- `Needs you:` lines in review-capture closure summaries
- the trailing "still needing human input" list in any answers doc
- `Status: deferred` entries whose `Revisit:` trigger has now fired — quote the
  trigger and state what fired it
- STATE.md "Open" items phrased as questions for the human
- a `.context/review/` snapshot with no corresponding answers doc — a round
  that went out and never came back

**Awaiting their review.** `gh pr status` for review-requested, plus open PRs
with no review decision. Include age; a four-day-old request is a different
item than a four-hour-old one.

**Most pressing.** Rank by this order, and state the reason inline so the
ranking is auditable rather than asserted:

1. blocks another person or a running process
2. blocks the current milestone
3. a fired revisit trigger on a `Load-bearing: yes` decision
4. a stale `verified-live` claim on load-bearing code — nobody knows if it works
5. everything else, newest first

Completion: all five have an answer or an explicit "nothing here," every item
carries a file/PR citation, and each ranked item carries its reason.

## 4. Brief

One screen. Staleness first when it applies, then the five sections, then the
single recommended next action. Cite paths so every claim is checkable, and tag
any claim resting on an `inferred` or stale row.

```md
⚠️ Map is behind: docs/STATE.md last touched 2026-07-19; code moved under
   `Order execution` and `Auth` since. Those rows' claims are unverified.
   → run `/project-state sync`

**Shipped** (since docs/log/2026-07-19-findings.md)
- Backend route handler + tests — #412, docs/log/2026-07-22-handoff.md
- Token selector — #418

**Left for v0** (3)
- Empty-state copy — STATE.md "Open"
- Rate-limit policy — D19 (active, scope v0), unimplemented
- Mobile web breakpoints — STATE.md "Open"

**Blocked on you** (2)
- D24 deferred, revisit trigger FIRED: "when v1 scoping starts" — scoping
  started 2026-07-24. Needs your call.
- docs/review/2026-07-22-spec-answers.md item 7 — scope question on public API

**Awaiting your review** (1)
- #418 token selector — review requested 4 days ago

**Most pressing**
1. #418 — 4 days blocking another person
2. Rate-limit policy (D19) — blocks v0
3. D24 revisit — load-bearing, trigger already fired

Next: unblock #418, it's the only item with someone waiting on you.
```

If a section is empty, say so in one line. Do not pad.

Completion: briefing fits one screen, every claim cites its source, staleness
led if present, exactly one next action proposed.

---

## Definition of done

1. **Nothing was written** — no file in the repo changed as a result of this run.
2. **Every claim is checkable** — each line cites a path, doc ID, or PR number.
3. **Staleness is explicit** — the user knows whether to trust the briefing
   before they read it.
4. **The human queue is real** — every "blocked on you" item traces to a
   recorded request for human input, not to inference about what they'd want.
5. **One next action** — the briefing ends with a single recommendation, not a
   menu.

## Failure modes

- **Git-log fiction** — a confident briefing in a repo with no STATE.md, built
  from commit messages. Fix: declare the repo unbootstrapped and label the
  output as inference.
- **Manufactured queue** — inventing "blocked on you" items to avoid an empty
  section. Fix: empty is a valid, useful answer.
- **Laundered tier** — relaying an `inferred` row as settled fact because the
  tag didn't survive summarization. Fix: carry tags into the output.
- **Helpful mutation** — fixing the stale map mid-briefing. Fix: report and
  hand off to `project-state sync`; this skill never writes.
- **Milestone bleed** — counting `v1+` or `deferred` entries toward v0's
  remaining work. Fix: honor the scope field.
- **Report creep** — a briefing that grows past one screen and stops being
  read daily. Fix: hard cap; push detail into the artifacts.
- **Adjacency as causation** — "shipped X, which unblocked Y" when no artifact
  says so. Fix: only claim what a doc claims.
