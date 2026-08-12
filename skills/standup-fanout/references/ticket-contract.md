# Ticket contract

Use this reference when a standup needs a ticket change.

## Required fields

Every ticket proposal has:

| Field | Rule |
| --- | --- |
| ID | Existing ID for an update; `new` until the destination assigns one. |
| Title | One human-sized result, starting with a verb. |
| Type | Build, research, design, ops, or the destination's equivalent. |
| Owner | One person. Use `owner unknown` instead of guessing. |
| Priority | Use the destination's scale. If it has none, use P0 (blocks a release or another ticket), P1 (core goal), or P2 (useful but not blocking). |
| Why now | The monthly outcome and current working-week priority that make the ticket useful now. |
| Output | The concrete artifact, behavior, measurement, or recommendation the ticket produces. |
| Proof needed | The visible check that supports closing the ticket. |
| Current status | The strongest supported status: planned, in progress, merged, deployed, measured, live, or awaiting owner sign-off. |
| Destination status | `proposed, not created` for a new ticket; `proposed, not applied` for an existing-ticket change; `created`, `updated`, `closed`, or `blocked` only after the destination confirms that state. |

## Delta format

```text
CREATE
- title:
- type:
- owner:
- priority:
- why now:
- output:
- proof needed:
- current status: planned
- destination status: proposed, not created

REPRIORITIZE <existing-id>
- old priority:
- new priority:
- reason:
- changed priority or evidence:
- blocked or unblocked tickets:
- destination status: proposed, not applied
```

For `UPDATE`, `REPRIORITIZE`, `CLOSE`, and `DEFER`, use `proposed, not
applied` until the owner explicitly approves the external change. A clear owner
instruction in chat or submitted review feedback is explicit approval for the
named change. After the destination confirms the change, use `updated` for an
update or reprioritization, `closed` for a close, and `blocked` only when the
destination reports that status.

```text
UPDATE <existing-id>
- changed fields:
- before:
- after:
- destination status: proposed, not applied

CLOSE <existing-id>
- proof:
- owner sign-off:
- destination status: proposed, not applied

DEFER <existing-id>
- revisit trigger:
- why-now link that brings it back:
- destination status: proposed, not applied
```

## Quality checks

- One ticket has one owner, one output, and one proof.
- A sub-ticket inherits its parent's priority. Give a sub-ticket a different
  priority only when the owner re-prioritizes the parent first.
- A decision has one owner, one due point, and names the work it blocks.
- A research ticket names its output: a comparison, measurement,
  recommendation, or another concrete artifact.
- A merged ticket is not closed when proof also requires deployment,
  measurement, live behavior, or owner sign-off.
- A date is a planning signal, not a priority label.
- A ticket that duplicates an existing ticket gets an update proposal instead
  of a second record.
- Do not cite a ticket by bare number. Use its title and direct destination URL.
