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

## Installing on a new machine

```sh
npx skills add emo-eth/skills
```

Later, to sync the latest:

```sh
npx skills update
```
