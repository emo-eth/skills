### Authoring or modifying a skill

**You own the skill's behavior and context cost.** Agent-facing prose changes future decisions.

1. **Choose invocation.** Use `disable-model-invocation: true` when only the user should start the skill. Omit it when OMP must discover the skill or another pstack skill routes to it. A model-invoked description names every distinct trigger branch in one compact pointer.
2. **Design the information path.** Put ordered actions in the main `SKILL.md`. Put branch-specific reference behind relative links. Keep each meaning in one source of truth. Every step ends with a checkable completion condition.
3. **Write in the source repo.** Work only in `~/dev/skills/skills/<name>/`. The folder and frontmatter `name` must match. Include `description`. Preserve supporting files beside the skill. Never edit an installed-skill directory.
4. **Validate.** Check YAML frontmatter, relative links, sibling skill names, OMP tool names, and runtime paths. Remove dangling dependencies. Test structural behavior and executable helpers; skip subjective tests.
5. **Land and install.** Follow `~/dev/skills/AGENTS.md`: update project state when needed, commit, push `main`, then install or refresh with `npx skills`.

Delete no-op prose. State the target behavior directly. Use reasons only when the rule is hard to understand without one. Point at stable types and config instead of copying facts that tools can read.

**Reply:** skill path, invocation choice, behavior changes, validation evidence, commit, push, and install result.
