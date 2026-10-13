# EMO-548: prioritize-tickets: hierarchical binning, do-next quick-pick, and elo recency decay for fast ticket ranking

## What problem are you trying to solve?

The current ticket prioritization system relies on exhaustive pairwise comparisons (`prioritize-linear-tickets.ts`), which causes severe operator fatigue as backlog volume grows ($O(N \log K)$ comparisons over dozens of tickets). There is no rapid "do-next" mode to quickly pick the immediate top 1–3 outcomes, low-priority tickets either trigger repetitive re-prompts or languish forgotten without recency tracking, and prioritization cannot seamlessly pause and resume across CLI and conversational agent interfaces.

## Why is it important?

Prioritization governs the Command Center loop (Know → Rank → Dispatch). When ranking requires a 30-question comparison gauntlet, the operator avoids doing it, resulting in unranked backlogs and stalled dispatch. Prioritizing must be fast, tiered, and low-friction so high-impact work is surfaced immediately while the broader backlog remains healthy without constant re-sorting.

## What does it feel like in use?

Effortless, tiered, and fast. The operator can invoke a fast "Do-Next" mode to select the immediate 1–3 actionable tickets in under 30 seconds. For larger backlogs, the system uses coarse hierarchical binning (Now / Next / Later) before fine comparisons. Each ticket retains an approximate Elo score and `last_reviewed_at` timestamp: high-confidence items are settled, low items remain parked without nagging, and neglected tickets gently resurface after extended inactivity. The session is completely resumable, whether run via CLI/TUI or inline via agent command.

## Deliverables

* Upgraded prioritization engine supporting hierarchical binning and Elo-style scoring with review recency decay.
* Instant "Do-Next" fast-path mode (`--do-next` / interactive quick-pick) isolating top outcomes in minimal steps.
* Persistent state store capturing comparisons, Elo ratings, and `last_reviewed_at` timestamps.
* Expose prioritization engine as library function `nextQuestion(state) -> question | done` for external agents.
* Conversational bridge/plugin for inline prioritization inside agent sessions alongside the CLI: https://linear.app/emo-eth/issue/EMO-566/conversational-bridge-plugin-for-inline-ticket-prioritization
* Benchmark and unit test suite verifying $> 60\%$ reduction in required operator comparisons on large backlogs.

## What does completed look like?

Prioritizing a backlog of 50 tickets requires $\le 8$ human decisions to determine the immediate top-3 "do-next" queue. Ticket review timestamps and Elo estimates persist cleanly, preventing unnecessary re-comparisons, and any interrupted session resumes without data loss.

## Validation steps for reviewers

`bun test tools/prioritize-core.test.ts` passes, asserting binning correctness, Elo updates, recency decay thresholds, and state persistence.
Running the benchmark suite demonstrates a reduction from $\approx 35$ comparisons down to $\le 8$ comparisons for top-3 selection from 50 tickets.

## Environment limits & User Validation needs

None: 100% pre-merge testable.
