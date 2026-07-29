# AGENTS.md

Personal agent skills, distributed via [`npx skills`](https://github.com/vercel-labs/skills).

This repo is the single source of truth for these skills across all of my machines. Every device installs from here and updates from here.

## The core rule: push to `main` immediately

**Any edit to a skill must be committed, pushed, and merged into `main` right away.** No feature branches, no draft PRs sitting around for skill changes — `main` is what `npx skills update` pulls, so an unpushed edit exists on exactly one machine and drifts from every other one.

After changing anything under `skills/`:

```sh
git add -A
git commit -m "<what changed>"
git push origin main
```

If you're on a branch for some reason, fast-forward it into `main` and push before considering the change done. A skill edit is not "done" until it is on `origin/main`.

Then, on any machine, pick up the change with:

```sh
npx skills update
```

## Repo layout

`npx skills` discovers one skill per subdirectory of `skills/`, each with a `SKILL.md` containing YAML frontmatter (`name`, `description`). Supporting files (`references/`, `scripts/`, `agents/`) live alongside the `SKILL.md` and are copied with it.

```
skills/
  <skill-name>/
    SKILL.md          # required: frontmatter + instructions
    references/       # optional: docs the skill loads on demand
    scripts/          # optional: executables the skill invokes
```

## Conventions

- **`name:` must equal the folder name.** `npx skills` keys on the folder; a mismatch shows as a broken skill.
- **No `nm-` (or any machine/org) prefix** on skill names here. These are published under their plain names. If a skill references a sibling skill by name, use the plain name too.
- **Keep skills self-contained.** A cross-reference to a skill that isn't in this repo is a dangling link once installed elsewhere — either vendor the dependency in or drop the reference.
- **Don't vendor other people's skills.** Skills installed via `npx skills` from someone else's repo (tracked in `~/.agents/.skill-lock.json`) stay theirs — install them, don't copy them in here.
- **Gitignore runtime state.** Files a skill writes at runtime (e.g. `.last_refresh`, refresh caches) must not be committed — they cause needless churn and conflicts across machines. Add a per-skill `.gitignore` for them.

## Deciding what's personal vs. installed

`~/.agents/.skill-lock.json` is the authoritative record of what `npx skills` installed and from where. Use it, don't guess:

- Anything **in the lock** came from someone else's repo — it stays theirs; never copy it into this repo.
- Only skills **not in the lock** are candidates to publish here — and only the ones you actually authored (watch for skills installed manually / copied into chezmoi that are still someone else's work; a skill written in another author's idiom, or one that tells you to run *their* setup command, is theirs even if it isn't in the lock).

## Renaming a skill (e.g. dropping a prefix)

When you rename a skill's folder, the name is referenced in more places than the folder:

1. **`name:` frontmatter** — must match the new folder name.
2. **Self-references** in prose, triggers, and `agents/openai.yaml`.
3. **Cross-references from sibling skills** — rewrite skill-name mentions to the new name (and update `north-star`-style "use `X` next" pointers).
4. **Leave non-skill references alone.** Agent references (`nm-*-reviewer`) point at subagents, not skills — don't rewrite them. Infra strings that merely share the prefix (e.g. a Docker image name like `preview-nm-usdh-account`, or a `${img_name#nm-}` strip) are not skill names — don't touch them.

Grep the whole skill dir for the old name and classify each hit before editing.

## Skills that depend on subagents

> ⚠️ **Unproven convention — have a strong model confirm before relying on this.** `npx skills` has no native mechanism for distributing subagents; the bundle-plus-install-script pattern below is our own bridge, not a standard. Revisit if the ecosystem grows a real answer (e.g. a shared agents dir).

`npx skills` distributes the *skill directory* but does **not** place subagents into a tool's agents dir (`~/.claude/agents`, etc.). A skill whose instructions dispatch subagents will silently install broken elsewhere unless the agents travel with it. The pattern (see `skills/contract-audit/` as the reference example):

- Bundle the agents the skill needs — including their transitive closure — in `skills/<name>/agents/*.agent.md`.
- Ship a `scripts/install-agents.sh` that links/copies them into the host tool's agents dir, and document the one-time step in `SKILL.md`.
- **Agents are shared infra, not owned by one skill.** Never mass-delete by glob (a broad `rm nm-*-reviewer` will take out agents other skills need). Operate on an explicit list.

## Installing on a new machine

```sh
npx skills add emo-eth/skills
```

Later, to sync the latest:

```sh
npx skills update
```

Note: `update` only refreshes skills already installed on that machine. Skills **newly added** to this repo are not pulled by `update` — install them explicitly (or re-run `add` interactively and pick them):

```sh
npx skills add emo-eth/skills --skill <name> [<name>...] -g -y \
  --agent amp antigravity antigravity-cli cline codex cursor deepagents \
          gemini-cli github-copilot kimi-code-cli opencode warp zed claude-code pi
```

(The `--agent` list mirrors `lastSelectedAgents` in `~/.agents/.skill-lock.json`; adjust per machine.)

To install **every** skill in the repo, use the undocumented wildcard — quoted, so zsh doesn't glob it: `--skill '*'`. (The interactive picker has no select-all; that's an upstream gap, [vercel-labs/skills#439](https://github.com/vercel-labs/skills/issues/439).)
