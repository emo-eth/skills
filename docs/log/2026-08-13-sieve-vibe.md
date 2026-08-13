# 2026-08-13: sieve vibe session

Worktree: `sieve-vibe`. Branch: `sieve-vibe`.

> Corrections from vibe.md review round 1 are applied in `docs/vibe.md` and
> answered item-by-item in `docs/review/2026-08-13-vibe-round-1-answers.md`.
> Two proposals below changed shape there: P1 (no mandated implement/verify
> split; decomposition instead [D23]) and P4 (the logger is not "yearn"; name
> pending [D21]). This log otherwise stays as written.

The user dumped a word pile about how they think: knowledge, understanding,
tasks, and prioritization as a sieve; tickets that hide their verify work;
crystallization from vibe to plan; wanting agents to inherit their intuition;
wanting tighter skill-iteration loops; wanting skill-level friction notes
("yearns"); and, as a separate lane, wanting every agent turn to end in a
summary block the way Conductor folds turns.

That dump is now distilled into `docs/vibe.md` (draft, under Plannotator
review). This log holds the mapping from dump to consequences: what each
theme became, what evidence exists, and the concrete edits and new tools the
philosophy demands. Nothing in this log is approved yet; the vibe doc is the
review target and the proposals below wait on that review unless the user
says otherwise.

## Theme to clause mapping

| Dump theme | Landed in | Notes |
| --- | --- | --- |
| Sieve/sifter for knowledge, tasks, prioritization | V1 | "Don't over index on the binary aspect" is recorded in V1's does-not-mean |
| Ticket ranker, keep/drop wizard as embodiments | V1 means | `tools/prioritize-linear-tickets.ts`, `decision-wizard`, `--bin` triage |
| Tickets not granular enough; implement + verify | V3 | lc-ticketize already requires proof needed; the new part is the default implement+verify split, see proposal P1 |
| north-star chain as deliberate crystallization | V2 | Already the house artifact chain; the vibe names why it works |
| Plannotator gives edges to fuzzy pictures | V2 means | Also the delivery mechanism for this very review |
| Agents should learn the user's intuition from iterations | V4 | Mechanisms exist (taste.md, DECISIONS.md, memory); the gap is sieve outputs not feeding them, see P2 |
| skill-iteration loop too loose; time it; faster models | V5 | See P3 |
| /yearn as papercut-for-skills | V6 | See P4 |
| Conductor-style end-of-turn summary | V7 | Separate lane, findings and plan below |
| Making word dumps actionable | V2 check | This session is the demonstration: dump -> vibe.md -> plannotator -> proposals |

## Separate lane findings: how Conductor does the fold

Evidence gathered locally and from Conductor's docs:

1. Conductor injects system prompts into agent sessions, customizable per
   repository in Settings -> [repo] -> Preferences ("General preferences" and
   per-action prompts). Source: conductor.build/docs/faq and
   /docs/reference/agent-behavior.
2. The fold itself (hiding the turn above the summary) is app-side UI
   message collapsing, introduced in v0.72.0; Ctrl+O expands. The model does
   not control the fold.
3. On this machine there is no `[prompts]` section in
   `~/.conductor/settings.toml` or any project settings under
   `~/.conductor/projects/`, so the summary behavior the user sees is a
   built-in default injection, not user config. The exact default text is
   compiled into the app and was not extractable from the binary in a
   bounded search. [INFERENCE] The behavior is consistent with a standing
   instruction of the form "end every response with a fixed summary
   section"; the user notes it is imperfect (instructions and explanations
   sometimes leak above the fold), which matches prompt-level enforcement
   rather than a hard UI guarantee.

Replicable mechanism for omp/pi:

- The behavior layer (what the summary contains) is prompt-level and belongs
  in the files every agent reads, per the standing agent-agnostic rule.
- The presentation layer (fold, status line) is harness-level. pi and omp
  expose extension hooks: `turn_end` / `session_stop` events and
  `ctx.ui.setStatus(key, text)` for the footer. Community extension repos
  exist (harms-haus/pi-extensions, narumiruna/pi-extensions). Event names
  and the setStatus API come from a web search summary of the pi-mono
  extension types; verify against the installed omp/pi versions before
  building. This repo already ships the pattern for a cross-harness package:
  `plugins/wall-clock/` (Agent Plugins manifest with native Pi and OMP
  adapters, using the same terminal events).

## Proposals

### P1. lc-ticketize: make the verify tail a default split

Current text already requires proof needed per ticket and refuses to close
parents on an unproven merge. Add one explicit decomposition rule to step 3:
when a ticket's closure requires verification, the default split is at least
implement + verify; "apparently atomic" is named as a smell, not accepted as
a grain. One paragraph, no new machinery.

### P2. lc-review-capture (or taste pipeline): sieve outputs as taste sources

Today taste.md is fed by review rounds. Add sieve outputs as first-class
taste sources: comparison decisions from prioritize runs and keep/drop
outcomes from decision-wizard runs get distilled into taste.md on a cadence
(or at tool exit), so the intuition shown in passes is inherited. This is
the concrete answer to "agents should develop intuition around my
intuition." Open design point: distill automatically (risk: noisy taste)
vs. on demand via a command (risk: never run). Recommendation: on demand
first, automate only if the habit sticks.

### P3. skill-iteration: time the loop

Add to the skill: run the field test under wall-clock so the iteration's
real elapsed cost is recorded, and prefer fast models for mechanical steps
(separating signal from noise, applying pruning checks). Keeps V5 honest:
the loop's duration becomes a number, not a feeling.

### P4. New skill: yearn

Papercut sibling, same shape: `skills/yearn/SKILL.md` +
`scripts/yearn.sh`, appending to a user-global `~/YEARNS.md`. Fields:
datetime, repo, worktree, branch, agent/model, note, and last skill invoked
when the harness exposes it (omp/pi extension can supply it; otherwise the
invoking agent passes `--skill <name>` by hand). Logging and fixing stay
separate passes (V6). Distinct from plannotator, which stays the home for
big reflections; yearn is the two-sentence mid-task note.

### P5. Turn receipt, two layers

Layer 1 (agent-agnostic, durable): add a standing instruction to the global
agent-instructions file(s) every harness reads. Draft text:

```text
End every turn with a receipt. Fixed shape, under 120 words:

## Receipt
- Did: [one to three bullets: what changed or was learned; name files]
- Needs you: [one exact request, or "Nothing"]
- Questions: [open questions, or "None"]
- Next: [the next action and who does it]

Never bury a question or a request above the receipt. If the turn needs a
real decision or handoff, use the tell-me-what-to-do shape instead of the
receipt.
```

Layer 2 (harness, later): a pi/omp extension (same Agent Plugins pattern as
wall-clock) that listens on `turn_end`/`session_stop`, summarizes the turn
with a cheap model, and pins the result via `setStatus` or as the final
message. This removes the main-model cost and the "skill must be invoked
manually" annoyance that makes /i-have-adhd and /tell-me-what-to-do
underused. Needs a capability check against installed omp/pi before
implementation, same discipline wall-clock used.

Open question for P5 layer 1: which file is the managed source of the
global instructions (chezmoi source vs. editing `~/.codex/AGENTS.md`
directly), so the edit lands in the durable place.

## Open questions

1. Approve or amend `docs/vibe.md` in the Plannotator session.
2. P1-P3 are small edits to existing skills: apply now or after vibe approval?
3. P4 yearn: separate `~/YEARNS.md` or one shared file with a tag column?
4. P5 layer 1: where does the global instruction file live in chezmoi?
5. Should `docs/lifecycle.md` gain a line pointing at `docs/vibe.md` as the
   repo-level upstream contract, or does the vibe stay repo-meta and out of
   the lifecycle doc map?
