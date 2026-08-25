---
name: automate-me
description: "Use for \"automate me\", \"create/update/refresh my -mode skill\", or turning the user's working style into a durable OMP skill. Mines OMP transcripts, writes through pstack's authoring playbook, and installs from the personal skills source."
disable-model-invocation: true
---

# Automate me

A guided flow for turning the user's working conventions into a skill agents will follow. The output is one `-mode` skill tailored to them (e.g. `jay-mode`, `priya-mode`).

This skill coordinates transcript mining, the **Authoring a skill** playbook, and the **unslop** skill.

## Flow

### 0. Check for an existing skill

Search `~/dev/skills/skills/**/*-mode/SKILL.md` for the user's handle. If one exists and the user did not already say update or replace, use the OMP `ask` tool to choose:

- Update the existing skill. Default for repeat runs.
- Start fresh. Use only when the current shape is no longer useful.

Update mode changes the rest of the flow:
- Step 1 mines only history since the skill was last edited (`git log -1 --format=%cI <path>`).
- Step 2 asks what's changed or missing, not what to capture from zero.
- Step 4 edits the existing file in place. Preserve sections the user hasn't contradicted; revise ones with new evidence; add new sections only for genuinely new rules.

### 1. Mine their history

Use the exact current directory with `agent-conv read <workspace> --source omp` and `agent-conv thread` when available. Otherwise inspect only this workspace under `~/.omp/agent/sessions/`. Never search another workspace unless the user names it.

Survey recent conversations for recurring patterns. Split a large time range into independent slices and launch all mining work as `scout` tasks in one OMP `task` batch. Each scout returns a short list with session IDs as evidence.

- Response preferences (length, tone, format, "dumb it down" corrections)
- Delegation habits (subagents, OMP agent types, specialized workflows, parallelism)
- Verification posture (what "done" means; unit tests vs live repro; reviewers)
- Code and prose discipline (style, principles cited, lint/format tools)
- Process conventions (worktrees, commits, PRs, review/merge tooling)
- Meta preferences (fixing skills mid-task, proposing new ones)

Cross-check across slices before elevating a signal. Patterns seen in 2+ slices are high-confidence; lone signals are weak and usually get dropped.

### 2. Ask the user directly

Mining misses intent that has not appeared in history. Use the OMP `ask` tool with one or two questions and 4-5 concise options. Set `multi: true` for category questions. Ask one free-form follow-up only when the choices cannot capture the missing preference.

Don't dump 20 questions. Two structured rounds plus one open question is usually enough.

### 3. Cluster findings

Group the combined signals into sections. Common ones (use only what applies):

- **Response style**: length, tone, format.
- **Autonomy**: how much to do without asking; MCP tool use.
- **Understand first**: which skills to reach for when scoping or investigating a change.
- **Subagents**: default agent types, parallelism, and specialized workflows.
- **Prose / code discipline**: principles, lint tools, style guides.
- **Review and verify**: repro posture, verification skills, live-testing tools.
- **Process**: git worktrees, commits, PRs, review/merge tooling.
- **Skills**: skill-authoring habits, fix-the-skill-first, proposing new skills.

The **poteto-mode** skill shows the shape. Read it for granularity. Don't copy its content; the user's rules are not the same as poteto-mode's.

### 4. Draft the skill

Read `skill://poteto-mode/playbooks/authoring-a-skill.md` before drafting.

- Path: preserve an existing category. New mode skills go in `~/dev/skills/skills/<handle>-mode/SKILL.md`.
- Handle: the user's first name or chosen identifier.
- Frontmatter `name`: equal the folder name.
- Frontmatter `description`: trigger on the handle, `/<handle>-mode`, and requests to work in that style. Avoid generic coding triggers.
- Set `disable-model-invocation: true` unless the user explicitly wants automatic invocation.

### 5. Iterate on prose

Apply the **unslop** rules and the **Authoring a skill** playbook to every line.

Show the draft to the user and take feedback. Expect multiple iterations. Cut ruthlessly; a mode skill is not a manual.

### 6. Land it

Follow `~/dev/skills/AGENTS.md`. Commit the skill, push `main` immediately, and install or refresh it with `npx skills`. Do not write directly into `~/.agents/skills` or `~/.omp/agent/skills`.

## Guardrails

- **Don't overfit to one conversation.** A preference stated once and contradicted another time is noise. Require multiple instances before codifying it.
- **Don't be clever.** Restating other skills' contents, inventing metaphors, or writing "poetic" prose for an agent reader is cost without benefit. Keep it operational.
- **Reference, don't inline.** Other skills the user relies on should appear as path references, not pasted excerpts. Same for any principle docs they maintain elsewhere.
- **Keep sections minimal.** Only add a section if the user has a specific, non-default rule there. "Communicate clearly" is not a section. "Short paragraphs. Tables when comparing options. Bullets only when items are genuinely parallel." is.
- **Name conventions generic.** Use "the user" or "the human" in imperatives, not the author's first name. Others may read or adopt the skill.
- **Don't force symmetry.** If a user has no process rules worth writing down, skip the Process section entirely. Sparse is fine; bloated is not.

## Evaluation

A `-mode` skill is subjective output. Ask whether the draft reads like the user's real rules and revise it. Run trigger evaluation only when invocation accuracy is the reported problem.

Run a description-optimization loop only if the skill's trigger accuracy turns out to be a problem in practice.

## When not to use

- User wants a task-specific skill: use the **Authoring a skill** playbook without transcript mining.
- User wants one narrow workflow: write a regular skill, not a mode skill.

## Reference files

- The **poteto-mode** skill: example of the output shape.
- The **unslop** skill: prose discipline for every line.
- The **Authoring a skill** playbook: OMP skill authoring and invocation mechanics.
