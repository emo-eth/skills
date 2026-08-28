---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

Read `pstack-runtime` before the first host-specific operation.

Fan out N parallel tasks through the current host. They can cover separate slices, race the same brief, or mix both. The parent drains the background jobs, aggregates them, and returns one report.

## Start

Open the current host's `todo` list with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is total workers, not an executor limit.
4. Read `swarm-workers` from `~/.config/pstack/omp-agents.json` when present. Otherwise use `default`, which omits the `agent` field. For an agent-type race, name each arm up front and do not claim model-family diversity unless the OMP configuration proves it.
5. Give each writer disjoint file ownership. When candidates race on the same artifact, they return patches or write separate `local://swarm-<slug>-worker-<n>.md` artifacts instead of editing one shared path.

## Phase B: Fan out

Spawn all N workers in one OMP `task` batch. OMP task batches are asynchronous, so do not serialize them or start separate calls. Use `scout` for read-only repository research. Use the configured agent type for other work, omitting `agent` when the value is `default`.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.
