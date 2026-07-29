# Project State

> The map, not the truth. This file indexes where current thinking and working code live and how well each claim is verified. Always read the source it points at before editing. Keep this file under ~1–2 pages so it can be fully re-read and re-verified every session.

## What this is

<!-- Three sentences. What the project is, who it is for, what stage it is at. -->

## Where we are

- **Phase:** <!-- e.g. execution spike; pre-MVP; hardening -->
- **Priorities now:** <!-- the 1–3 things in flight -->
- **Proven:** <!-- what is actually working and verified -->
- **Open:** <!-- what is undecided or unverified -->
- **Deferred:** <!-- v1+ work parked with a revisit trigger, or a pointer to deferred entries in docs/DECISIONS.md -->

## Standing constraints

<!-- Rules that must survive into any future work regardless of how old their source doc is.
     These are the invariants a fresh agent must not violate. -->

- <!-- e.g. Session artifacts never live at repo root — always docs/log/YYYY-MM-DD-<name>.md -->
- <!-- e.g. Only the IBKR adapter is a live-verified execution path; Alpaca is documented-only -->

## Topic index

Evidence tier per row: **verified-live** (ran it first-hand) · **documented** (authoritative source, untested here) · **inferred** (extrapolated / single-sourced). Downgrade a tier when code changes under a claim.

| Topic | Thinking / decision doc | Code that implements it | Verified by | Tier |
| --- | --- | --- | --- | --- |
| <!-- e.g. Order execution --> | `docs/execution.md` | `packages/execution/src/executor.ts` | ran live IBKR order 2026-06-30 | verified-live |
| <!-- e.g. Venue selection --> | `docs/log/2026-06-01-venue-canvass.md` (historical, behind `docs/execution.md`) | — | — | documented |
| <!-- Decision log, if the project has one --> | `docs/DECISIONS.md` (append-only; deferred entries carry revisit triggers) | — | — | documented |
| <!-- Distilled taste, if the project has one --> | `docs/taste.md` (principles citing decision IDs) | — | — | documented |

## Maintenance rule

If your session changes the project's understanding or its code, update this file in the **same commit** as the work:

- Move or rewrite rows whose thinking or code changed; add rows for genuinely new topics.
- Downgrade any `verified-live` row whose code changed this session until it is re-verified.
- Mark a newly-superseded doc as `historical, behind <successor>` here, and add a status header at the top of that doc pointing to its successor. Never delete it.
- Route new findings / handoff / status docs to `docs/log/YYYY-MM-DD-<name>.md`, never the repo root.
- Keep this file within the page cap — push detail down into source docs, not up into the map.
