import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultFace,
  ensureGoalBind,
  humanTitle,
  isCommandCenter,
  linearWrite,
  parseCreatedIssue,
  parseEventSeat,
  parseTicketFromGoal,
  parseTicketFromTokens,
  seatingChanged,
  workspaceFromSnapshot,
  type Seat,
} from "../src/bind.ts";

const billing: Seat = {
  workspaceId: "w3F",
  label: "billing-checkout",
  checkoutPath: "/tmp/billing-checkout",
  repoName: "creatorscout",
  isLinkedWorktree: true,
};

test("skips standup and primary scratch", () => {
  assert.equal(isCommandCenter({
    workspaceId: "w2D",
    label: "standup",
    checkoutPath: "/Users/emo/.herdr/worktrees/scratch/standup",
    repoName: "scratch",
    isLinkedWorktree: true,
  }), true);
  assert.equal(isCommandCenter({
    workspaceId: "w3",
    label: "scratch",
    checkoutPath: "/Users/emo/dev/scratch",
    repoName: "scratch",
    isLinkedWorktree: false,
  }), true);
});

test("does not skip other scratch trees", () => {
  assert.equal(isCommandCenter({
    workspaceId: "w39",
    label: "japanese-flashcards",
    checkoutPath: "/Users/emo/.herdr/worktrees/scratch/japanese-flashcards",
    repoName: "scratch",
    isLinkedWorktree: true,
  }), false);
});

test("keeps chair labels, never ticket numbers", () => {
  assert.equal(humanTitle(billing), "billing-checkout");
  assert.equal(humanTitle({
    ...billing,
    label: "EMO-370",
    checkoutPath: "/tmp/billing-checkout",
  }), "billing-checkout");
  assert.equal(humanTitle({
    ...billing,
    label: "EMO-370-billing",
    checkoutPath: "/tmp/EMO-370",
    repoName: "creatorscout",
  }), "creatorscout");
});

test("reads Linear parent and inserts without clobbering", () => {
  const existing = parseTicketFromGoal(
    "# Goal: Ticket-bound attention\n\nLinear parent: [EMO-426](https://linear.app/emo-eth/issue/EMO-426/ticket-bound-attention).\n",
  );
  assert.deepEqual(existing, {
    identifier: "EMO-426",
    url: "https://linear.app/emo-eth/issue/EMO-426/ticket-bound-attention",
  });
  const body = "# Goal: billing\n\nDo the checkout work.\n";
  const bound = ensureGoalBind(
    body,
    { identifier: "EMO-370", url: "https://linear.app/emo-eth/issue/EMO-370/billing" },
    billing,
    defaultFace(billing),
  );
  assert.equal(bound.changed, true);
  assert.match(bound.text, /Linear parent: \[EMO-370\]/);
  assert.match(bound.text, /Do the checkout work/);
  assert.match(bound.text, /update Linear only when intention, vibe, done-when, or map actually change/);
});

test("does not rewrite Linear when map already matches Path or Worktree", () => {
  const face = defaultFace(billing);
  const withPath = linearWrite(
    "## Intention\n\nKeep billing honest.\n\n## Vibe\n\nQuiet checkout.\n\n## Done-when\n\nGate is green.\n\n## Map\n\n* Herdr: billing-checkout (w3F)\n* Path: `/tmp/billing-checkout`\n",
    billing,
    face,
  );
  assert.equal(withPath.write, false);
  assert.equal(withPath.reason, "unchanged");
  const withWorktree = linearWrite(
    "## Intention\n\nKeep billing honest.\n\n## Vibe\n\nQuiet checkout.\n\n## Done-when\n\nGate is green.\n\n## Map\n\n* Herdr: billing-checkout (w3F)\n* Worktree: `/tmp/billing-checkout`\n",
    billing,
    face,
  );
  assert.equal(withWorktree.write, false);
  assert.equal(seatingChanged(withWorktree.description, billing), false);
});

test("keeps a later desk-bind Map from rewriting intention", () => {
  const existing = `## Intention

Every worktree is born with a ticket.

## Vibe

Approved contract.

## Done-when

Hook exists.

## Map

* Vibe: \`docs/ticket-bound-attention/vibe.md\`
* Goal: \`GOAL.md\`

## Map (desk bind 2026-09-18)

* Herdr: billing-checkout (w3F)
* Worktree: \`/tmp/billing-checkout\`
`;
  const result = linearWrite(existing, billing, defaultFace(billing));
  assert.equal(result.write, false);
  assert.match(result.description, /Every worktree is born with a ticket/);
});

test("patches map only when the chair moved", () => {
  const existing = "## Intention\n\nKeep billing honest.\n\n## Vibe\n\nQuiet checkout.\n\n## Done-when\n\nGate is green.\n\n## Map\n\n* Herdr: billing-checkout (w99)\n* Path: `/old/path`\n";
  const result = linearWrite(existing, billing, defaultFace(billing));
  assert.equal(result.reason, "map");
  assert.match(result.description, /Keep billing honest/);
  assert.match(result.description, /\* Herdr: billing-checkout \(w3F\)/);
  assert.match(result.description, /\/tmp\/billing-checkout/);
  assert.equal(result.description.includes("/old/path"), false);
});

test("reads worktree.created envelope", () => {
  const seat = parseEventSeat(JSON.stringify({
    event: "worktree_created",
    data: {
      type: "worktree_created",
      workspace: {
        workspace_id: "w3Y",
        label: "ticket-bound-attention",
        worktree: {
          repo_name: "skills",
          checkout_path: "/Users/emo/.herdr/worktrees/skills/ticket-bound-attention",
          is_linked_worktree: true,
        },
      },
      worktree: {
        path: "/Users/emo/.herdr/worktrees/skills/ticket-bound-attention",
        label: "ticket-bound-attention",
        is_linked_worktree: true,
        open_workspace_id: "w3Y",
      },
    },
  }), { pluginEvent: "worktree.created" });
  assert.equal(seat?.workspaceId, "w3Y");
  assert.equal(seat?.label, "ticket-bound-attention");
  assert.equal(seat?.repoName, "skills");
  assert.equal(seat?.isLinkedWorktree, true);
});

test("reads snapshot workspace and tokens", () => {
  const snapshot = {
    result: {
      snapshot: {
        workspaces: [{
          workspace_id: "w3Y",
          label: "ticket-bound-attention",
          tokens: { ticket: "EMO-426", ticket_url: "https://linear.app/emo-eth/issue/EMO-426/ticket-bound-attention" },
          worktree: {
            repo_name: "skills",
            checkout_path: "/Users/emo/.herdr/worktrees/skills/ticket-bound-attention",
            is_linked_worktree: true,
          },
        }],
      },
    },
  };
  assert.equal(workspaceFromSnapshot(snapshot, "w3Y")?.label, "ticket-bound-attention");
  assert.equal(parseTicketFromTokens({
    ticket: "EMO-426",
    ticket_url: "https://linear.app/emo-eth/issue/EMO-426/ticket-bound-attention",
  })?.identifier, "EMO-426");
});

test("parses url, identifier, and json from linear create output", () => {
  assert.deepEqual(parseCreatedIssue("https://linear.app/emo-eth/issue/EMO-451/billing-checkout"), {
    identifier: "EMO-451",
    url: "https://linear.app/emo-eth/issue/EMO-451/billing-checkout",
  });
  assert.equal(parseCreatedIssue("Created issue EMO-451")?.identifier, "EMO-451");
  assert.deepEqual(parseCreatedIssue('{"identifier":"EMO-451","url":"https://linear.app/emo-eth/issue/EMO-451/x"}'), {
    identifier: "EMO-451",
    url: "https://linear.app/emo-eth/issue/EMO-451/x",
  });
});
