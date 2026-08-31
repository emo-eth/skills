---
name: grok-search
description: Search X (Twitter) live and fetch X posts or threads through native Grok tools backed by xAI. Use when the user asks to find tweets/posts, inspect an X URL, search a handle, gather reactions on X, or collect raw X sources. This skill is X-only: it does not provide web search or general Grok inference.
---

# grok-search

Search and fetch content from X/Twitter through xAI's server-side `x_search`.
No browser or scraping.

## Agent contract

Use only these native tools:

| Tool | Use for |
| --- | --- |
| `grok_search` | Search X posts, profiles, threads, reactions, and trends |
| `grok_fetch` | Fetch one X post or thread by URL |

This skill is only for X/Twitter. Use the normal web-search tool for the web
and the active model for ordinary inference. The bundled Python script is the
tools' implementation and an authentication utility; do not invoke it directly
for agent work.

If the native tools are unavailable, report that the Grok extension needs
installation or a full host restart. Do not fall back to the CLI.

The tools return structured JSON with `model`, `answer`, `citations`, and
`degraded`. Each call consumes Grok subscription quota or xAI API credits.

## `grok_search`

`query` is a natural-language question about X content. The tool always searches
X; there is no source selector.

- `response: "sources"` (default): raw posts for the calling model to synthesize.
- `response: "answer"`: Grok synthesizes from X search.
- `handles` / `excludeHandles`: include or exclude up to ten X handles; mutually
  exclusive.
- `from` / `to`: strict `YYYY-MM-DD` post window.
- `images` / `videos`: let Grok inspect post media.
- `model`: optional xAI model override.

Prefer `sources`, batch related questions, and use the default fast model.

## `grok_fetch`

Pass one X or Twitter post URL. The result includes verbatim post text, author,
timestamp, quoted posts, media notes, and the full thread when available.

## Code mode

OMP eval exposes the same tools as `tool.grok_search(...)` and
`tool.grok_fetch(...)`. Code mode does not add web search or plain Grok
inference.

## Trust

Cited URLs are ground truth; Grok's prose is synthesis. When narrowed search
returns `degraded: true`, broaden the date window or remove handle filters
before trusting the answer.

## Installation

The same directory is an installable Pi and OMP package:

```sh
pi install ~/.agents/skills/grok-search
omp plugin install ~/.agents/skills/grok-search
```

A newly installed or updated OMP extension requires a full process restart.

## Auth model

Credential preference order (see `auth` for live state):

1. `XAI_API_KEY` env var (pay-as-you-go API billing).
2. The standalone `grok` CLI's OAuth token in `~/.grok/auth.json`
   (SuperGrok / X Premium+ subscription). The grok CLI owns that token's
   lifecycle: its refresh token is single-use, so this script never spends
   it -- on expiry or 401/403-unauthenticated it runs a minimal
   `grok --no-auto-update -p` call so the CLI rotates its own tokens, then
   re-reads them.
3. This script's own OAuth login: `grok-search.py login` (loopback PKCE
   against auth.x.ai, same public client as the grok CLI). Tokens live in
   `~/.config/grok-search/auth.json` (mode 600) with self-managed refresh
   and rotation. Use this on machines without the grok CLI installed.

If no credential exists anywhere, tell the user to run `grok login` (if
they have the grok CLI) or `grok-search.py login`, or set `XAI_API_KEY`.

## Gotchas

- Latency is seconds, not milliseconds: 4-25s typical, more for complex
  synthesis. Leave the default timeout alone.
- Date filters are strict `YYYY-MM-DD`; malformed dates fail fast
  client-side (xAI would otherwise burn the call and answer from memory).
- Citation URLs often come back as `https://x.com/i/status/<id>` -- they
  resolve to the post regardless of handle. The CLI deduplicates the
  handle and `/i/` forms of the same post.
- Each call spends the user's Grok subscription quota (or API credits when
  `XAI_API_KEY` is set). Batch questions into one query where sensible.
