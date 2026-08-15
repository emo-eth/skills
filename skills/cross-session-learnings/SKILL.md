---
name: cross-session-learnings
description: "Mine your own coding-agent sessions across providers (Claude Code, Codex, Cursor, Conductor) for friction — questions asked, corrections made, things clarified — and split it into two tracks: HUMAN learnings (what the person learned / was confused about, with resolved understanding) and MODEL learnings (how the agent kept going wrong, distilled into proposals for memories, instruction-file additions, or — rarely — skills). Use when the user asks to harvest/assemble/update their learnings, wants to know what they were confused about or kept correcting, or wants a digest of what they and their agents should have learned across recent sessions. Not for tutoring on a new topic (that is the `learn` skill) or for repo-scoped institutional knowledge."
argument-hint: "[harvest [--days N | --since ISO] | review] (default: harvest since last run)"
---

# Cross-Session Learnings

Most "notes" tools are told a fact and file it. This one does the opposite: it reads the
*human side* of your past agent conversations and infers what to write down. The signal it
hunts for is **friction** — not what you did, but where things went wrong — and the same
friction splits into two tracks by *whose model was wrong*:

- **Human learnings** — the human's mental model had a gap. Questions asked ("wait, how does
  X actually work?"), clarifications pulled out of the agent, misconceptions later resolved,
  "oh, that's why" moments.
- **Model learnings** — the agent's behavior was wrong. Corrections ("no, I meant…", "stop
  doing X"), redirects, preferences stated mid-task, and — strongest of all — the **same
  instruction repeated across sessions**, which means it never persisted anywhere and is being
  re-taught to a goldfish every time.

It works **across providers, harnesses, and models** because a problem often spans them — ask
in Claude Code, retry in Codex, fix in Cursor — and each session only sees itself. The skill
itself must stay harness-agnostic too: it may be running under any of these tools, so never
assume a specific host's memory system, slash commands, or config files — detect what exists.

This is not the `learn` skill (that tutors you on something new) and not repo institutional
knowledge (that lives in a repo's `docs/`). This is your own friction, harvested and resolved.

## Where the output lives

Write all harvest output into the active workspace's gitignored `.context` directory. Never
write reports or harvest state to `~/.agents`, a harness home directory, or a tracked repo
file. Create the directory if absent:

```
.context/cross-session-learnings/
  HUMAN-YYYYMMDDTHHMMSSZ.md   # what the human learned — themed, resolved understandings
  MODEL-YYYYMMDDTHHMMSSZ.md   # how agents kept going wrong — guidance + proposal status
  state.json                   # incremental-run cursor; not a report
```

Use the same UTC timestamp for both report files. Never overwrite an earlier report. The
output is workspace-local even though the input harvest spans all detected providers and
projects. Keep the directory gitignored and do not commit it.

## Modes

Pick from the argument, or infer: a request to harvest/update/refresh → **harvest**; a request to just see what's there ("what have I learned lately", "what do I keep correcting") → **review** (read the store back and answer). Default is **harvest**.

## Harvest workflow

### 1. Determine the window

- Explicit `--days N` / `--since ISO` from the user wins.
- Otherwise read `.context/cross-session-learnings/state.json` and use `--since <last_harvest>` for an incremental run.
- If there is no state file (first run), default to `--days 14` and say so.

### 2. Extract the human turns

Run the bundled script — it reads transcripts from every provider present on the machine and emits only the human's messages (harness noise, tool results, and pasted blobs filtered/truncated), as JSONL plus a `_meta` summary line:

```sh
python3 scripts/extract-user-messages.py --since <last_harvest>
# or --days N ; add --cwd-contains <substr> to scope to one project, --providers to subset
```

Read the `_meta` line first. If `messages` is 0, report that there is nothing new since the last harvest and stop. If a provider you expected is missing from `providers`, note it (its transcripts may be older than the window, or that harness isn't installed here).

Do **not** re-read raw transcript files yourself — the script exists so you reason over the filtered human turns, not multi-MB logs. Human messages carry both tracks' signal: questions reveal human gaps, corrections reveal model failures. The assistant side is deliberately not extracted.

### 3. Mine and classify

Read the extracted messages and cluster them. Keep the bar high — you want the friction, not a diary of everything asked. Classify each keeper by whose model was wrong:

**Human track** — include when a message shows:

- A real question about how something works, not a task instruction ("how does the cache invalidate?" — yes; "add caching" — no).
- A request to clarify or explain, or a "wait / why / I don't understand / what's the difference".
- A misconception that a later message resolves.

**Model track** — include when a message shows:

- A correction or redirect of the agent — its output or behavior diverged from what the user meant.
- A preference or rule stated mid-task ("always run X first", "don't use Y here", "I prefer Z").
- **Repetition**: the same instruction or correction given in more than one session or provider. This is the highest-value signal in the whole skill — it means the guidance exists only in the user's patience.

A single message can feed both tracks (a correction sometimes also exposes a human misconception). **Recurrence** strengthens either track — always capture how often and where.

**Exclude**: pure task instructions, approvals ("looks good", "ship it"), one-word steering ("continue"), anything that is just dictating work with no knowledge gap or durable guidance behind it.

The extraction gives you the *question or correction*, not the answer. For human-track entries, you supply the resolution — reconstruct the correct understanding yourself. If a cluster is genuinely ambiguous, keep the entry but mark it `→ unresolved` rather than inventing an answer. For model-track entries, distill the correction into the *general rule* the user was implicitly teaching, not the specific incident.

### 4. Dedup against what's already captured

Read the prior `HUMAN-*.md` and `MODEL-*.md` reports in `.context/cross-session-learnings/`, newest first. For each candidate: if the learning is already there, don't duplicate it — but if this occurrence *strengthens* it (another recurrence, a sharper example, a rule that was **already adopted somewhere yet violated again** — flag that loudly, it means the persisted guidance isn't working), carry the recurrence forward in the new timestamped report instead of adding a separate duplicate.

### 5a. Write the timestamped HUMAN report

Write `.context/cross-session-learnings/HUMAN-<run timestamp>.md`.

Use a consistent point of view: address the human as `you`, never as `I` or `the user`.
Use `I` or `me` only for the agent writing the report. For example, write `What tripped
you up: You asked ...` and `Resolved: You now understand ...`; do not write `I asked ...`
when `I` means the human.

Group entries by theme (a durable area, not a date — e.g. "Solidity / storage", "Git worktrees", "Licensing"). Under each theme, one entry per learning:

```markdown
### <theme>

- **<the thing you were unclear on, in your own framing>**
  What tripped you up: <the confusion, quoted or paraphrased from the actual message>.
  Resolved: <the correct understanding, stated plainly and durably>.
  _Seen: <N>× · <provider(s)> · first <date> latest <date>_ <!-- omit count if 1× -->
```

Order themes by weight (recurrence count, then recency). Keep each entry tight — this file is meant to be re-read, not archived. If a theme grows past ~6 entries, compress older ones into a single principle.

### 5b. Write the timestamped MODEL report and propose persistence

Write `.context/cross-session-learnings/MODEL-<run timestamp>.md`.

Use the same point of view here: write `You corrected me ...` for human feedback and `I
should ...` for the agent's durable rule. Do not call the human `the user` in the report.

Each model-track entry is a piece of guidance that currently lives nowhere. Distill it, then propose where it *should* live — but **never write to the destination yourself; propose, and let the user adopt**. Track status in the entry:

```markdown
### <theme>

- **<the rule, stated as durable guidance an agent could follow>**
  Evidence: <the correction(s), paraphrased> — <N>× · <provider(s)> · <dates>
  Proposed home: <target> · Status: proposed | adopted → <where> | declined
```

**Choosing the proposed home** — detect what exists on this machine, then match the guidance's scope. Escalation order (prefer the lightest that fits):

1. **Memory system** — if the current harness has one (e.g. a memory directory announced in your context), propose a memory entry for user-preference or feedback-type guidance. Draft the entry text in the proposal so adopting is one step.
2. **Instruction files** — for standing behavioral rules, propose the file matching the rule's scope: shared cross-tool (`~/AGENTS.md`) beats per-harness (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`); a repo's `AGENTS.md` only if the rule is genuinely project-scoped. Detect which of these exist; name the exact file in the proposal.
3. **A skill** — highest bar, and the user is explicitly wary of skill sprawl. Propose one only when the guidance is a *reusable multi-step procedure* that instruction files can't hold (a workflow, not a preference), and it recurred enough to prove demand. Prefer extending an existing skill over creating a new one. A one-line rule is never a skill.

If no suitable surface exists (e.g. no memory system in the current harness), keep the entry in the current `MODEL-<run timestamp>.md` report with `Status: proposed` — the workspace report is the fallback store, and a later harvest can re-propose it.

### 6. Update state and report

Write `.context/cross-session-learnings/state.json` with `last_harvest` set to the newest message timestamp processed (or now if none), and a one-line `notes` on what this run added. The state file is the only stable filename; report files remain timestamped.

Report to the user: window covered, providers seen, candidates → new / strengthened / dropped per track, themes touched — and list the **model-track proposals prominently with their drafted text**, since those are the ones awaiting a yes/no. Adoption ("yes, put #2 in ~/AGENTS.md") is done on request: write it to the target, then flip that entry's status to `adopted → <where>`.

## Providers and limitations

The script auto-detects whichever of these exist on the machine:

| Provider | Source | Notes |
|---|---|---|
| Claude Code | `~/.claude/projects/**` | Also covers **Conductor** (its sessions land here). Retention ~30 days by default. |
| Codex | `~/.codex/sessions/**`, `~/.agents/sessions/**` | No git branch in metadata; correlated by cwd. |
| Cursor | `~/.cursor/projects/**/agent-transcripts/**` | No per-message timestamps (file mtime is used); no tool results. |

Other harnesses (Hermes, etc.) aren't wired up yet — add a `scan_*` function and register it in `PROVIDERS` in the script when their transcript format is known. The skill will pick it up with no other change.

Because retention windows differ by tool, a wide `--days` may still miss old sessions on one provider while finding them on another. That's expected; the `_meta` counts make it visible.

## Optional: run it on a schedule

For hands-off accumulation, a recurring job works well (cron, or whatever scheduling mechanism the current harness offers) — e.g. a weekly harvest that appends quietly and batches up proposals. Keep the cadence at least as wide as your shortest retention window so nothing is missed between runs. Only set this up if the user asks; the default is manual invocation.
