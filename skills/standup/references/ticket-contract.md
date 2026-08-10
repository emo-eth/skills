# Ticket contract

Use this reference only when a standup needs ticket changes.

## Required fields

Every ticket in a delta has:

| Field | Rule |
| --- | --- |
| ID | Existing ID for updates; `new` until the destination assigns one. |
| Title | One human-sized result, starting with a verb. |
| Type | Build, research, design, ops, or the destination's equivalent. |
| Owner | One person. Use `owner unknown` instead of guessing. |
| Priority | Use the destination's scale. If it has none, use P0 (blocks a release or another ticket), P1 (core goal), or P2 (useful but not blocking). |
| Goal path | Monthly outcome -> weekly outcome -> ticket result. |
| Done-when | A visible condition that closes the ticket. |
| Evidence state | The strongest supported state, never a promise. |
| Destination status | `proposed, not created` for a new ticket; `proposed, not applied` for a change to an existing ticket; `created`, `updated`, `closed`, or `blocked` only after the destination confirms that state. |

## Delta format

```text
CREATE
- title:
- type:
- owner:
- priority:
- goal path:
- done-when:
- evidence state: planned
- destination status: proposed, not created

REPRIORITIZE <existing-id>
- old priority:
- new priority:
- reason:
- changed goal or evidence:
- blocked or unblocked tickets:
- destination status: proposed, not applied
```

For `UPDATE`, `REPRIORITIZE`, `CLOSE`, and `DEFER`, use `proposed, not
applied` until the user explicitly approves the external change. After the
destination confirms the change, use `updated` for an update, reprioritization,
or deferral; use `closed` for a close. Use `blocked` only when the destination
reports that status.

```text
UPDATE <existing-id>
- changed fields:
- before:
- after:
- destination status: proposed, not applied

CLOSE <existing-id>
- done-when evidence:
- destination status: proposed, not applied

DEFER <existing-id>
- revisit trigger:
- goal path that brings it back:
- destination status: proposed, not applied
```

## Quality checks

- One ticket has one owner and one done-when.
- A decision has one owner and names the work it blocks.
- A research ticket names its output: comparison, measurement, recommendation,
  or another concrete artifact.
- A merged ticket is not closed when done-when also requires deployment,
  measurement, or live verification.
- A date is a due point, not a priority label.
- A ticket that duplicates an existing ticket gets an update proposal instead of
  a second record.
