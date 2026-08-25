---
name: create-verification-skill
description: "Generate a globally installed OMP verification skill that drives an app through its real user surface. Use for /create-verification-skill, \"make a control skill for this repo\", or when a project has no repeatable UI, CLI, or service proof."
disable-model-invocation: true
---

# Create a verification skill

Every serious project needs a repeatable way to drive the real app and prove behavior. This workflow writes `~/dev/skills/skills/verify-<app>/` as the source of truth, then installs it for OMP. It never writes directly into an installed-skill directory.

## 1. Interview the repo, not the user

Answer these from the codebase and only ask the user what you cannot observe:

- **Surface:** what does a user actually touch? A web UI, a CLI/TUI, a desktop app, an API, a mobile app, a library? A repo can have several; pick the primary one and note the rest.
- **Run:** how does the app start locally? Prefer the repo's own documented dev command (package scripts, Makefile, README quickstart). Note ports, env vars, seed data, auth.
- **Drive:** how can OMP interact with it? Prefer existing harnesses. Use the OMP `browser` tool for web or Electron, an actual PTY or OMP-managed process for CLI/TUI, the `debug` tool for runtime state, and HTTP for services. Use `read`, not a browser, for static pages.
- **Observe:** what evidence can be captured? Screenshots, terminal transcripts, response bodies, logs, exit codes, DB state.
- **Isolate:** can two instances run side by side (ports, data dirs, profiles)? If not, say so in the generated skill: refusing to double-drive a shared instance beats corrupting the user's session.

If the checkout doesn't build or start as-is, fix that first (or report it precisely) before generating; a skill written against a broken base teaches wrong steps. When an irrelevant missing asset blocks startup (a static dir the API never serves, a sample config), the generated skill may create it, clearly marked as verification scaffolding, and remove it in cleanup.

## 2. Generate the skill

Read `skill://poteto-mode/playbooks/authoring-a-skill.md`. Write `~/dev/skills/skills/verify-<app>/SKILL.md` with `name: verify-<app>` and a description that names the app, user surface, and trigger. The folder and frontmatter name must match. Leave no placeholders.

- **Launch:** the exact command and readiness signal. Use OMP `hub start` for agent-owned services and terminal sessions that need later input. For a server the human will keep using across turns, follow the global detached-server rule instead of a harness-tracked job. Include teardown.
- **Doctor:** one read-only check that answers "is this instance worth driving?" — process up, right version/build, port owned by us, auth valid. An agent runs this first whenever anything looks off.
- **Drive:** the harness recipe with real selectors/commands from this repo, not examples. Prefer stable handles (ARIA labels, data attributes, prompt strings, route paths) over coordinates and tab order.
- **Evidence:** what to capture for a proof and where it goes. State the proof standards: exercise the real user path, not internal setters or test-only endpoints; capture the action and the resulting state, not just the final screen; verify side effects (files written, rows inserted, messages sent) alongside what's visible; mocks only where a production boundary already isolates the external system. When the safe path is a dry-run or test mode, verify what it actually skips by observing (files, network, git refs) rather than trusting its name: some dry-runs still touch the network or open a browser.
- **Cleanup:** how to tear down instances the run created. Never kill by process name; kill what you started. Cleanup removes instances and scratch state, never the evidence: proof artifacts survive the teardown, in a location the skill names.
- **Helpers:** any script the skill ships is executable and its invocation is shown in the skill body. A helper the reader has to reverse-engineer is not a helper.

## 3. Seed the feature map

Create `~/dev/skills/skills/verify-<app>/features/README.md` plus one file per important user-facing feature. Start with the top 3-5 from routes, commands, menus, or docs. Follow [`references/feature-map-example/`](references/feature-map-example/). Each file explains what the feature is, how a user reaches it, how OMP drives it, and what observable end state proves it works.

## 4. Prove the generated skill before handing it over

Run the new skill end to end: launch, doctor, drive one mapped feature, capture evidence, and clean up. Web UI proof must use the OMP `browser` tool against the actual page. CLI or TUI proof must run the actual program. After cleanup, confirm the evidence still exists. Fix failures and clean each failed attempt. An unexecuted skill is a draft.

## 5. Offer the maintenance loop

Follow `~/dev/skills/AGENTS.md`: update project state when needed, commit, push `main`, and install the new skill with `npx skills add emo-eth/skills -g -s verify-<app> -y`. Then point the user at `/maintain-verification-skill`.
