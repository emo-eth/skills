---
name: grok-search
description: 'Search X (Twitter) live and fetch exact X posts, threads, and Articles through native Grok tools backed by xAI. Use when the user asks to find posts, inspect an X URL, search a handle, gather representative reactions, or recover authored X content. This skill is X-only: it does not provide web search or general Grok inference.'
---

# grok-search

Live X awareness through xAI's server-side `x_search`. No browser, scraping, general web search, or plain Grok inference.

## Agent contract

Use the native tools. Do not expose or invoke the bundled Python implementation during agent work.

| Tool | Use for |
| --- | --- |
| `grok_search` | Bounded live-X discovery, representative reactions, and synthesis |
| `grok_fetch` | Faithful retrieval of one X post, thread position, or X Article |
| `grok_auth` | Inspect authorization or run the human-approved device flow |

Each search or fetch returns structured JSON with recoverable X citations, a degradation signal, and warnings. Treat cited URLs as ground truth. Treat Grok prose as synthesis.

## Search

Use `grok_search` for discovery.

- `response: "sources"` is the default. It asks for source-like X evidence so the calling model can synthesize.
- `response: "answer"` asks Grok to synthesize the evidence.
- `depth: "quick"` is the default bounded search.
- `depth: "deep"` requests broader representative agreement, disagreement, corrections, and uncertainty. It is not exhaustive and must not be described as popularity measurement.
- `handles` and `excludeHandles` accept up to ten handles and are mutually exclusive.
- `from` and `to` are strict `YYYY-MM-DD` post dates.
- `images` and `videos` enable media understanding.

Prefer one well-scoped query over repeated tiny calls. If `degraded` is true, state the limitation. Do not turn sparse or conflicting evidence into consensus, sentiment percentages, or “X thinks.”

## Fetch

Use `grok_fetch` for one HTTPS `x.com` or `twitter.com` content URL.

- `content: "anchor"` is the default. Return the exact requested post or X Article, its metadata, quoted or parent context needed to understand it, links, and media.
- `content: "authored"` requests the full recoverable authored unit, such as the author's surrounding thread.
- `discussion: true` adds representative replies and quote reactions separately from authored content. It is never exhaustive or a popularity ranking.

For an X Article, the anchor text contains the title and full recoverable body. If the requested object cannot be verified from live X evidence, report it unavailable. Never reconstruct deleted or inaccessible content from memory, quote fragments, or speculation.

## Authentication recovery

Authorization can happen after installation and is re-resolved for every action.

When a content tool returns `auth_required`:

1. Offer one action: connect Grok with xAI's device authorization.
2. Start only after the user approves by calling `grok_auth` with `action: "start_device"`.
3. Present the returned verification URL and user code.
4. After the user confirms approval, call `grok_auth` with `action: "complete_device"` and the returned session.
5. Retry the original content request.

Do not tell the user to run a script or locate a credential file. Do not start authorization without approval.

Credential preference is deterministic:

1. Supported host-provided xAI subscription OAuth.
2. Grok CLI subscription OAuth.
3. Plugin-owned subscription OAuth.
4. `XAI_API_KEY` only when no subscription credential exists.

A subscription authorization failure or exhausted subscription quota never falls through to billed API access. Explicit API-key use is available only through the standalone administrative CLI's `--credential-source api-key` option.

`grok_auth` exposes only non-secret state. Device codes, access tokens, refresh tokens, and API keys never appear in tool output or command arguments. Plugin-owned refresh rotation is serialized and persisted atomically.

## Failures

Keep operational failures distinct:

- `auth_required`: offer device authorization.
- `auth_expired`: retry through the host's refreshed subscription when available; otherwise offer authorization.
- `host_oauth_unavailable`: host subscription OAuth exists but the host could not delegate it because a higher-priority host credential is active. Do not use billed API access or start another login; ask the user to remove the host credential override.
- `subscription_quota_exhausted`: report that subscription access is unavailable. Do not switch to billed API access.
- `api_rate_limited`: explicit or sole API-key access is unavailable.
- `outcome_unknown`: the request may have reached xAI; do not retry automatically.
- `degraded: true`: live X evidence was absent or incomplete; state exactly what is missing.

Do not invent pagination, hidden completeness, deleted-post forensics, or source provenance.

## Installation

The directory is an installable Pi and OMP package:

```sh
pi install ~/.agents/skills/grok-search
omp plugin install ~/.agents/skills/grok-search
```

A newly installed or updated native extension may require one host restart. Authorization and token rotation do not.

## Code mode

OMP eval exposes the same tools as `tool.grok_search(...)`, `tool.grok_fetch(...)`, and `tool.grok_auth(...)`. Code mode does not add web search or plain Grok inference.
