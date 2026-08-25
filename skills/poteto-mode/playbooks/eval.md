### Eval

**You own the experiment design. Plan, blind, run, synthesize.**

Evals test how a change affects agent behavior before promoting it: a new skill variant, a structural change, a prompt tweak. The failure mode is the observer effect. An agent that knows it's being evaluated behaves differently, so candidates must run blind.

**Non-negotiables for blinding:**

- No `eval`, `test`, `judge`, `experiment`, `rubric`, `score`, `compare`, `benchmark`, `candidate`, or `arena` in any directory, file, or prompt the candidate sees.
- The candidate prompt looks like an organic user request. State the goal, not the meta. "build me a small todo cli" not "show me how you follow the principles chain".
- No chain-eliciting cues. Don't ask the candidate to list which skills, principles, or files they applied; that meta-prompt inflates citation behavior. Ask for design notes generally and grade chain-following from code shape, not self-report.
- Sanitize directory and slug names. Use project-shaped names a user might pick, not labels like `candidate-1` or `agent-a`.
- Don't tell the candidate other candidates exist.
- The judge sees outputs by sanitized label only, never by agent type.
- One judge scores every variant in one pass on one scale.

**Steps:**

1. **Frame.** State what variant is under test and what behavior counts as success. Write the rubric (3-6 concrete criteria) for the judge only. Hold it back from candidates.
2. **Set up sanitized environments.** Per-candidate working dir with the variant in place. Plant any context an organic task would have: a project skeleton, the skills the candidate would naturally read.
3. **Author one organic prompt.** What a user would type. No leakage of what's being measured.
4. **Spawn N independent candidates** in one OMP `task` batch per Arena Phase B. Each works in its own sanitized directory or returns a separate patch. OMP may use one model family; do not claim model diversity.
5. **Spawn one blinded reviewer** per Arena Phase C after candidate outputs are final. It sees sanitized labels and the rubric.
6. **Verify the chain from transcripts, not self-report.** Use `agent-conv` when available to resolve only the OMP candidate sessions for the active workspace. Otherwise inspect the matching workspace under `~/.omp/agent/sessions/`. Grade observed skill reads and output shape.
7. **Read every candidate output yourself** end to end. Compare it with the judge's verdict. Disagreement can mean reviewer bias or an ambiguous rubric. Synthesize.

**Reply:** variant under test, rubric, per-candidate notes, judge's verdict, your synthesis, and a recommendation for whether to promote the variant.
