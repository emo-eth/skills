---
name: initiative-standup
disable-model-invocation: true
description: "Create or revise one short standup from recent projects, initiatives, repositories, agent sessions, and other work that does not belong to a Linear ticket."
---

# Initiative Standup

## Glossary

- **Initiative**: A meaningful body of work with a reason and an outcome. It can be a project, a tool setup, a skill, a workflow change, or research. It does not need a Linear ticket.
- **Recent window**: The explicit start and end period covered by this standup. Use the previous working day through now when no prior standup sets a boundary.
- **Evidence**: A source that supports a claim, such as a Memex session, a command result, a file, a commit, or an observed running behavior.
- **Memex**: The local command-line index of agent sessions from this device and any configured machines.
- **Proof**: The observable check that supports a status claim. An install, merge, or finished session is not proof that runtime behavior works.
- **Session ledger**: One row for each indexed agent session in the recent window. It is the required first pass for finding work; search terms are only follow-up filters.

An initiative standup is one short decision document for work that a ticket-centered standup misses. It answers:

1. What moved across projects and initiatives?
2. Why does that work matter?
3. What is active now?
4. What is blocked or needs a decision?
5. What proof is still missing?

This is not a work diary and not a replacement for the `standup` skill. Use `standup` when Linear tickets, ticket ownership, and ticket changes are the planning spine. Use this skill when the work crosses repositories, includes setup or tooling, or has no ticket.

## Operating contract

- Report only the reporting owner's work, decisions, and blockers. Mention another person's work only when it changes the owner's next action.
- Use a concrete initiative label from the source when one exists. If the label is inferred from several artifacts, call it a `working label` and do not present it as an official project name.
- A missing ticket is normal here. Write `No ticket; tracked by artifacts and session evidence.` Do not invent a ticket, project, owner, due date, or formal goal.
- Every initiative needs a concrete change, why it matters, a current status, evidence, and a next result or proof. If a field is not supported, write `GAP` or `not verified`.
- Keep status words narrow: `planned`, `in progress`, `implemented`, `installed`, `enabled`, `merged`, `deployed`, `measured`, `verified live`, or `blocked`. Use `done` only when the source states the work is complete and the required proof exists.
- Separate `implemented` from `verified live`. A file or command can exist while its real behavior remains untested.
- Do not claim device-wide coverage when history indexing is unavailable, stale, or limited to one source. State the exact coverage and gap.
- Do not change Linear tickets, releases, external project plans, Herdr layout, plugin configuration, or device configuration from this skill unless the owner explicitly asks for that named change. Report proposed next actions instead.
- Keep the document short enough to read and discuss in ten minutes. Limit `Current focus` to three to five results.
- If the recent window contains no supported initiative movement, say so. Do not manufacture an initiative from routine commands or an unanswered question.

## 1. Load the reporting spine

Read in this order:

1. The current initiative standup, if it exists.
2. The previous initiative standup that defines the last reporting boundary.
3. `docs/STATE.md` in the current repository, if present. Follow its pointers to the real source before relying on a state claim.
4. Any supplied project, initiative, goal, or decision sources.
5. The current date and reporting timezone.

The default persisted file is:

`docs/log/YYYY-MM-DD-initiative-standup.md`

Use the current repository as the ledger unless the owner supplies another tracking path. A session from another repository can be evidence in this file; cite its repository, working directory, source, and session identifier.

Set the recent window explicitly near the top of the document. Prefer the last standup's end time. If there is no prior file, use the previous working day through the current time. Do not silently widen the window to make the report look fuller.

## 2. Build the Memex session ledger

Memex is the first required evidence source for this skill. Do not start from remembered project names, the current repository, user-supplied work terms, or keyword searches. Those are follow-up filters and can omit work done in another agent or repository.

Resolve the recent window before querying Memex:

- Use the previous initiative standup end as `<window-start>` when it exists.
- Otherwise use the previous working day start through the current time.
- Use full RFC3339 timestamps with an explicit timezone. Do not use a bare date when the timezone or reporting boundary matters.
- Keep the reporting window exact. A wider query may be used only to diagnose a boundary problem; exclude rows outside the reporting window from the report.

First check and refresh the index:

```sh
command -v memex
memex stats
memex index --include-agents
```

If `memex` is unavailable, continue with repository and supplied sources but record `GAP: device-wide session history was not available`. Do not imply that the report covers the whole device.

Then build the session ledger before using search:

```sh
memex sessions --since <window-start-rfc3339> --limit 1000 --json-array
```

The ledger must cover every indexed source, not only the current agent or repository. Record one row per unique `session_id` with:

- `started_at` and `last_at`;
- `message_count`;
- `source`, `project`, `cwd`, and `source_path` when present;
- `session_id`.

Use the ledger to select candidate sessions by activity and coverage, not by search score. Inspect every session with multiple messages or a meaningful time span. Also inspect sessions from another project, repository, or agent when their metadata can explain the owner's work. Do not discard a short session until artifact evidence shows it was routine or irrelevant. If the result count reaches the limit, repeat with a larger limit before treating the inventory as complete.

For every candidate, fetch the full transcript:

```sh
memex session <session-id> -v
```

Extract the user's intended result, concrete artifacts, configuration changes, decisions, observed outcomes, strongest supported status, and next unfinished result or proof. Derive initiative groups from these session outcomes and the artifacts they name. Do not invent an initiative from a repository name or from a list of commands.

Only after the ledger and candidate transcripts are reviewed, use targeted search to find sparse or cross-linked evidence:

```sh
memex search "<term found in the ledger or transcript>" --since <window-start-rfc3339> --sort ts --unique-session --limit 50
```

A search hit is a lead, not evidence. Fetch its full session before citing an outcome. Search terms must come from discovered session metadata, transcript text, or named artifacts; do not use a guessed term as the primary discovery method.

If the session ledger is empty or contains only the current session when work should exist, do not draft yet. Refresh with `memex index --include-agents`, check the exact timestamp boundary, and run a wider query only as a boundary diagnostic. State which sources were indexed and which remain missing. If the missing history cannot be recovered, record the exact coverage gap in the standup.

Use these source filters when narrowing:

- `--source codex`, `--source claude`, `--source opencode`, `--source pi`, or another source shown by Memex;
- `--role user` for the requested outcome or correction;
- `--role assistant` for the reported result and remaining work;
- `--role tool_result` for command output and validation evidence;
- `--project <name>` or `--session <id>` after a candidate is known.

If `memex stats` reports no vectors, use lexical search. Do not use semantic or hybrid search as though embeddings existed. If a search falls back from semantic retrieval, record the degraded retrieval mode when it affects coverage.

For each candidate session, collect only:

- the session date and source;
- the project, `cwd`, and repository root when available;
- the user's intended result;
- concrete artifacts, configuration changes, decisions, or observed outcomes;
- the strongest status the transcript supports;
- the next unfinished result or proof.

Do not scan the entire home directory or treat every session as relevant. Do not close, relaunch, resume, or alter a session while collecting evidence.

### Herdr navigation

The Memex Herdr plugin is an optional navigation surface, not a separate evidence source. When running inside Herdr and the plugin is installed, it may help discover sessions:

```sh
test "${HERDR_ENV:-}" = 1
herdr plugin action list --plugin nicosuave.memex
herdr plugin action invoke recent-here --plugin nicosuave.memex
```

Use the Memex CLI and the underlying transcript for the written evidence. Outside Herdr, skip these commands. Do not close or replace a user's Herdr session.

## 3. Add local and artifact evidence

For each Memex candidate, inspect the named repository or artifact only as needed:

- `git log` and `git show` for committed changes;
- `git status` and the exact files for uncommitted work;
- skill, plugin, tool, wizard, or configuration files for setup work;
- command output or a real request for behavior proof;
- the source document named by `docs/STATE.md` for a project decision.

A session transcript can establish that a change was attempted or that a command returned success. It cannot establish a live product behavior unless the relevant behavior was actually exercised and observed. Preserve this distinction in the status and proof fields.

Group related sessions and artifacts by the outcome they serve, not by the agent that touched them. For example, device setup, a Herdr plugin, a skill, and a wizard can be one `agent workspace tooling` initiative when the evidence shows they support one outcome. Keep them separate when they have different outcomes or next actions.

Do not group work only because it happened on the same day. Do not split one outcome into one initiative per command.

## 4. Reconcile new context

Process every new statement before drafting. Classify it as a fact correction, new work, ownership correction, priority change, decision, blocker, or open question.

For each correction, replace the old claim. Do not leave a stale claim in the document for politeness. If a source conflicts with the state map, follow the pointed source and record the reconciliation needed for `docs/STATE.md`.

Treat work outside Linear as first-class evidence:

- skills and skill distribution;
- tools and command-line integrations;
- Herdr layouts, plugins, and agent integrations;
- Codex Micro or other device setup;
- wizards and one-off setup flows;
- research, evaluations, decisions, and workflow changes;
- code, configuration, deployments, and live checks.

A ticket, if one exists, is an optional citation beside the initiative. It is never required for inclusion and never the only evidence.

## 5. Build the focus list

Choose up to five results. Prefer work that changed what can be done, reduced a real blocker, created a reusable capability, or made a decision possible.

For each result, write:

- **Initiative**: the source name or clearly marked working label;
- **Changed**: the concrete artifact, setup, decision, or behavior;
- **Why it matters**: the outcome this unlocks or protects;
- **Current status**: the strongest supported status;
- **Evidence**: exact paths, commands, commits, observations, and Memex session IDs;
- **Next**: one owner-sized result or one proof check.

Use `Recent movement` for work completed or advanced in the reporting window and `Current focus` for the three to five results that matter next. A result can appear in both only when the next action is a direct continuation.

Keep a separate `Open work and blockers` section for work that has no owner-sized next action, missing evidence, an external dependency, or a decision that blocks progress. Do not bury it inside a long initiative paragraph.

## 6. Render one short standup

Use this order:

1. `Say this aloud` - two to four sentences in plain language. Name the meaningful outcomes, not a list of tools or session IDs.
2. `Recent movement` - the strongest recent changes, with status and evidence.
3. `Current focus` - three to five results with initiative, why it matters, status, evidence, and next proof.
4. `Open work and blockers` - only work that still needs an owner-sized action, evidence, an external dependency, or a decision.
5. `Decisions` - only choices the owner must make or has just made.
6. `Coverage and gaps` - the exact Memex window, indexed sources, missing sources, and any unverified claims.
7. `Sources used` - paths, commit identifiers, commands, and Memex session IDs. Include direct URLs only when a source provides them.
8. `For the Slack thread` - three to five short bullets in plain words. No ticket labels and no unexplained session IDs.

Default shape:

```md
# Initiative standup - <date> (<timezone>)

## Glossary

- **Initiative** - ...
- **Recent window** - ...
- **Evidence** - ...
- **Proof** - ...

## Say this aloud

<two to four sentences>

## Recent movement

- **<initiative>** - <changed artifact or outcome>. <status>. Why it matters: <reason>. Evidence: <path or session>. Next proof: <check>.

## Current focus

### <initiative>

- Changed: <concrete result>
- Why it matters: <reason>
- Current status: <narrow status>
- Evidence: <exact sources>
- Next: <one result or proof>

## Open work and blockers

- <owner-sized action, missing proof, dependency, or GAP>

## Decisions

- <decision and its effect, or `None recorded`>

## Coverage and gaps

- Window: <start> through <end>, <timezone>
- Memex: <sources and index state>
- Gaps: <missing source or `None`>

## Sources used

- Memex session `<id>` - <source, project, cwd, and relevant result>
- `<path>` - <relevant artifact or command result>

## For the Slack thread

- <plain-language result and why it matters>
```

Do not include empty filler sections. Keep a required section visible when it contains a real gap or decision. If no decision exists, write `None recorded` rather than inventing one.

## 7. Persist the result

Create or update the same daily file in place:

`docs/log/YYYY-MM-DD-initiative-standup.md`

Read the existing file before editing. Preserve intentional owner notes and submitted review material. Replace stale generated claims instead of appending contradictory versions. Do not create a same-day follow-up file.

If the reporting window or a durable project decision changes the repository's understanding, update `docs/STATE.md` and the decision log named by that map in the same change. Update `docs/taste.md` only when the work reveals a standing preference. If the state map names no destination, mark it `GAP`; do not invent a path.

After writing, reuse a live Plannotator session for this exact file. If no matching session exists, start it detached and verify the URL:

```sh
nohup plannotator annotate docs/log/YYYY-MM-DD-initiative-standup.md >/tmp/initiative-standup-review.out 2>&1 &
disown
```

Never relaunch over a live session. A relaunch can destroy unsubmitted comments. If Plannotator is unavailable, write `review not opened` in the response and do not claim that the document was reviewed.

## 8. Handle feedback

For ordinary chat feedback, correct the same initiative standup file and return three short lists: `Applied`, `Still open`, and `Sources changed`. Do not create a second daily file.

For submitted Plannotator feedback, use the existing detached session and follow `lc-review-capture`:

1. Snapshot the raw submitted comments under `.context/review/YYYY-MM-DD-initiative-standup-round-N.md`.
2. Answer every numbered comment in `docs/log/YYYY-MM-DD-initiative-standup-feedback-answers-round-N.md`. State where each fix landed and what still needs owner input.
3. Record durable decisions in the append-only decision log named by `docs/STATE.md`.
4. Apply the changes to the same initiative standup file.
5. Reuse the same review session and verify that the reviewed file is the one being served.

Draft comments are not submitted feedback. Never claim a review capture, ticket change, or live proof that did not happen.

## Completion

The run is complete only when the daily document lets a reader name the meaningful recent initiatives, what changed, why it matters, the strongest supported status, the next proof, and every real blocker without opening a ticket. Every initiative claim has a source, missing device coverage is visible, no outside record was changed without explicit instruction, and the persisted file, state map, decision log, and review session agree when any of them changed.
