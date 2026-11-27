# Iteration Log: lc-north-star gap analysis and refinement

## Raw Friction Entries

### Entry 1: Runtime Defect Observations Polluting the VRD
- **What happened:** When the operator observed that the running command-center loop wasn't prioritizing tickets, wasn't parking worktrees, and wasn't pulling fresh work, the agent interpreted this as a problem with the VRD's "Problem As Felt" and rewrote the VRD to document those three bug reports.
- **Why it failed:** The operator pointed out: "The friction points I described don't belong in the vibe or the VRD... that's not a vibe, that's just an observation that's not how it feels to use the thing... If we observe behavior that is unwanted that means we should look at the PRD... First check if the vibe is underspecified... If the vibe isn't underspecified, look to the PRD."
- **Skill gap:** `lc-north-star` lacks an explicit quality gate and workflow directive for **Runtime Defect Triage**: The VRD is timeless qualitative feel; runtime operational bugs must never be written into the VRD. The skill must codify the triage hierarchy ($Vibe \rightarrow PRD \rightarrow Spec \rightarrow Implementation$).
- **Verdict: KEEP**
- **Reason:** Every agent reading `lc-north-star` faces the temptation to edit the VRD when a user says "X isn't working". Adding the explicit triage rule ("Do not write bug reports into the VRD; evaluate Vibe $\rightarrow$ PRD $\rightarrow$ Spec $\rightarrow$ Implementation") prevents this fundamental layering failure across all projects.

### Entry 2: Missing "Underspecified Gate" Before Worker Dispatch
- **What happened:** Workers were repeatedly dispatched with hollow ticket stubs (e.g. `EMO-446`, `EMO-370`) containing model jargon ("The ticket is a face. Work stays in the tree. The work named here is finished... before any funeral").
- **Why it failed:** Step 6 ("Produce The Ticket Spec") says "validate its structure and criteria before dispatch", but defines no operational gate or rubric. It doesn't classify tickets as `SPECIFIED` vs `UNDERSPECIFIED` vs `NEEDS_HUMAN_NUANCE`, and doesn't define the 4 concrete anti-vibes (The Hollow Ticket, Prescriptive Vibe, Tautological Done-When, The Unmapped Orphan).
- **Skill gap:** Step 6 needs an explicit **Specification Sufficiency Gate** (the "Underspecified Gate") with concrete criteria for when to pull work automatically vs when to auto-repair or prompt the operator for human nuance.
- **Verdict: KEEP**
- **Reason:** Step 6 currently assumes ticket authoring equals dispatch readiness. Without the Underspecified Gate and its 4 anti-vibes (The Hollow Ticket, Prescriptive Vibe, Tautological Done-When, The Unmapped Orphan), agents routinely dispatch hollow stubs or stall waiting for permission.

### Entry 3: Hollow Merge Pressure and Missing Merge Presentation Standard
- **What happened:** The dispatcher pushed the operator to merge PR #1328 on `EMO-370` simply because the worker marked `agent_status: "done"`, despite the PR title literally saying `(do not merge)`, test keys being unconfigured, and the ticket spec being a hollow stub.
- **Why it failed:** The operator felt severe friction: "how do i know what this PR does? how do i know it actually works? the main loop (outdated) is pushing me to merge PRs with terrible ticket specs".
- **Skill gap:** Step 7 ("Grill Downstream Artifacts") and the Finish Gate lack the **Two Mandatory Answers for Any Merge Presentation**: (1) What does this PR actually do? (2) How do we know it actually works? The skill must strictly forbid pushing merges on hollow tickets, WIP PRs, or unproven outcomes.
- **Verdict: KEEP**
- **Reason:** The ultimate failure test is human trust at the finish line. When an agent presents a PR for merge without answering "what does this PR do?" and "how do we know it works?", the operator is forced to do manual code audits. Codifying the Two Mandatory Answers and the prohibition on hollow merge pressure protects operator trust across all projects.

---

## Pruning & Integration Plan (Step 5)

1. **Entry 1 -> Fold into Artifact Rules & Quality Gates in `SKILL.md`**:
   - Add **No bug reports in the VRD**: Runtime operational defects are not requirements changes. Evaluate Vibe -> PRD -> Spec -> Implementation.
2. **Entry 2 -> Fold into Step 6 in `SKILL.md` and reference in `references/ticket-spec.md`**:
   - Integrate the **Specification Sufficiency Gate ("Underspecified Gate")** into Step 6.
   - Document the 4 anti-vibes and tri-state verdict (`SPECIFIED`, `UNDERSPECIFIED`, `NEEDS_HUMAN_NUANCE`) in `references/ticket-spec.md`.
3. **Entry 3 -> Fold into Step 7 & Finish Gate in `SKILL.md`**:
   - Expand Step 7 to include **Merge Presentation Standards**: The Two Mandatory Answers and the prohibition on hollow merge pressure.
