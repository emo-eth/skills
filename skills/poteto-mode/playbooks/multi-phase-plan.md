### Multi-phase or multi-PR plan

**You own the plan, not the code. The plan is a checklist an owner runs box by box and the operator audits from the evidence.** For work that spans phases or stacked PRs. The plan is the deliverable. Do not implement.

1. When the change is one or two files with an obvious approach, skip the plan. Say so and stop.
2. Settle open questions by prototype before writing. Measure layout, timing, behavior, and API viability. Ask the operator only about a product or preference call that no run can settle.
3. Explore with independent read-only agents through `pstack-runtime`. Prefer the registered `poteto-agent`; otherwise use a read-only worker whose first instruction is to read poteto-mode. Each returns file pointers, conventions, focused checks, and entry points. Keep raw dumps out of the parent context.
4. Copy the skeleton below into the plan file and fill every placeholder. Unless the operator names a path, write under the repository's `docs/`. Keep every heading and sub-block in order. One section per PR. Name the execution playbook in **How to read this**. Pick `autopilot-full.md`, `autopilot-stack.md`, or `orchestrate.md` from the work shape.
5. Write under `/technical-writing`, then `/unslop`. The body is one Diátaxis how-to. Appendices hold explanation and reference. Two rules apply verbatim. "i dont want any abstract metaphors" and "write like hemingway". Each heading states a task or finding. No long dashes. No mid-sentence colons.
6. Run `node skills/poteto-mode/scripts/check-plan.mjs <plan.md>` and fix every line it prints. It enforces the skeleton, the verification rule, ten live lanes, perf evidence, and punctuation.
7. Return the plan path and checker output, then stop. Execution starts only on the operator's explicit go under the named execution playbook.

**Verification.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Every verification block opens with that sentence. The live block is mandatory. Ten independent live lanes at the PR head drive the actual surface through the current host's control tool per **swarm**. Each lane names a concrete scenario, saved evidence, and a pass predicate. The perf block names the metric, probe, trunk baseline, and numeric failure rule. Interaction changes wait for operator review with screenshots and a video.

**Control tool.** OMP uses `browser`, the actual CLI or TUI, and an available debugger. Pi uses `agent_browser`, the actual CLI or TUI, and an available debugger or profiler. A change spanning surfaces gets lanes on each. A missing control tool is a risk in Appendix C and does not turn a proxy into live proof.

````markdown
# <Program> plan

<Under ten lines. What changes, for whom, the rule the program enforces, and the PR ids in order.>

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, such as a file, log line, screenshot, test run, or SHA. The body is a how-to. The appendices explain and record.

The program runs `skills/poteto-mode/playbooks/<execution playbook>.md`. <Who merges, and which PR ids are the operator's items that stop at merge-ready.>

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on explicit go.
- [ ] On go, create the current host's `todo` list with the plan path, PR ids in order, verification rule, merge owner, and done condition.
- [ ] Read the execution playbook, swarm skill, control-tool contract, opening-a-pr playbook, and every other leaf skill the program uses from the current installation. Re-read them at every audit tick.
- [ ] Arm a 30-minute audit tick through the current host's managed background-process tool. Prefer event-driven watchers and use one bounded heartbeat only when no event source exists.
- [ ] Use this status message at every tick. "Re-read the execution playbook and active todo contract. Audit the operation against both and fix drift now. Probe every active lane by side effects. Replace a stuck lane. Then report the queue of PR, owner, state, head SHA, verdicts, merges, operator gates, and blockers."
- [ ] On hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names through the current host's parallel-agent tool.
- [ ] Follow this dependency graph. Start dependent work after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] <PR id> and <PR id> are independent and first. Both branch from `main`.
  - [ ] <PR id> after <PR id>.
- [ ] Hold file boundaries. <PR id or class> touches only `<glob>`.
- [ ] Hold the review gate. <PR ids> change an interaction. They wait for operator review with screenshots and a video.

### PR mechanics, for every PR

- [ ] Open the PR ready, never draft, with `gh pr create --draft=false`, or with Graphite for a stack.
- [ ] Run the repository's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run `/unslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `skills/poteto-mode/references/bugbot-triage.md`.
- [ ] Rebase onto current trunk before babysit and again before the merge-ready report.

### Verdict and merge, for every PR

- [ ] At the merge-ready head SHA, run swarm. One gates lane, the ten live lanes from **Verify, live**, the perf lane from **Verify, perf**, and one audit lane that reads the diff and receipts and distrusts the PR body.
- [ ] Clean only when every lane is `PASS`. Findings return to the owner. A new head gets a fresh swarm and verdict.
- [ ] <The merge or append rule from the execution playbook, with the patch-id rule from shipping.md.>

### Boot recipe, for every live lane

Each live lane uses an isolated worktree at the PR head. Drive through the current host's control tool.

- [ ] Fetch `<head branch>` and prepare an isolated worktree at `<head SHA>` without changing another lane's checkout.
- [ ] <Start the backend and surface. Wait for the readiness predicate.>
- [ ] <Deliver input only through the control tool. Name read-only diagnostics.>
- [ ] Save evidence to `/tmp/swarm-<pr-id>/worker-<n>/<slug>` and return the path with the report.

## <Task as a verb phrase> (<PR id>)

**Depends on.** <PR id, or None.>

**Files.**

- [ ] Edit `<path>`.
- [ ] Create `<path>`.
- [ ] Delete `<path>`.

**Build.**

- [ ] <One change. Name the symbol and file.>

**You see.**

- [ ] <One observable result, with the exact log line or screen state.>

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] <Test file and the case it gains.> Run `<command>`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten independent live lanes at the PR head, per the boot recipe.

- [ ] Lane 1. <Scenario.> Save `<slug>`. Pass when <predicate>.
- [ ] Lane 2. <Scenario.> Save `<slug>`. Pass when <predicate>.
- [ ] Lane 3. <Scenario.> Save `<slug>`. Pass when <predicate>.
- [ ] Lane 4. <Scenario.> Save `<slug>`. Pass when <predicate>.
- [ ] Lane 5. <Scenario.> Save `<slug>`. Pass when <predicate>.
- [ ] Lane 6. <Scenario.> Save `<slug>`. Pass when <predicate>.
- [ ] Lane 7. <Scenario.> Save `<slug>`. Pass when <predicate>.
- [ ] Lane 8. <Scenario.> Save `<slug>`. Pass when <predicate>.
- [ ] Lane 9. <Scenario.> Save `<slug>`. Pass when <predicate>.
- [ ] Lane 10. <Scenario.> Save `<slug>`. Pass when <predicate>.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. <What is measured.>
- [ ] Probe. <The command or procedure, run at trunk and head in interleaved order.>
- [ ] Baseline. Record the trunk <value> first.
- [ ] Rule. <Head against trunk, with the number that fails.>

**Review gate.** The operator reviews before merge.

- [ ] Copy lane <n> screenshots into `<media path>/<pr-id>-review-<slug>.png`.
- [ ] Record a 30 to 60 second video. Save it as `<media path>/<pr-id>-review.mp4`.
- [ ] Post the screenshots and video in chat. Stop at merge-ready. Wait for the operator's decision.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] <The owner squash-merges, or the root appends the PR to the stack and the operator lands it.>

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

<Each open question a prototype answered, with branch, SHA, and artifact links. Each question that stays unproven.>

## Appendix B. Alternatives rejected

<Each approach weighed and why it lost.>

## Appendix C. Risks

<Each risk with the PR it lands in and what the owner watches.>

## Appendix D. Links and reading list

<Docs to read before editing. Which PRs use how and interrogate. The decision trail path.>
````

**Reply:** the plan path, PR ids and dependencies, review-gated set, prototype findings, remaining unknowns, and checker output.