# Ticket-bound attention — assembled work, gaps, plan

Date: 2026-09-18
Parent: [EMO-426](https://linear.app/emo-eth/issue/EMO-426/ticket-bound-attention)
Vibe: `docs/ticket-bound-attention/vibe.md` (approved)
Command center: standup `w2D:p1` (Linear [EMO-449](https://linear.app/emo-eth/issue/EMO-449/standing-desk-command-center))

This is the implementation plan. `GOAL.md` in this worktree is the contract. Do not invent extra product.

## What the vibe implies (the whole operating contract)

| ID | Work | Vibe |
| --- | --- | --- |
| C1 | Opening/creating a Herdr worktree creates or binds a Linear ticket with no form. Human chair name, never a ticket number. | V1, V2 |
| C2 | Every remember-later idea is a ticket even with no tree. Command-center questions that might outlive the pane get tickets. | V1, V6 |
| C3 | Ticket face: **Intention**, **Vibe**, **Done-when**, **Map** (Herdr label + git path + where the rest lives). Not a title stub, not a session dump, not a second PRD. | V5 |
| C4 | Agent in the tree already knows the ticket. Standing update: only when intention/vibe/done-when/map actually change. | V5 |
| C5 | Desk is now: ranked now + named this sitting + standing chairs. Size is parallel attention. Nested tickets are not extra chairs. | V2 |
| C6 | Hide = `workspace close`. Git stays. Ticket stays open. Reopen from Map. | V3 |
| C7 | Shelve is non-destructive: in-flight sitting resumes, or a sitting note already lives in the tree. | V3 |
| C8 | Funeral (`worktree remove` + Linear Done) only when done-when is actually met. Dirty files mean not met. | V4 |
| C9 | Product merge / "finished" also requires operator-approved **done**, **acceptance**, and **validation** lists, then proof. Worker `done` pings are not funerals. | V4 (standup amendment) |
| C10 | Ranking uses existing `tools/prioritize-linear-tickets.ts`. Unranked work is asked. Desk is not invented in secret. | V7 |
| C11 | Seated chairs ping the command center with `herdr agent prompt w2D:p1`. No OMP IRC across trees. `--no-focus`. | V6b |
| C12 | Desk command: chairs vs tickets, flag orphans, hide extras without remove. | GOAL #4 |

## What exists today

| Piece | State | Evidence |
| --- | --- | --- |
| Approved vibe | **Built** | `docs/ticket-bound-attention/vibe.md` |
| Parent ticket | **Built** | EMO-426 |
| One-shot bind of open/hidden chairs | **Built, loose** | `docs/log/2026-09-18-ticket-bind-reopen.md`. Most chairs have a Linear id in GOAL.md and a Map. Several Herdr workspaces still report **no checkout_path**. Duplicate saddle chairs (primary `w17` + worktree `w1A`). Product tickets got a Map bolted on; many still lack Intention/Vibe/Done-when as the face. |
| Standing-desk tickets | **Built** | firstmate EMO-427, scratch EMO-428, standup EMO-449, plus other standing-desk issues |
| Herdr events for the hook | **Platform exists, unused by us** | `worktree.created`, `worktree.opened`, `worktree.removed` in `herdr-plugin.toml` (`[[events]]`). Payload via `HERDR_PLUGIN_EVENT` + `HERDR_PLUGIN_EVENT_JSON`. Copy patterns: `plugins/focus-order`, `plugins/sidebar-descriptors`. |
| Capture plugin / command | **Not built** | No `plugins/ticket-bound-attention/`. No action. Opening a tree does not mint a ticket. |
| Agent-knows-ticket | **Loose** | GOAL.md grep for `EMO-*`. No metadata token. No standing skill. Agents still hunt. |
| Desk list / orphan flag | **Not built** | Reopen markdown is a sitting artifact, not a command. |
| Shelve + sitting note | **Process only** | Command center told chairs to write a note then `workspace close`. Not a plugin action. No resume guarantee. |
| Funeral gate | **Not built** | `worktree.removed` fires **after** delete; cannot veto. Raw `herdr worktree remove` is still legal. |
| Rank → open/hide desk | **Not wired** | `tools/prioritize-linear-tickets.ts` exists. Nothing seats or shelves from it. |
| Command-center ping | **Process only** | Prompt text, not a helper. |
| Finish/merge gate | **Process only** | Command-center AGENTS.md. Not encoded in this plugin. |

## Incorrect / too loose (do not treat as done)

1. **Capture claimed done because tickets existed.** Binding after the fact is not C1. New trees still born without tickets.
2. **Ticket face is inconsistent.** Standing-desk issues look right. Launch tickets (billing, auth, relevance, …) are checklists with a Map appendix. Cold pickup still requires hunting GOAL.md / PRDs.
3. **Hide was treated as the product.** Closing chairs without a capture path is how ideas die the next time someone opens a tree with no ticket.
4. **`worktree remove` was used as a threat in prompts but never gated.** Event hooks cannot block it.
5. **p1 in this workspace is the old blotter/hide session.** It must not also write the plugin. This plan is owned by a dedicated pane.

## Implementation plan (goal mode)

Build a Herdr plugin in this repo: `plugins/ticket-bound-attention/`.
Human name: ticket-bound-attention. Plugin id: `ticket-bound-attention`.
Copy plugin shape from `plugins/focus-order` (Node, `herdr-plugin.toml`, tests) and event env from `plugins/sidebar-descriptors`.
Reuse Linear via existing `linear` CLI or `tools/linear-client.ts`. Do not invent a second tracker.
Do not close operator chairs. Do not `worktree remove` except inside the funeral action when proving it. Do not auto-close Linear tickets.
`--no-focus` on any Herdr layout you create.
Push each working slice to `origin/main` (this repo's skill/plugin rule). Fast-forward the primary skills checkout if you can without stealing focus.

### Slice 1 — Capture command (C1, C3)

Action `capture` (also a CLI the dispatcher can run):

- Input: workspace id or cwd/path.
- If GOAL.md (or a small `.herdr-ticket` file) already names a Linear id, **bind** (write Map, do not mint a second ticket).
- Else **create** Linear issue on team EMO with sections Intention, Vibe, Done-when, Map. Title is the human work name, not `EMO-n`.
- Write/update GOAL.md bind line + Map.
- `herdr workspace report-metadata --source ticket-bound-attention --token ticket=EMO-n` so the chair shows the ticket.
- Idempotent. No form. No focus steal.
- Tests: fake env + fake linear. Bind vs create. Refuse ticket-number chair names.

### Slice 2 — Hook on open/create (C1)

`[[events]]` `on = "worktree.created"` and `on = "worktree.opened"` run the same capture path.
Idempotent if the tree is already bound.
`herdr plugin link` this package (or install from this subdir) and enable it.
Prove with a **disposable** throwaway tree in a temp repo, then funeral that throwaway via slice 5 (or leave it hidden if slice 5 is not ready — do not litter the operator desk).
Ping command center: `standup: worktree-hook <done|blocked> <event names>`.

### Slice 3 — Agent knows the ticket (C4)

- GOAL.md always has the Linear URL near the top.
- Metadata token `ticket`.
- Tiny skill `skills/ticket-bound-attention/SKILL.md` (or a short AGENTS snippet the plugin drops): you already know the ticket; update Linear only when intention/vibe/done-when/map change; ping `w2D:p1`; never raw-remove a worktree.
- Do not paste sessions into Linear.

### Slice 4 — Desk (C6, C7, C12)

Action `desk`:

- List open Herdr workspaces vs bound tickets.
- Flag orphans: chair with no ticket; ticket Map path missing on disk; workspace with empty checkout_path.

Action `shelve`:

- If agent is working or git is dirty, require/write `SITTING.md` (or append a short sitting note) then `herdr workspace close`.
- Never `herdr worktree remove`.
- Ticket stays open.

### Slice 5 — Funeral path (C8, C9)

Action `funeral` (name it `funeral` or `bury`, human-readable):

- Refuse unless Linear state is Done **and** worktree is clean **and** (if GOAL has done/acceptance/validation headings) those lists exist and are marked operator-approved.
- Then `herdr worktree remove`.
- Document in the skill: agents must not call `herdr worktree remove` directly. Herdr has no pre-remove intercept; this action **is** the gate.
- Do not auto-mark Linear Done.

### Slice 6 — Rank to desk (C5, C10) — after 1–5

Wrap `tools/prioritize-linear-tickets.ts`. Propose which bound tickets should sit vs hide. Confirm with the operator (V7). Do not auto-seat a secret order. Skip a ranking UX rewrite.

## Non-goals

- Closing the operator's existing chairs from this pane (capture sibling already bound them).
- Auto-closing Linear.
- Full done-confidence / jev judge.
- Rewriting focus-order or the pairwise reranker.
- Inventing a second driver workspace.

## Proof

- `npm test` / `tsc` in the new plugin.
- Local `herdr plugin link` + event log: `herdr plugin log list --plugin ticket-bound-attention`.
- One disposable create → ticket exists with the four sections → desk lists it → shelve hides chair, git remains → funeral refused while ticket open → (optional) mark disposable Done, funeral succeeds.
- Ping `w2D:p1` at slice boundaries and at the end. No focus steal.

## Coordination

- Sibling `w3Y:p1` is the old hide/blotter session. It must not write `plugins/ticket-bound-attention/`.
- Sibling `w3Y:p3` is one-shot bind. It owns `docs/log/2026-09-18-ticket-bind-reopen.md` only. It must not rewrite this GOAL.md or the plugin.
- This pane owns the plugin, skill, GOAL.md for this tree, and Linear face updates on EMO-426.
