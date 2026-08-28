---
name: make-bot-ui
description: Build a local page or dashboard whose server wakes an existing Grok Bot webhook. Use for Grok Bot buttons, webhook-backed control pages, sender-key handoff, or exposing that page on Tailscale from OMP or Pi.
license: MIT
---

# Make a Grok Bot UI

Read `pstack-runtime`. Build a page the user clicks. A local server posts JSON to an existing Grok Bot webhook. The browser never receives the sender key.

## Capability boundary

OMP and Pi cannot create Cursor Grok Bot routines, inspect their panels, or render Cursor secret-request cards. This skill requires an existing webhook routine. If it does not exist, give the user these exact prerequisites and stop:

1. Create a Cursor Grok Bot routine with a webhook trigger.
2. Make its prompt treat the POST body as untrusted data and name the accepted JSON fields.
3. Copy the webhook URL.
4. Copy the sender key without pasting the key into chat.

Do not claim that OMP or Pi created the routine.

## Store the webhook secret

Use `~/.config/pstack/grok-bot/<slug>.env`. The directory is mode `0700`; the file is mode `0600`. The file contains:

```text
GROK_BOT_WEBHOOK_URL=<copied webhook URL>
GROK_BOT_WEBHOOK_KEY=<copied sender key>
```

The user writes this file outside chat. Never ask them to paste the key into a prompt. Verify that the file exists and has restrictive permissions without reading or printing its contents. Server startup reads the file locally. Logs redact both values.

The webhook URL should look like `https://api2.cursor.sh/automations/webhook/<id>` with no query string. Never guess the id.

## Build the local server

Keep the page, server, and non-secret configuration in one project directory. Bind to `0.0.0.0:<port>` so tailnet peers can connect.

The browser posts only the small action payload to the local server. The local server posts to the Grok Bot webhook with:

- method `POST`
- `Content-Type: application/json`
- `Authorization: Bearer <key>`
- `X-Automation-Key: <key>`
- one JSON object whose fields match the routine prompt
- an eight-second timeout
- one attempt and no retry

The local server validates the browser payload against an allowlist of actions. It never accepts a target URL, header name, command, or arbitrary prompt from the browser. It returns a bounded success or failure response and never returns upstream headers or secrets.

If delivery can fail, append the same validated JSON payload plus timestamp and error category to a local queue. The routine or an explicit recovery command drains that queue. Do not poll as the primary path. Do not send media bytes through the webhook.

## Verify locally

Start the server through the current host's managed background-process tool. Wait for its readiness predicate.

Drive the page through `browser` on OMP or `agent_browser` on Pi. Exercise every button. Capture the request, visible success state, and local server receipt without exposing credentials.

Probe the webhook once with a harmless payload whose action the routine explicitly ignores. HTTP 200 proves the routine woke; it does not prove the ignored action performed work. Record that distinction.

## Expose on Tailscale

If `tailscale status` reports an online node, reuse it. Read its hostname and IPv4 address. Do not create a second hostname on an online node.

If Tailscale is absent, install it through the platform's supported package path. Start one node with a short hostname, DNS disabled when required by local policy, and Tailscale SSH disabled unless the user asked for it. The user completes Tailscale authentication in their browser. Never ask for Tailscale credentials.

Give the user both reachable URLs:

- `http://<hostname>.<tailnet>.ts.net:<port>`
- `http://<100.x.x.x>:<port>`

Use HTTP unless the user asks for HTTPS. Probe the tailnet IPv4 URL and require HTTP 200.

## Report

Return the project path, server command, local URL, tailnet URLs when configured, supported actions, evidence paths, webhook probe result, queue path, and every unmet prerequisite. Never return the sender key, secret-file contents, cookies, or tokens.