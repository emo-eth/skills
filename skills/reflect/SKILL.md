---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

## When to invoke

- The user said "reflect" or "/reflect".
- A complex task (5+ tool calls) just landed cleanly and the recipe is worth keeping.
- The agent hit dead ends, found the working path, and the path generalizes.
- The user corrected the agent's approach mid-task.
- A non-trivial workflow emerged that isn't captured anywhere.

Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## Process

### 1. Locate the active transcript

Use `agent-conv thread <current-workspace> --source omp` when available. The exact current directory is the workspace query. Otherwise inspect only the matching workspace under `~/.omp/agent/sessions/`, order candidates by modification time, and match the opening user prompt. If no path resolves, write a tight session digest.

### 2. Spawn three reviewers in parallel

Launch three read-only reviewers in one OMP `task` batch. Read `reflect-judgment` and `reflect-tooling` from `~/.config/pstack/omp-agents.json` when present. Otherwise use `reviewer` for all three. The prompts forbid file writes; the parent applies approved edits.

| Lens | OMP agent role | Prompt template |
|---|---|---|
| Judgment | `reflect-judgment` | `references/judgment-reviewer.md` |
| Tooling | `reflect-tooling` | `references/tooling-reviewer.md` |
| Divergent | `reflect-judgment` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the `task` result.

### 3. Synthesize

Spawn one read-only synthesis task. Use `reflect-judgment` from the OMP config, or `reviewer` by default. Use `references/synthesizer.md` verbatim and pass large reviewer outputs through `local://` artifacts. The synthesizer returns Accepted / Rejected / Backlog.

### 4. Structural enforcement check

Sanity-check the synthesizer's Accepted list. For any item that would be enforced more reliably by a lint rule, script, metadata flag, or runtime check, move it from Accepted to Backlog. The synthesizer already applies this criterion; this is a final pass before edits land. See the **encode-lessons-in-structure** principle skill.

### 5. Apply

Before applying any Accepted edit, present the synthesizer's full Accepted/Rejected/Backlog output to the user and wait for explicit approval. The user picks which subset to apply and may redirect routings. Skill changes affect every future agent in the org; do not auto-apply.

Report Backlog items. File one only when the user asked for tracker updates and the tracker tool is available.

For each approved Accepted item, follow the Routing field exactly:

- Trivial existing-skill edit: apply it directly in `~/dev/skills/skills/<name>/`.
- Substantive edit, trigger tuning, or new skill: follow `skill://poteto-mode/playbooks/authoring-a-skill.md` in `~/dev/skills`.
- After any approved skill edit, follow `~/dev/skills/AGENTS.md`: update project state when needed, commit, push `main`, and refresh the installed skill with `npx skills`.

Validate every changed skill by checking its frontmatter, folder/name match, relative links, and OMP-only tool vocabulary.

### 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog reported or filed: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
