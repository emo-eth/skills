---
name: session-history
description: Search cross-agent session history when the user nudges recall ("we talked about this"), plot continuity is clear, or prior work must be resumed. Do not search ordinary standalone chatter.
---

# Session history

## When to search

Search session history when:

- The user explicitly nudges recall, for example "we talked about this" or "what did we decide about X?"
- The plot clearly continues from an earlier session and missing context would cause rework.
- You are resuming prior work and need the recorded plot, decisions, or unfinished items.

Do **not** search for ordinary standalone chatter, greetings, or turns where history would add noise and cost.

## Uncertain continuity

If continuity is uncertain, ask one concise clarification question and continue with the safest reversible assumption. Do not block waiting for a perfect answer.

## How to recall

- Synthesize concisely from tool evidence with **1–3 citations**.
- Use `session_expand` when a citation needs more surrounding transcript.
- Surface freshness, degradation, and coverage warnings from tool results.
- Never treat search results as standing memory or an exhaustive wiki.

## Conflicts

When historical evidence conflicts, present the competing citations. Ask which governs **only** if the choice changes the current work.

## Resume workflow

1. Call `session_resume` to recover the focused resume packet for a session.
2. Call `session_query` on the selected session for missing context.
3. Distinguish recorded unfinished work from your proposed next action.

## Lifecycle

Use `session_manage` only when the user asks to exclude, disconnect, purge, or re-include sessions or sources. Destructive actions require explicit approval.
