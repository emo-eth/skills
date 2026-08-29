---
name: grok-search
description: Search X (Twitter) and the web live, fetch tweets/threads, and run plain Grok inference via xAI's API on a SuperGrok / X Premium+ subscription (grok CLI OAuth, its own login, or XAI_API_KEY). Use when the user asks to search Twitter/X, find tweets or posts, check what people are saying about something, fetch a tweet or thread by URL, gather raw X sources for synthesis, or wants fresher web results than a normal search tool.
---

# grok-search

X (Twitter) search, web search, post fetching, and plain Grok inference
through xAI's Responses API. Search runs server-side on xAI (`x_search` /
`web_search` tools) and returns cited results -- no browser or scraping.

## Native tools

When the host exposes them, use the native tools instead of invoking the CLI:

| Tool | Use for |
| --- | --- |
| `grok_search` | X, web, or combined search; defaults to raw `sources` for the calling model to synthesize |
| `grok_fetch` | One X post or thread by URL |
| `grok_prompt` | Plain Grok inference without search |

The tools return structured JSON with `model`, `answer`, `citations`, and
`degraded`. They execute the bundled CLI without a shell, share its credentials
and quota, and forward host cancellation to the request process. `auth`,
`login`, `logout`, and `models` remain CLI-only administration.

The same directory is an installable Pi and OMP package:

```sh
pi install ~/.agents/skills/grok-search
omp plugin install ~/.agents/skills/grok-search
```

If the native tools are unavailable, use `scripts/grok-search.py` inside this
skill directory (python3, stdlib only, executable). Invocation, first match
wins:

1. `~/.agents/skills/grok-search/scripts/grok-search.py` (the standard
   `npx skills` universal install location).
2. `scripts/grok-search.py` resolved relative to this SKILL.md, wherever
   your harness installed it.

Copy-paste examples:

```sh
grok-search.py x "what are people saying about <topic>? summarize with links" --from 2026-08-01
grok-search.py x "reactions to <event>" --brief --from 2026-08-10   # raw sources, you synthesize
grok-search.py x "latest post from @someuser, text and URL" --handle @someuser
grok-search.py fetch https://x.com/someuser/status/123456789
grok-search.py web "current <library> release version" --allow-domain github.com
grok-search.py ask "did <event> actually happen? check X and the web"
grok-search.py prompt "one-off question for Grok" --system "You are terse."
cat notes.md | grok-search.py prompt -                              # '-' reads stdin
```

## Commands

| Command | Use for |
| --- | --- |
| `x "<question>"` | X/Twitter posts, profiles, threads, reactions, trends |
| `fetch <post-url>` | One specific X post or thread, quoted verbatim with author + timestamp |
| `web "<question>"` | Live web search (same subscription) |
| `ask "<question>"` | Free-form; Grok picks X search and/or web search itself |
| `prompt "<text>"` | Plain Grok inference, no search tools (`--system` supported) |
| `models` | List models this credential can use, with context sizes |
| `auth` | Show every available credential and which one is active |
| `login` / `logout` | This script's own OAuth sign-in/out (only needed without the grok CLI) |

Search commands accept `--json` (structured: `answer`, `citations`,
`degraded`), `--model <id>` (default `grok-4-fast`; see `models` for the
catalog -- note xAI may serve an alias, e.g. `grok-4-fast` resolves to a
current fast model), `--timeout <seconds>` (default 180; typical calls
return in 4-25s), and `--max-citations N` (markdown cap, default 10,
`0` = unlimited; `--json` always carries the full deduplicated list).
Query arguments accept `-` to read from stdin.

## `--brief`: cheap sources, smart synthesis

`x`, `web`, and `ask` take `--brief`: Grok returns ONLY a raw source list
(one line per post: `@handle (date): "verbatim text" -- URL`) with no
synthesis. Use this when the calling model should do the reasoning and
Grok should only gather -- it burns fewer subscription tokens per call and
gives you verbatim post text instead of Grok's summary. Default mode is
better when you want a one-shot answer.

Subscription quota is limited (per-account, not per-key). To conserve it:
prefer `--brief` + the default fast model for gathering, batch related
questions into one query, and reach for a heavier `--model` only when the
one-shot synthesis genuinely matters.

## `x` filters

- `--handle @user` (repeatable, max 10): only posts from these accounts.
- `--exclude-handle @user` (repeatable, max 10): exclude these accounts.
  Cannot be combined with `--handle`.
- `--from YYYY-MM-DD` / `--to YYYY-MM-DD`: post date window.
- `--images` / `--videos`: let Grok read media in posts.

## `web` filters

- `--allow-domain example.com` / `--block-domain example.com` (repeatable,
  mutually exclusive).

## Writing good queries

Queries are natural-language questions, not keyword strings. Ask for what
you actually want in the answer ("One post, text and URL", "summarize the
main criticisms with links") -- Grok composes the reply, so instruct it
like a researcher.

## Trust and degraded results

Cited URLs are the ground truth; the prose is Grok's synthesis. When
narrowing filters are active and **no citations** come back, the CLI warns
(or sets `"degraded": true` in `--json`): the answer likely came from model
memory, not live posts. Broaden the date window or drop handle filters and
retry before trusting it.

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
