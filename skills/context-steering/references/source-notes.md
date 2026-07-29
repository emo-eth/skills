# Source Notes and Adoption Boundary

## Primary source

The pattern was prompted by Philipp Berner's X post:

- Root: https://x.com/philippberner/status/2082229713783894519
  - “Just discovered that codex can fork subagents that will reflect on the root context and identify if it needs a steering prompt. Have been doing this manually and now adding it to my skill.”
- Same-author follow-up: https://x.com/philippberner/status/2082229881606410602
  - He describes asking for prompts that run in a fresh context so he does not run into compaction.
- Earlier same-day framing: https://x.com/philippberner/status/2081955137367790000
  - “Does the main context benefit from a steering prompt”

The posts are practitioner reports. They establish the useful design prompt, not a portable API contract or proof that every Codex host exposes the same fork/steer hooks.

## Local adoption decision

This repo adopts the mechanism as an agent-agnostic, opt-in control skill:

1. Build a bounded root-context packet.
2. Fork a read-only reflector in an isolated or fresh context.
3. Require a small structured verdict.
4. Apply at most one evidence-backed steering prompt, or block when context is insufficient.
5. Keep deterministic verification and human/effect gates authoritative.

The skill deliberately does not copy a Codex-specific command, assume automatic mid-turn injection, or treat reflection as completion proof. A nearby public `Codex-Reflect-Skill` focuses on mining historical Codex sessions; it is a different mechanism from live root-context steering and is not a dependency here.
