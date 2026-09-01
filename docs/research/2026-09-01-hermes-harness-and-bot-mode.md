# Hermes, Grok Bot, OMP, and Pi: Raw Harness Research

## Status and evidence tiers

This dossier records raw evidence for deciding where a personal agent, persistent domain Bots, ephemeral subagents, communication, routines, and chat UI should run. It intentionally does not select a winner; the shaped decision brief lives in `docs/summaries/2026-09-01-personal-agent-harness-decision.md`.

- **[verified-live]** — exercised on this workstation or recorded by an existing live-host verification receipt.
- **[documented]** — stated by current official documentation or directly visible in source, but not exercised here.
- **[inferred]** — analysis derived from documented facts.

## Stakeholders

- **[documented] User** — explicitly wants raw research and a concise decision summary about using Hermes instead of Grok Bot, OMP, or Pi; the trust boundary excludes granting a third-party-controlled computer broad tailnet access.
- **[inferred] Future implementer** — needs source-pinned contracts for Bot specification, tools, skills, prompts, memory, subagents, communication, UI, deployment, and adapter seams.
- **[inferred] Fresh repository agent** — needs current-state pointers that distinguish verified behavior from proposed architecture and prevent inheritance of stale Hermes/OMP conclusions.

## Existing artifact inventory

| Artifact | Tier | Contents and current value |
| --- | --- | --- |
| `docs/log/2026-08-30-pi-bots.md` | verified-live | Canonical Pi Bots record: `BOTS.yml`, single-owner domains, generated `pi-subagents` roles, private memory, owner state, 84 focused tests, and a live chief-of-staff → research run. Still authoritative for the implemented Pi surface. |
| `plugins/pi-bots/README.md` | documented | User contract and honest boundary: Pi Bots adds no chat transport, inbox, daemon, or UI. |
| `plugins/pi-bots/BOTS.example.yml` | documented | Four-role starter roster showing shared/default instructions, tools, delegates, memory, context, timeout, and depth. |
| `plugins/pi-bots/src/config.ts` and `src/types.ts` | documented | Strict per-Bot schema: identity, domains, instructions, model/fallbacks/thinking, tools, skills, delegates, memory, context, timeout, depth, and enabled state. Unknown fields and invalid ownership fail closed. |
| `plugins/pi-bots/src/runtime.ts` and `src/materialize.ts` | documented | Compiles the roster to immutable native Pi agent files with replace-mode prompts, mandatory coordination tools, model fallback, skills, and nested delegation. |
| `plugins/pi-bots/src/host.ts`, `src/subagents.ts`, `src/state.ts`, `src/safe-fs.ts` | documented | Foreground structured delegation, owner-only domain records, private memory, path containment, cross-process locking, and model-callable Bot tools. |
| `plugins/pi-bots/tests/*.test.ts` | verified-live | Focused behavior and adversarial coverage recorded as 84 passing tests. |
| `docs/log/2026-08-31-omp-bot-feasibility.md` | verified-live | OMP v18.0.11 source/SDK audit plus live `rpc-ui` smoke. Correctly separates the OMP execution kernel from durable Bot identity, messages, work, and UI. |
| `docs/log/2026-08-31-hermes-pi-hybrid.md` | documented | Existing hidden synthesis recommending Hermes coordination over Pi RPC. Valuable seam analysis, but its Hermes snapshot predates the current integrated Bot Mode, durable DM failure model, Kanban, and documented Pi-compatible RPC mapping. Its recommendation must be re-derived. |
| `docs/log/2026-08-28-hermes-extension-porting.md` | verified-live | Proves a native Python Hermes plugin can intercept and rewrite real tool execution. Also records that lifecycle-heavy OMP/Pi extensions are not mechanical ports. |
| `docs/log/2026-08-29-advisor-profiles.md` | verified-live | Proves a real Hermes 0.20.4 host loaded a local adapter and completed a model-backed review. |
| `docs/log/2026-08-31-no-code-comments-uninstall.md` | verified-live | Confirms no active Hermes registration remains; useful local baseline, not a harness comparison. |
| `docs/log/2026-08-28-grok-search-tools.md` | verified-live | X search/fetch tooling for Pi and OMP. Despite the name, it is not evidence about the Grok Bot product. |
| `skills/pstack/make-bot-ui/SKILL.md` | documented | Existing Grok Bot webhook UI flow using Cursor infrastructure and optional Tailscale exposure. It conflicts with the new no-third-party-machine trust criterion. |
| `docs/DECISIONS.md` D6 | documented | Earlier preference favored Pi and OMP. The current user request explicitly reopens Hermes, so D6 cannot decide this comparison by itself. |

## Raw evidence: Grok Bot

### Ownership and deployment

- **[documented]** xAI describes Grok Bot as persistent agents running on a shared computer in the cloud that continues working while the user's machine is closed.
- **[documented]** Current Grok Bot documentation states that each Bot runs on a persistent cloud VM with browser, filesystem, and terminal access, and that this computer is separate from the Mac or Windows computer in front of the user.
- **[documented]** All Bots in one account share that cloud computer, including filesystem, browser cookies, signed-in sessions, and CLI credentials; official guidance says not to treat separate Bots as security boundaries.
- **[documented]** Grok Bot requires cloud data storage and Cursor authentication. No current official self-host, on-premises, or user-owned-computer mode was found.
- **[documented]** Local-computer execution exists only as a separately approved action from the cloud agent, with ask/always/never policy; the persistent Bot runtime remains cloud-hosted.

### Tailnet implication

- **[documented]** Current Grok Bot docs do not document a supported tailnet, VPN, or private-network attachment mechanism.
- **[inferred]** If a Grok Bot cloud VM were admitted to a tailnet, that device credential and permitted network reachability would belong to a vendor-controlled VM, even if the tailnet ACL narrowed its access.
- **[inferred]** Avoiding that trust requires either narrow OAuth connectors, narrow public endpoints, local-computer approval for individual operations, or not using Grok Bot for tailnet-only resources.

### Specification and orchestration

- **[documented]** Per-Bot configuration exposes name, title, description, avatar, notifications, and enabled private skills. Connectors and the computer are account-wide.
- **[documented]** Current docs do not expose per-Bot tool allowlists, per-Bot model pinning as a stable contract, custom system-prompt files, editable memory files, subagent types, or a public Bot orchestration API.
- **[documented]** Durable chats, asynchronous Bot-to-Bot DMs, group coordination, routines, and mobile/desktop continuity are first-class product features.
- **[documented]** Grok Bot has macOS, Windows, and iOS chat clients. The local `grok` coding TUI is a separate Grok Build product and does not control Grok Bots.

## Raw evidence: Hermes local-first architecture

### Process and trust topology

- **[documented]** Hermes Agent 0.21.0 source at commit `58472d803a32edd19773bb2ed7426490981a636e` defines one Python `AIAgent` core used by CLI, TUI gateway, gateway platforms, ACP, batch, and API server entry points.
- **[documented]** Hermes Desktop launches and manages its own local `hermes serve` backend by default. The backend speaks documented JSON-RPC over stdio or WebSocket.
- **[documented]** The API server binds to `127.0.0.1:8642` by default. Non-loopback dashboard exposure engages an authentication gate.
- **[documented]** CLI, current TUI, Desktop, Bot Mode, profiles, gateways, cron, plugins, local terminal execution, local models, and local/self-hosted search can all run on one user-owned macOS machine.
- **[documented]** Nous Portal, Tool Gateway, Hermes Cloud, remote gateways, SSH machines, peers, Tailscale, and VPNs are optional connection/provider choices rather than required control-plane dependencies.
- **[inferred]** A single-machine local Hermes deployment does not require granting any third-party computer tailnet membership. External model or tool providers may still receive the data sent to their APIs; that is a separate provider trust decision.

### Bot specification

- **[documented]** A Hermes Bot is a profile under `~/.hermes/profiles/<name>/` with its own `config.yaml`, `.env`, `SOUL.md`, memory, sessions, skills, cron jobs, state database, credentials, and gateway state.
- **[documented]** Bot creation and editing expose name/title/description, model and provider pin, custom `SOUL.md`, per-skill enablement, per-toolset enablement, per-MCP-server enablement, clone/fresh/empty creation, and target-machine selection.
- **[documented]** Profiles can be created, configured, exported, imported, renamed, and run through the CLI; Bot Mode is a UI over the same profile primitive rather than a parallel database.
- **[documented]** Skills use the `agentskills.io` `SKILL.md` standard, support external skill directories, and load progressively.
- **[documented]** Python runtime plugins can add tools, lifecycle hooks, slash and CLI commands, skills, approval transports, gateway platforms, model providers, memory providers, terminal environments, and context engines.
- **[documented]** Desktop plugins are a separate TypeScript/ESM SDK. Runtime plugins, Desktop plugins, and dashboard plugins are distinct extension surfaces.

### Memory

- **[documented]** Built-in profile memory injects a frozen `MEMORY.md` snapshot capped at 2,200 characters and a `USER.md` snapshot capped at 1,375 characters per session.
- **[documented]** Memory writes can require human approval. Session history is indexed in profile-local SQLite.
- **[documented]** Shared or larger cross-session memory requires an external memory-provider plugin such as Hindsight, Honcho, Mem0, or another supported provider.
- **[inferred]** Hermes built-in memory is adequate for compact standing preferences, not the complete durable domain record model currently implemented by Pi Bots.

### Persistent Bot communication

- **[documented]** Every Bot has a canonical persistent Bot Chat.
- **[documented]** `message_agent(target, message)` validates a live roster target, adds sender attribution server-side, returns immediately, and delivers the reply later as a background completion notification.
- **[documented]** Completion events are persisted in `state.db` before publication; typed delivery failures and bounded retry behavior survive process restarts after completion.
- **[documented]** Delivery is per invocation. A receiving Bot runs a turn when it receives the message; live interruption of a Bot already mid-turn is explicitly future work.
- **[documented]** Group rooms contain 2–6 Bots, preserve member sessions, cap one send at three serial rounds and ten messages, support mentions, and surface a needs-you badge.
- **[documented]** Kanban provides a separate durable SQLite work board and full-profile worker processes for explicit handoffs, reviews, blocking, and task ownership.

### Ephemeral subagents

- **[documented]** `delegate_task` launches fresh-context child agents with inherited tool access and separate terminal sessions; only the result returns to the parent.
- **[documented]** Parallel delegation defaults to three children and can be configured without a hard ceiling. Completion delivery is durable, but an executing child is not resumed after a process crash.
- **[documented]** A single global `delegation.model` and provider pin applies to ordinary subagents; `delegate_task` has no per-task model or per-role agent-definition parameter. Kanban supports per-task model overrides.
- **[documented]** Ordinary children cannot use memory writes, direct Bot messaging, cron creation, or further delegation; bounded orchestrator children are the nested-delegation exception.
- **[inferred]** Hermes is more expressive for persistent Bot profiles than for typed ephemeral worker roles. OMP remains stronger when each subagent type needs its own prompt, tools, model, skills, output schema, and spawn policy.

### Programming and UI protocols

- **[documented]** Hermes exposes ACP, TUI-gateway JSON-RPC, and an OpenAI-compatible HTTP API with streaming events, run approval, steering, stopping, and capability discovery.
- **[documented]** The programmatic-integration guide maps Pi RPC operations such as prompt, abort, fork, compact, and steer to Hermes gateway methods.
- **[documented]** A custom chat client can use Hermes protocols, but current Hermes Desktop already provides the Bot roster, DMs, groups, routines, presence, unread state, and needs-you UI.
- **[inferred]** Starting with the existing Desktop avoids building a custom TUI; a custom UI can remain an optional later replacement rather than an architectural prerequisite.

### Security and repository work

- **[documented]** Hermes supports local, Docker, SSH, Singularity, Modal, Daytona, and Vercel terminal backends.
- **[documented]** Profiles isolate configuration and state, not filesystem access. A local terminal backend runs with the user's filesystem permissions.
- **[documented]** Safety controls include smart/manual/off approvals, fail-closed unattended defaults, an always-on catastrophic-command blocklist, user deny globs, approval transports, memory/skill write gates, context-file scanning, and container isolation.
- **[documented]** Repository tools include file reads/writes/patches/search, terminal execution, git worktrees, checkpoints, rollback, and Desktop review actions. Checkpoints are opt-in rather than on by default.

## Raw evidence: installed local state

- **[verified-live]** This workstation currently has Hermes Agent `0.20.4`, upstream commit `4209d371`, installed from git at `~/.hermes/hermes-agent`.
- **[verified-live]** The installed checkout reports an update available and is 2,572 commits behind the current upstream observed during this audit.
- **[verified-live]** Existing repository receipts prove real Hermes 0.20.4 runtime plugin and advisor seams, but they do not live-verify the current integrated Bot Mode in 0.21.0.
- **[inferred]** A modern Hermes decision requires an isolated current-version trial; updating the only installed checkout in place would mix evaluation with migration.

## Raw comparison matrix

| Criterion | Grok Bot | Local Hermes | OMP plus custom Bot core | Pi plus Pi Bots |
| --- | --- | --- | --- | --- |
| User-owned execution host | **No** — vendor cloud VM [documented] | **Yes** — local default [documented] | **Yes** [verified-live] | **Yes** [verified-live] |
| Exact persistent-Bot prompt/model/skills/tools | Weak/coarse [documented] | Strong profile configuration; toolsets rather than arbitrary role schema [documented] | Strong primitives, but Bot schema unimplemented [documented] | Strong implemented `BOTS.yml` [verified-live] |
| Typed ephemeral subagent roles | Not exposed [documented] | Generic inherited children; global worker model [documented] | Strong `AgentDefinition` and Task controls [documented] | Strong generated `pi-subagents` roles [verified-live] |
| Durable Bot DMs/groups/routines | Strong proprietary product [documented] | Strong local product [documented] | Must be built [documented] | Missing by design [verified-live] |
| Human Bot UI | Vendor desktop/iOS [documented] | Built-in local Desktop Bot Mode [documented] | Must be built or adapted [documented] | Missing [verified-live] |
| Extension surface | No public Bot API [documented] | Python runtime + Desktop + dashboard plugin systems [documented] | TypeScript extensions and SDK [verified-live] | TypeScript extensions and SDK [verified-live] |
| Existing local proof | Not exercised | Old runtime seams only [verified-live] | Runtime/RPC and Task primitives [verified-live] | Full current Bot roster and delegation [verified-live] |
| Main maintenance burden | Vendor dependency [inferred] | Hermes updates plus Hermes-native policy ports [inferred] | Build and own control plane/TUI [inferred] | Build and own control plane/TUI; retain Pi-specific runner [inferred] |

## Conflicts and stale conclusions

- **[inferred]** `docs/log/2026-08-31-hermes-pi-hybrid.md` understates current Hermes: Bot Mode now ships in-tree and documents durable completion delivery, typed failures, groups across connections, Kanban, local Desktop backend, and multiple embedding protocols.
- **[inferred]** `docs/log/2026-08-31-omp-bot-feasibility.md` remains accurate about OMP, but its proposed custom daemon and TUI duplicate product surfaces that current local Hermes may already satisfy.
- **[verified-live]** The project-state Pi Bots row says 73 focused tests while the later Pi Bots log records 84; the row is stale.
- **[inferred]** The earlier choice to keep Pi as the sole repository executor is a proposal, not a validated requirement. The current user request explicitly asks whether Hermes should replace it.

## Unknowns requiring a local trial

- **[inferred]** Whether current Hermes coding tools, diff/review workflow, context handling, and model behavior are good enough to replace OMP for the user's daily repository work.
- **[inferred]** Which existing OMP/Pi policies have adequate Hermes-native equivalents and which need Python plugin ports.
- **[inferred]** Whether the current Desktop binary and backend version can be pinned and upgraded together without unacceptable churn.
- **[inferred]** Whether Hermes profile toolset granularity is sufficient for each Bot, or a policy plugin must enforce finer tool grants.
- **[inferred]** Whether built-in memory is acceptable or a local Hindsight/other provider is required.
- **[inferred]** Whether current Bot Mode behavior survives a real gateway restart on this workstation; source and docs are not live proof.

## Primary sources

- [Hermes Bot Mode](https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode)
- [Hermes profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles)
- [Hermes tools and terminal backends](https://hermes-agent.nousresearch.com/docs/user-guide/features/tools)
- [Hermes delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation)
- [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
- [Hermes plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)
- [Hermes security](https://hermes-agent.nousresearch.com/docs/user-guide/security)
- [Hermes source](https://github.com/NousResearch/hermes-agent/tree/58472d803a32edd19773bb2ed7426490981a636e)
- [Archived standalone Hermes Bot Mode README](https://github.com/NousResearch/Hermes-Bot-Mode)
- [Introducing Grok Bot](https://x.ai/news/introducing-grok-bot)
- [Grok Bot overview](https://docs.x.ai/grok-bot/overview)
- [Grok Bot computer and apps](https://docs.x.ai/grok-bot/computer-and-apps)
- [Grok Bot approvals, security, and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy)
- [Cursor Grok Bot getting started](https://cursor.com/help/grok-bot/getting-started)
