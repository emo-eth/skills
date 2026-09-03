# `lc-ticketize` and standup overlap audit

## Glossary

- **GAP** - Required information or evidence not found; it is not permission to guess (`skills/branch-closure/SKILL.md`, §Terms).
- **Ticket set** - The complete group of tracker tickets produced from settled thinking, including its back-map and decisions-to-force list (`skills/lc-ticketize/SKILL.md`, §6).
- **Back-map** - The map from each area of the source thinking to the ticket or tickets that cover it (`skills/lc-ticketize/SKILL.md`, §6).
- **Proof needed** - The observable check that supports closing a ticket (`skills/lc-ticketize/SKILL.md`, §3; `skills/standup/references/ticket-contract.md`, §Required fields).
- **Parent ticket** - The one ticket for a deliverable; **sub-tickets** are its enumerated, tracked components (`docs/DECISIONS.md`, §D31).
- **Owner** - One person responsible for a ticket result (`skills/standup/references/ticket-contract.md`, §Required fields).
- **Standup** - One short daily decision document about current work, blockers, and decisions (`skills/standup/SKILL.md`, opening contract).
- **Fanout** - The execution lane that assigns standup tickets to isolated worktrees and agents (`skills/standup-fanout/SKILL.md`, opening boundary and §1).
- **Branch closure** - The map and proof process for the tickets a current branch or worktree should close (`skills/branch-closure/SKILL.md`, §Terms).
- **Herdr** - The orchestrator that owns fanout worktrees, agents, and communication (`skills/standup-fanout/SKILL.md`, §§3-4).
- **Today** - The standup section whose work items are mapped to fanout worktrees (`skills/standup/SKILL.md`, §5; `skills/standup-fanout/SKILL.md`, §1).
- **D31** - The active decision that one deliverable has one parent ticket with enumerated, tracked sub-tickets (`docs/DECISIONS.md`, §D31).


## Answer up front

The answer to the owner's question, "i haven't used this skill so it probably needs a lot of work, idk if the standup skills duplicate or replace some of the work it does or not", is: the standup skills do not replace `lc-ticketize`, but they duplicate part of its ticket-planning work. `lc-ticketize` owns the durable handoff from settled thinking to a complete ticket set, including decomposition, overlap checks, a back-map, and decisions to force. `standup` makes a short daily plan and ticket delta, `standup-fanout` executes tickets already named by the standup, `initiative-standup` covers cross-project work with no ticket, and `branch-closure` handles one branch's proof and closure. Keep `lc-ticketize`, but revise its boundary and output: it needs a first-class deliverable-parent and sub-ticket model, and the standup skills should consume or propose deltas instead of repeating the full decomposition. (Evidence: `skills/lc-ticketize/SKILL.md`, §§2-6; `skills/standup/SKILL.md`, §§3-6; `skills/standup-fanout/SKILL.md`, opening boundary and §§1-8; `skills/initiative-standup/SKILL.md`, opening boundary and §§2-7; `skills/branch-closure/SKILL.md`, §§2-9.)

## Ownership map

This map uses the seven requested steps. `GAP` means that none of the listed files assigns the work clearly. This is a document audit, not a live tracker audit; actual use of these skills is `GAP` unless a file proves it.

| Lifecycle step | Primary owner | What the owner does and where the boundary is |
| --- | --- | --- |
| Understood thinking | `GAP` within the listed skills; `lc-ticketize` is the handoff gate | `lc-ticketize` requires already-crystallized thinking, lists the input documents, and says to stop for synthesis when the purpose is not understood; it does not create or measure user understanding (`skills/lc-ticketize/SKILL.md`, §2). The repo philosophy says understanding is symbiotic and must not be delegated, with provenance and ways to guide the user toward understanding (`docs/vibe.md`, §V4; `docs/DECISIONS.md`, §D32). `standup` reconciles sources for a daily plan, and `initiative-standup` extracts outcomes from session evidence, but neither names a teach-back or understanding check (`skills/standup/SKILL.md`, §§1-3; `skills/initiative-standup/SKILL.md`, §§2-5). |
| Ticket set | `lc-ticketize` | It reads the destination and exemplar, decomposes one owner-sized result per ticket, checks fake decisions, duplicate owners, unclaimed constraints, and overlaps, then lands the ticket set with a back-map and decisions-to-force list (`skills/lc-ticketize/SKILL.md`, §§1, 3, 4, 6). `standup` can propose or apply ticket changes, but its stated unit is one short daily plan rather than the complete set (`skills/standup/SKILL.md`, §§3-6). |
| Assignment | `standup-fanout` for worktrees and agents; `lc-ticketize` and `standup` for tracker ownership | `standup-fanout` maps every Today ticket to an isolated worktree, then seeds and launches agents under Herdr (`skills/standup-fanout/SKILL.md`, §§1-4). `lc-ticketize` defines one tracker owner per ticket, and `standup` carries owner, priority, and current evidence in daily results and ticket proposals (`skills/lc-ticketize/SKILL.md`, §§1, 3; `skills/standup/SKILL.md`, §§3-4). `branch-closure` maps one current branch or worktree to its intended ticket set and records the owner and proof (`skills/branch-closure/SKILL.md`, §§1-4). |
| Work | `standup-fanout` for planned multi-ticket execution; `branch-closure` for one current branch | Fanout creates the isolated worktrees and drives agents toward the ticket result (`skills/standup-fanout/SKILL.md`, §§3-4). Branch closure performs the reachable local work in the current worktree, then runs its ticket proof (`skills/branch-closure/SKILL.md`, §5). `lc-ticketize` stops at the ticket-set handoff, and `standup` and `initiative-standup` describe reporting rather than implementation (`skills/lc-ticketize/SKILL.md`, §6; `skills/standup/SKILL.md`, §5; `skills/initiative-standup/SKILL.md`, §6). |
| Proof | `lc-ticketize` defines it; the execution skill reproduces it | `lc-ticketize` requires every ticket to name a proof needed (`skills/lc-ticketize/SKILL.md`, §3). Fanout takes the agent claim and runs a focused check before classifying the ticket (`skills/standup-fanout/SKILL.md`, §5); branch closure runs the exact closure proof and separates proof from claims (`skills/branch-closure/SKILL.md`, §6). Both standup skills report the strongest evidence-supported status and the next proof (`skills/standup/SKILL.md`, Operating contract and §3; `skills/initiative-standup/SKILL.md`, Operating contract and §5). |
| Closure | `branch-closure` for a branch closure map; fanout for batch reconciliation | Branch closure owns the closure map, status, action group, proof decision, and any proposed external ticket change for the current branch (`skills/branch-closure/SKILL.md`, §§4, 6, 8). Fanout verifies each tree, applies only verified results, and folds the result into the shared source and standup (`skills/standup-fanout/SKILL.md`, §§5-7). `lc-ticketize` supplies the parent-ticket rule and destination-side verification, while `standup` may apply a named close only after the explicit owner request and destination verification (`skills/lc-ticketize/SKILL.md`, §§3, 6; `skills/standup/SKILL.md`, §§4, 6). |
| Standup reporting | `standup` for ticket-centered daily work; `initiative-standup` for no-ticket cross-project work | `standup` owns the short ticket-centered daily document and its persistence (`skills/standup/SKILL.md`, opening contract and §§5-6). `initiative-standup` is explicitly not a replacement for `standup`; it reports initiatives that cross repositories, include setup or tooling, or have no ticket (`skills/initiative-standup/SKILL.md`, opening boundary and §§6-7). Fanout supplies verified results and a fanout report but does not write the standup's plan (`skills/standup-fanout/SKILL.md`, opening boundary and §§7-8). Branch closure reports the current branch, not the daily plan (`skills/branch-closure/SKILL.md`, §9). `lc-ticketize` supplies the back-map and decisions-to-force list, not a daily report (`skills/lc-ticketize/SKILL.md`, §6). |

The broader lifecycle document supports this split: it assigns tracker items to `lc-ticketize` and branch closure maps to `branch-closure`, while the artifact chain remains downstream of `docs/vibe.md` (`docs/lifecycle.md`, §§29-40, 68-81). The same document says the daily standup skills are not part of that six-skill record set, so they should not silently become the durable ticket-set owner (`docs/lifecycle.md`, §§68-86).

## Collisions and decisions

### Understood thinking

- **`lc-ticketize` §2 vs `standup` §§1-3 — keep-both, with a hard boundary.** Both read current context and turn it into action, but `lc-ticketize` starts from settled thinking while `standup` reconciles the current day's sources; the daily plan must not become a second full planning pass (`skills/lc-ticketize/SKILL.md`, §2; `skills/standup/SKILL.md`, §§1-3).
- **`lc-ticketize` §2 vs `initiative-standup` §§2-5 — keep-both.** Both gather and shape evidence, but initiative reporting is for recent cross-project or no-ticket work and ticketize requires a settled source for tracker work (`skills/lc-ticketize/SKILL.md`, §2; `skills/initiative-standup/SKILL.md`, §§2-5).
- **`lc-ticketize` §2 vs `branch-closure` §§2-3 — keep-both.** Ticketize recovers the plan before ticket creation; branch closure recovers the branch's authoritative intent after a worktree exists, so they operate at different points (`skills/lc-ticketize/SKILL.md`, §2; `skills/branch-closure/SKILL.md`, §§2-3).

### Ticket set

- **`lc-ticketize` §§1, 3-4, 6 vs `standup` §§3-4 — merge the shared decomposition contract.** Keep `lc-ticketize` as the owner of the complete ticket set; make `standup` produce only the daily delta or an explicitly requested named change, because both currently describe ticket fields, decomposition, proof, and duplicate handling (`skills/lc-ticketize/SKILL.md`, §§1, 3-4, 6; `skills/standup/SKILL.md`, §§3-4).
- **`skills/standup/references/ticket-contract.md` vs `skills/standup-fanout/references/ticket-contract.md` — merge to one canonical reference.** Both define the same ticket fields, delta formats, and duplicate rule; fanout also adds a sub-ticket priority rule, so two copies can drift (`skills/standup/references/ticket-contract.md`, §§Required fields, Delta format, Quality checks; `skills/standup-fanout/references/ticket-contract.md`, §§Required fields, Delta format, Quality checks). `lc-ticketize` already calls the standup reference canonical (`skills/lc-ticketize/SKILL.md`, §1).
- **`lc-ticketize` §4 vs `standup` §4 — keep-both, but use one checker.** Ticketize compares a whole proposed set against existing work; standup prepares a small current-day ticket delta, so the daily path should call the same duplicate and missing-field rules rather than restating them (`skills/lc-ticketize/SKILL.md`, §4; `skills/standup/SKILL.md`, §4).

### Assignment and work

- **`lc-ticketize` §§1, 3 vs `standup` §§3-4 — keep-both.** The tracker needs one owner, and the daily plan must show that owner; these are the same ownership fact at two views, not two assignments (`skills/lc-ticketize/SKILL.md`, §§1, 3; `skills/standup/SKILL.md`, §§3-4).
- **`standup-fanout` §§1-4 vs `branch-closure` §§2-4 — keep-both.** Fanout assigns a set of tickets to separate worktrees and agents; branch closure maps one current branch to its scope and intended tickets, so removing either would leave one workflow without a scope map (`skills/standup-fanout/SKILL.md`, §§1-4; `skills/branch-closure/SKILL.md`, §§2-4).
- **`standup-fanout` §2 vs `branch-closure` §7 vs `lc-ticketize` §3 — merge the split contract, not the triggers.** Ticketize should own planned decomposition; fanout and branch closure may discover an oversized ticket during execution, but all three should use one parent, child, owner, output, proof, dependency, and approval shape (`skills/lc-ticketize/SKILL.md`, §3; `skills/standup-fanout/SKILL.md`, §2; `skills/branch-closure/SKILL.md`, §7). This is required by the current decision that one deliverable has one parent ticket with enumerated, tracked sub-tickets (`docs/DECISIONS.md`, §D31).
- **`standup-fanout` §§3-4 vs `branch-closure` §5 — keep-both.** Fanout is the multi-ticket execution lane under Herdr; branch closure is the local finish lane for the current worktree, and each has a different operating boundary (`skills/standup-fanout/SKILL.md`, §§3-4; `skills/branch-closure/SKILL.md`, §5).

### Proof and closure

- **`lc-ticketize` §3 vs `standup` Operating contract and §§3-4 — keep-both.** Ticketize defines the proof needed when a ticket is created; standup states the proof and status in the daily plan, so the latter should consume the former instead of inventing a second proof (`skills/lc-ticketize/SKILL.md`, §3; `skills/standup/SKILL.md`, Operating contract and §§3-4).
- **`standup-fanout` §5 vs `branch-closure` §6 — keep-both.** Both reproduce focused proof, but fanout checks each isolated tree in a batch and branch closure checks the current branch's ticket result; the evidence states can share names without sharing scope (`skills/standup-fanout/SKILL.md`, §5; `skills/branch-closure/SKILL.md`, §6).
- **`standup` Operating contract and §3 vs `initiative-standup` Operating contract and §5 — keep-both.** Both require evidence, status, and next proof, but one reports ticket-centered work and the other reports work with no ticket (`skills/standup/SKILL.md`, Operating contract and §3; `skills/initiative-standup/SKILL.md`, Operating contract and §5).
- **`standup-fanout` §§5-7 vs `branch-closure` §§4-8 — keep-both, with one status vocabulary.** Fanout reconciles a batch of verified tickets; branch closure maintains one branch's closure map and proposes destination changes, so they need shared status and proof terms but not one combined workflow (`skills/standup-fanout/SKILL.md`, §§5-7; `skills/branch-closure/SKILL.md`, §§4-8).
- **`standup-fanout` §§6-7 vs `standup` §§4, 6 — merge the write path.** Fanout should return verified evidence and proposed changes; the ticket-centered standup should be the single daily document that applies approved report changes, because both currently describe updating the standup and external records (`skills/standup-fanout/SKILL.md`, §§6-7; `skills/standup/SKILL.md`, §§4, 6).
- **`lc-ticketize` §§3, 6 vs `branch-closure` §§4, 6, 8 — keep-both, with closure ownership made explicit.** Ticketize defines the parent proof and lands the initial destination records; branch closure proves the current branch and handles a proposed close, so neither should claim the other's evidence (`skills/lc-ticketize/SKILL.md`, §§3, 6; `skills/branch-closure/SKILL.md`, §§4, 6, 8).

### Reporting

- **`standup` §§5-6 vs `initiative-standup` §§6-7 — keep-both.** They share a short report shape, but their entry conditions are deliberately different: ticket-centered daily work versus cross-project or no-ticket work (`skills/standup/SKILL.md`, §§5-6; `skills/initiative-standup/SKILL.md`, §§6-7).
- **`standup` §§5-6 vs `standup-fanout` §§7-8 — merge the result handoff.** Fanout should not create a competing daily plan; it should provide verified results for the existing standup to render and persist (`skills/standup/SKILL.md`, §§5-6; `skills/standup-fanout/SKILL.md`, opening boundary and §§7-8).
- **`standup` §§5-6 vs `branch-closure` §9 — keep-both, but add a handoff rule.** A branch report answers what one branch can close, while the daily standup answers what the reporting owner is doing; the files do not name who transfers a standalone branch result into the daily report (`skills/standup/SKILL.md`, §§5-6; `skills/branch-closure/SKILL.md`, §9). That missing transfer is a gap below.

## Gaps

- **GAP: no listed skill owns the understanding check before ticketization.** `lc-ticketize` checks for settled source material, while the vibe requires a system that guides and measures understanding; the listed standup skills collect, reconcile, and report evidence but do not name a user teach-back, spot question, or equivalent check (`skills/lc-ticketize/SKILL.md`, §2; `skills/standup/SKILL.md`, §§1-3; `skills/initiative-standup/SKILL.md`, §§2-5; `docs/vibe.md`, §V4; `docs/DECISIONS.md`, §D32).
- **GAP: no one listed owns the parent-close handoff after child proofs pass.** Ticketize, fanout, and branch closure all say that parent work remains open until its required proofs pass, but none names one owner who gathers all child evidence and applies the parent close in the destination (`skills/lc-ticketize/SKILL.md`, §§3, 6; `skills/standup-fanout/SKILL.md`, §2; `skills/branch-closure/SKILL.md`, §7; `skills/standup/SKILL.md`, §§4, 6).
- **GAP: no standalone branch-closure-to-standup handoff is specified.** Branch closure reports its own branch, and standup persists its own daily document; fanout has a fold-back rule, but the branch-closure file does not name an equivalent update path (`skills/branch-closure/SKILL.md`, §9; `skills/standup/SKILL.md`, §6; `skills/standup-fanout/SKILL.md`, §7).
- **GAP: no single shared sub-ticket data shape exists across the three decomposition points.** The files use related rules, but ticketize, fanout, and branch closure describe their own split outputs; the governing decision says the eventual ticketize revision must model one deliverable ticket plus enumerated sub-tickets (`skills/lc-ticketize/SKILL.md`, §3; `skills/standup-fanout/SKILL.md`, §2 and its ticket contract; `skills/branch-closure/SKILL.md`, §7; `docs/DECISIONS.md`, §D31).
- **GAP in the audited set: routine status flow into the durable readiness record is outside these skills.** The lifecycle document assigns the map and readiness record to `lc-project-state`, while noting that `lc-ticketize` fires once and does not sync tracker status back; neither the ticketize nor standup skills owns that durable status reconciliation (`docs/lifecycle.md`, §§63-66, 129-160; `skills/lc-ticketize/SKILL.md`, §6; `skills/standup/SKILL.md`, §6).

## What this means for `lc-ticketize`

**Verdict: needs work. Do not scrap it, and do not let standup replace it.** The lifecycle map gives `lc-ticketize` the tracker-item role and gives `branch-closure` the branch-closure role; the repo decision also says existing skills are seeds that may be rewritten, so the recommendation is based on the boundary evidence, not on preserving the current file (`docs/lifecycle.md`, §The six; `docs/DECISIONS.md`, §D33).

Keep these parts:

- **Settled-input gate.** Ticketize should continue to refuse an ununderstood idea as a finished ticket set, while naming the missing source or synthesis step (`skills/lc-ticketize/SKILL.md`, §2; `docs/DECISIONS.md`, §D35).
- **Destination and exemplar read.** It should continue to read the real destination before writing and match its fields and grain (`skills/lc-ticketize/SKILL.md`, §1).
- **Whole-set checks.** Its fake-decision, duplicate-owner, unclaimed-constraint, and overlap checks are not performed by the daily standup as a complete set (`skills/lc-ticketize/SKILL.md`, §4; `skills/standup/SKILL.md`, §4).
- **Back-map and decisions-to-force list.** These are useful outputs of the settled-plan-to-tickets handoff and are not part of the standup's daily rendering contract (`skills/lc-ticketize/SKILL.md`, §6; `skills/standup/SKILL.md`, §5).

Change these parts:

1. **Make the deliverable shape explicit.** Output one parent ticket per deliverable, enumerate and track its known sub-tickets, name dependencies, and state how child proofs keep the parent open; this is the active decomposition decision, not the older rule that every task must split into implement and verify (`skills/lc-ticketize/SKILL.md`, §3; `docs/vibe.md`, §V3; `docs/DECISIONS.md`, §§D26, D31).
2. **State the boundary against `standup`.** The input is settled thinking; the output is the complete ticket set and back-map. A daily standup may propose a small delta or apply an explicitly named change, but it should not redo the whole decomposition (`skills/lc-ticketize/SKILL.md`, §§2, 6; `skills/standup/SKILL.md`, §§3-4, 6).
3. **Use one ticket contract.** Keep one canonical fields, delta, duplicate, and sub-ticket contract; remove or redirect the duplicate fanout reference so the execution lane cannot drift from the ticket-set lane (`skills/lc-ticketize/SKILL.md`, §1; `skills/standup/references/ticket-contract.md`, §§Required fields, Delta format, Quality checks; `skills/standup-fanout/references/ticket-contract.md`, §§Required fields, Delta format, Quality checks).
4. **Name the proof handoff.** Ticketize defines the proof needed; fanout or branch closure reproduces it; standup reports it; one named owner must aggregate child proofs and apply a parent close (`skills/lc-ticketize/SKILL.md`, §§3, 6; `skills/standup-fanout/SKILL.md`, §§5-7; `skills/branch-closure/SKILL.md`, §§4, 6-8; `skills/standup/SKILL.md`, §§4, 6).
5. **Do not claim to own understanding measurement.** Keep the settled-input gate, but route the missing understanding check to a workflow that can guide and measure the user's model; the current files do not provide that mechanism (`skills/lc-ticketize/SKILL.md`, §2; `docs/vibe.md`, §V4; `docs/DECISIONS.md`, §D32).

This is a scope and contract revision, not a replacement. The standup skills answer "what matters in this report or execution session?"; `lc-ticketize` should answer "what is the complete, owned, decomposed work that came from settled thinking?" (`skills/standup/SKILL.md`, §§3-6; `skills/standup-fanout/SKILL.md`, opening boundary; `skills/lc-ticketize/SKILL.md`, §§2-6).

## Sources read

- `skills/lc-ticketize/SKILL.md`
- `skills/standup/SKILL.md`
- `skills/standup/references/ticket-contract.md`
- `skills/standup-fanout/SKILL.md`
- `skills/standup-fanout/references/ticket-contract.md`
- `skills/initiative-standup/SKILL.md`
- `skills/branch-closure/SKILL.md`
- `docs/lifecycle.md`
- `docs/vibe.md`
- `docs/taste.md`
- `docs/DECISIONS.md`, §§D20-D35
