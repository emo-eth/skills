---
name: decision-wizard
description: Create a custom executable TypeScript CLI that presents a list one item at a time for binary decisions, saves progress, and applies a confirmed task-specific action. Use for Tinder-style keep/remove, approve/reject, or yes/no review flows over many items.
argument-hint: "[list to review] [positive and negative decisions]"
---

# Decision wizard

A decision wizard is a custom CLI for a finite binary review. It shows one item at a time, records the user's decision, and applies a task-specific result after the whole list is reviewed.

This is a sibling of the `wizard` skill, not an extension of it. Follow the `wizard` skill's self-contained TypeScript CLI pattern, but use this skill's template because the interaction and state model are different.

The generated CLI is custom for its task. Do not build a generic repository CLI or make the template discover arbitrary lists and actions at runtime. The source adapter and action are part of each generated CLI.

The template uses Node's built-in TypeScript stripping and has no package dependencies. It requires Node 22.6 or newer. Use erasable TypeScript syntax only: no enums, parameter properties, or other syntax that needs code generation.

## 1. Scope the review

Read the repository and identify:

- The exact list source: files, an API, a lock file, a database, or a fixed list.
- A stable identifier for every item. IDs must not change between runs unless the item itself changes identity.
- The card fields: title, short description, origin, status, and any details the user needs for a decision.
- The positive and negative labels. Examples: keep/remove, approve/reject, retain/archive.
- The action after review. State what each decision does, which command or file change performs it, and whether the action is reversible.
- The state-file location. Keep it outside the source list and make it easy to remove after successful application.

Before writing the CLI, show the user the review contract:

1. What one card contains.
2. Which key or button means each decision.
3. How pause and resume work.
4. What action runs after the final card.
5. What exact confirmation word protects that action.

Do not invent provenance, commands, or destructive behavior. Inspect the repository and existing tools first.

## 2. Map the review flow

Use this state model:

```text
new -> reviewing -> paused -> reviewing -> complete -> applied
                                  \-> action skipped
```

The CLI must:

- Show one card at a time.
- Support Left or `r` for the negative decision and Right or `a` for the positive decision.
- Support `q` or Ctrl-C to pause without losing decisions already made.
- Save after every decision, using an atomic replace.
- Resume by default from the saved state.
- Support `--reset` to discard saved decisions and start from the current list.
- Fingerprint the ordered item IDs and decision-relevant card data. Stop if the list changes while a saved review exists; do not apply decisions to a different snapshot.
- Show a complete summary before any action runs.
- Support `--dry-run`, which records and displays decisions but does not apply them.
- Require an exact confirmation word such as `APPLY` before an irreversible or external action.
- Leave the state file in place when the action is skipped or fails. Remove it only after the action succeeds.

Keep the action-specific code visible in the generated CLI. Never derive a shell command from untrusted item text. Use fixed command names and arguments assembled from validated IDs.

## 3. Author the TypeScript CLI

Copy [assets/template.ts](assets/template.ts) to the target path, for example `scripts/review-skills.ts`, and make it executable:

```sh
cp <this-skill>/assets/template.ts scripts/review-skills.ts
chmod +x scripts/review-skills.ts
```

Keep the review library above the `CUSTOMIZE` marker unchanged. Replace the example section below that marker.

Implement these custom sections:

1. `loadItems()`: read the real source and return `ReviewItem[]`. Put provenance and other decision context in `details`.
2. `REVIEW_TITLE`, `STATE_FILE`, and the positive and negative labels.
3. `applyOutcome(outcome)`: perform the task-specific action for `outcome.approved` and `outcome.rejected`. Define a separate `printActionPlan(outcome)` for the plan shown before confirmation.
4. Any validation needed to ensure IDs are safe for the action.

Example item mapping:

```ts
async function loadItems(): Promise<ReviewItem[]> {
  const records = await readSourceRecords();
  return records.map((record) => ({
    id: record.id,
    title: record.name,
    description: record.description,
    details: [
      ["Origin", record.origin],
      ["Status", record.status],
    ],
  }));
}
```

Example action shape:

```ts
function printActionPlan(outcome: ReviewOutcome): void {
  console.log("Items to remove:");
  for (const item of outcome.rejected) console.log(`- ${item.id}`);
}

async function applyOutcome(outcome: ReviewOutcome): Promise<void> {
  for (const item of outcome.rejected) {
    runCommand("fixed-tool", ["remove", item.id]);
  }
}
```

After `review.run()` returns a complete outcome, print the plan, call
`confirmExact("Type APPLY to continue: ", "APPLY")`, then call
`applyOutcome(outcome)`. Clear the state only after that action succeeds.

The template already provides card rendering, keyboard input, state persistence, snapshot checking, summary output, exact confirmation, and command execution. Use those helpers instead of reimplementing them in the custom section.

For an action that must run only once, clear the state after every operation succeeds. If an operation fails, let the error escape so the state remains available for retry.

## 4. Verify and hand off

- Run the generated file with Node 22.6 or newer. The shebang is the preferred direct command.
- Run `node --experimental-strip-types <script> --help` and confirm the usage text names the real review.
- Use a temporary source and state file for a scripted smoke test. Feed `a`, `r`, and `q` through standard input; do not use real credentials or destructive commands.
- Verify that `q` preserves earlier decisions and a second run resumes at the first undecided item.
- Verify that `--reset` starts from the first item again.
- Verify that a changed source fingerprint stops cleanup before the action.
- Verify that `--dry-run` never changes the source or calls the action.
- Verify that a failed action leaves the state file in place and a successful action removes it.
- Test the real action only when the user explicitly wants an end-to-end run.
- Tell the user the generated command, Node version requirement, state-file location, decision keys, and exact cleanup confirmation word.

The generated CLI is the deliverable. The template is an authoring aid, not a runtime dependency.
