# Personal Agent Harness Decision Brief

## Purpose and tiers

This brief is for choosing one primary personal-agent surface after reviewing Grok Bot, current local-first Hermes, OMP, Pi, and the implemented Pi Bots extension. Raw evidence and sources: `docs/research/2026-09-01-hermes-harness-and-bot-mode.md`.

- **[verified-live]** — exercised locally.
- **[documented]** — stated by official docs or source.
- **[inferred]** — recommendation or tradeoff derived from evidence.

## Raw deciding facts

| Fact | Tier |
| --- | --- |
| Grok Bot's persistent computer is a vendor-controlled cloud VM shared by every Bot on the account. | documented |
| Grok Bot requires cloud storage and exposes no official self-hosted Bot runtime or Bot orchestration API. | documented |
| Giving that VM tailnet reachability would place a third-party-controlled device inside the permitted network boundary. | inferred |
| Current Hermes can run CLI, TUI, Desktop, Bot Mode, profiles, gateways, cron, tools, plugins, memory, and repository work entirely on a user-owned Mac. | documented |
| Hermes Desktop manages a local backend by default; API service defaults to loopback. Nous Portal, Hermes Cloud, remote peers, Tailscale, and VPNs are optional. | documented |
| A Hermes Bot is a profile with its own model/provider, SOUL, skills, toolsets, MCP servers, credentials, memory, sessions, routines, and state. | documented |
| Hermes already supplies canonical Bot chats, attributed asynchronous DMs, bounded groups, unread/needs-you UI, routines, presence, durable completion delivery, typed failures, and Kanban handoffs. | documented |
| Hermes ordinary subagents inherit the parent's tools and use one global delegation model; they are less precisely typed than OMP Task agent definitions or Pi's generated Bot roles. | documented |
| OMP has the strongest programmable ephemeral-agent kernel, but no durable Bot product or canonical Bot UI. | verified-live |
| Pi Bots has a strong implemented `BOTS.yml` and live delegation, but intentionally has no inbox, chat transport, daemon, or Bot UI. | verified-live |
| The installed local Hermes is 0.20.4 and 2,572 commits behind the current source audited here; modern Bot Mode has not been live-tested on this workstation. | verified-live |

## What the facts collapse to

- **[inferred] Trust axis:** Grok Bot loses because its durable computer is outside the user's ownership boundary. Narrow OAuth connectors can reduce access, but they do not make the runtime user-owned.
- **[inferred] Product axis:** Hermes already implements most of the Bot control plane and human experience that an OMP-only or Pi-only approach would have to build.
- **[inferred] Exact-execution axis:** OMP remains stronger for declaring heterogeneous ephemeral subagent roles with precise prompts, tools, models, skills, schemas, and spawn permissions.
- **[inferred] Surface-count axis:** Hermes-only is one harness with several clients sharing the same profiles and sessions. Hermes plus OMP is one human UI but two agent runtimes and two extension/configuration surfaces.

## Option elimination

### Grok Bot

- **[inferred] Reject for tailnet-sensitive work.** The cloud VM ownership boundary conflicts directly with the stated requirement.
- **[documented]** Grok Bot remains the strongest zero-setup hosted teammate experience, but its Bot specification and programmatic control are weaker than Hermes, OMP, or Pi Bots.

### Pi as the primary harness

- **[inferred] Reject as the next primary path.** Pi Bots proves the roster/spec design, but finishing durable DMs, groups, routines, supervision, and UI still requires a substantial new control plane.
- **[verified-live]** Keep `plugins/pi-bots/` as a tested BotSpec reference and possible adapter, not as the reason to retain Pi as a daily surface.

### Hermes UI plus OMP workers

- **[inferred] Keep only as a fallback or migration bridge.** It preserves OMP's execution quality while using Hermes's finished Bot UI, but it is exactly the second-harness operational surface the user wants to avoid.
- **[documented]** The bridge is technically strong because both runtimes expose structured steering, cancellation, session, event, approval, and transcript protocols.

### OMP-only plus a custom Bot daemon and TUI

- **[inferred] Keep as the controlled fallback.** It offers the most exact execution behavior and preserves the existing OMP skill/plugin ecosystem.
- **[documented]** It also requires building durable messages, work, routines, supervision, attention state, and the Bot UI before reaching current Hermes Bot Mode behavior.

### Local Hermes as the sole harness

- **[inferred] Advance to a local trial.** It is the only current option that combines user-owned execution, a finished Bot product, repository tools, extensibility, subagents, routines, and one human-facing system without first building a control plane.
- **[inferred]** Do not adopt it irreversibly until current Hermes completes a real coding-and-coordination trial; the current local install is too old to validate the modern claims.

## Local-only Hermes trial

### Isolation

1. **[inferred]** Install or run current Hermes in an isolated checkout and separate `HERMES_HOME`; do not update the existing 0.20.4 installation in place.
2. **[documented]** Keep Desktop/backend and API service on loopback.
3. **[inferred]** Register no Hermes Cloud connection, remote gateway, peer, public bind, or tailnet device during the trial.
4. **[documented]** Use existing chosen model providers or a local/custom endpoint; Nous Portal is optional.

### Roster

1. **[documented]** Create `personal`, `engineering`, and `research` profiles with different SOUL files, model pins, skills, toolsets, MCP grants, workspaces, and approval policy.
2. **[inferred]** Use the implemented Pi `BOTS.yml` fields as the comparison checklist rather than immediately porting its runtime.
3. **[documented]** Point Hermes at the repository's Agent Skills through an external skill directory; identify instructions whose tool names are OMP/Pi-specific.

### Behavioral gates

1. **[inferred]** The personal agent must send an attributed DM to research, receive the asynchronous reply, and preserve the canonical thread across restart.
2. **[inferred]** Engineering must complete one real repository change with project context, an isolated worktree, approval handling, a delegated child, verification, and rollback evidence.
3. **[inferred]** A group must coordinate one bounded task and surface a needs-you event without looping.
4. **[inferred]** One routine must run headlessly, fail closed on a dangerous action, and place its result in the correct Bot chat.
5. **[inferred]** Per-profile skills/toolsets and filesystem workspace policy must be observable and enforceable rather than prompt-only.
6. **[inferred]** One load-bearing custom behavior must use a Hermes runtime plugin or an adequate native equivalent, proving that essential OMP/Pi policy does not require a second harness.
7. **[inferred]** No OMP or Pi process may be needed to finish the trial's end-to-end coding task.

## Decision rule after the trial

- **[inferred] Use Hermes only** if the coding workflow, per-profile capability control, plugin seam, subagent behavior, and restart durability pass. Stop building the custom Bot control plane and treat Desktop/TUI/CLI as clients of one Hermes system.
- **[inferred] Use OMP only** if Hermes fails on daily coding quality, exact worker specification, or load-bearing policy enforcement. Build the harness-neutral Bot daemon/TUI around OMP and reuse Pi Bots' manifest concepts.
- **[inferred] Use Hermes plus OMP temporarily** only when Hermes passes as the Bot product but fails one replaceable execution lane. Set an explicit removal target so the bridge does not become a permanent second configuration surface.
- **[inferred] Do not use Grok Bot for resources that require tailnet trust.** Reconsider only if xAI/Cursor ships a documented self-hosted or user-owned Bot computer.

## Bottom line

**[inferred] The next move should be a local-only current-Hermes trial, not a custom OMP Bot build and not Grok Bot tailnet access.** Hermes now appears capable of being the single personal-agent and Bot harness on hardware the user owns. It already implements the conversation, communication, routine, presence, work, and UI layers that are missing from OMP and Pi. The remaining uncertainty is whether its coding loop, policy extensibility, and less-typed ephemeral subagents are good enough to replace OMP in daily work; only the isolated behavioral trial can settle that.
