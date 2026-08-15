---
name: grok-search
description: Search X (Twitter) and the web live via xAI Grok server-side search, using the local grok CLI's subscription OAuth. Use when the user asks to search Twitter/X, find tweets or posts, check what people are saying about something, fetch a tweet or thread by URL, or wants fresher web results than a normal search tool. Requires a one-time `grok login` (SuperGrok / X Premium+ subscription) or XAI_API_KEY.
---

# grok-search

Search X (Twitter) and the web through xAI's server-side `x_search` /
`web_search` tools on the Responses API. Grok runs the search on xAI's
side and returns a cited answer -- no browser, no scraping, small context
footprint.

The CLI is `scripts/grok-search.py` inside this skill directory (python3,
stdlib only). Resolve it relative to this SKILL.md and call it directly:

```sh
skill_dir=$(dirname <path-to-this-SKILL.md>)
"$skill_dir/scripts/grok-search.py" x "what are people saying about <topic>?"
```

## Commands

| Command | Use for |
| --- | --- |
| `grok-search.py x "<question>"` | X/Twitter posts, profiles, threads, reactions, trends |
| `grok-search.py fetch <post-url>` | One specific X post or thread, quoted verbatim with author + timestamp |
| `grok-search.py web "<question>"` | Live web search (uses the same subscription) |
| `grok-search.py ask "<question>"` | Free-form; Grok picks X search and/or web search itself |
| `grok-search.py auth` | Show which credential will be used and its expiry |

Every search command accepts `--json` (structured output: `answer`,
`citations`, `degraded`), `--model <id>` (default `grok-4-fast`; override
with a heavier model like `grok-4` for hard synthesis questions), and
`--timeout <seconds>` (default 180; typical calls return in 4-15s).

### `x` filters

- `--handle @user` (repeatable, max 10): only posts from these accounts.
- `--exclude-handle @user` (repeatable, max 10): exclude these accounts.
  Cannot be combined with `--handle`.
- `--from YYYY-MM-DD` / `--to YYYY-MM-DD`: post date window.
- `--images` / `--videos`: let Grok read media in posts.

### `web` filters

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

Credential preference order:

1. `XAI_API_KEY` env var (pay-as-you-go API billing), if set.
2. The standalone `grok` CLI's OAuth token in `~/.grok/auth.json`
   (SuperGrok / X Premium+ subscription -- no API billing).

The script never touches the single-use refresh token: when the access
token is expired or rejected, it runs a minimal `grok --no-auto-update -p`
call so the grok CLI refreshes and persists its own tokens, then re-reads
them. If there is no `~/.grok/auth.json` at all, tell the user to run
`grok login` once (or set `XAI_API_KEY`).

## Gotchas

- Latency is seconds, not milliseconds: 4-15s typical, more for complex
  synthesis. Leave the default timeout alone.
- Date filters are strict `YYYY-MM-DD`; malformed dates fail fast
  client-side (xAI would otherwise burn the call and answer from memory).
- Citation URLs often come back as `https://x.com/i/status/<id>` -- they
  resolve to the post regardless of handle.
- Each call spends the user's Grok subscription quota (or API credits when
  `XAI_API_KEY` is set). Batch questions into one query where sensible.
