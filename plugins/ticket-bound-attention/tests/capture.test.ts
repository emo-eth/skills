import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { capture, parseCliArgs, type CaptureDeps, type WorkspaceInfo } from "../src/capture.ts";
import { parseGoalTicket, upsertGoal } from "../src/goal.ts";
import { isTicketNumberName, parseCreatedIssue } from "../src/ticket.ts";

type LinearCall = { title: string; description: string; team: string };

async function withTree(prefix: string, fn: (tree: string) => Promise<void>): Promise<void> {
  const tree = await mkdtemp(join(tmpdir(), prefix));
  try {
    await fn(tree);
  } finally {
    await rm(tree, { recursive: true, force: true });
  }
}

function deps(options: {
  tree: string;
  workspace?: WorkspaceInfo;
  created?: { identifier: string; url: string };
}): { deps: CaptureDeps; creates: LinearCall[]; reports: string[] } {
  const creates: LinearCall[] = [];
  const reports: string[] = [];
  const files = new Map<string, string>();
  const workspace = options.workspace ?? {
    workspace_id: "w9Z",
    label: "billing-checkout",
    worktree: { checkout_path: options.tree },
  };
  return {
    creates,
    reports,
    deps: {
      async readFile(path) {
        if (files.has(path)) return files.get(path);
        try {
          return await readFile(path, "utf8");
        } catch (error) {
          if ((error as { code?: string }).code === "ENOENT") return undefined;
          throw error;
        }
      },
      async writeFile(path, contents) {
        files.set(path, contents);
        const { writeFile } = await import("node:fs/promises");
        await writeFile(path, contents, "utf8");
      },
      async createIssue(input) {
        creates.push(input);
        return options.created ?? {
          identifier: "EMO-501",
          url: "https://linear.app/emo-eth/issue/EMO-501/billing-checkout",
        };
      },
      async getWorkspace(id) {
        return workspace.workspace_id === id ? workspace : undefined;
      },
      async listWorkspaces() {
        return [workspace];
      },
      async reportTicket(workspaceId, identifier) {
        reports.push(`${workspaceId}:${identifier}`);
      },
    },
  };
}

test("create writes face, GOAL.md, ticket file, and metadata", async () => {
  await withTree("tba-create-", async (tree) => {
    const fake = deps({ tree });
    const result = await capture({ workspaceId: "w9Z", team: "EMO" }, fake.deps);
    assert.equal(result.action, "created");
    assert.equal(result.identifier, "EMO-501");
    assert.equal(fake.creates.length, 1);
    assert.equal(fake.creates[0]?.title, "Billing checkout");
    assert.equal(fake.creates[0]?.team, "EMO");
    assert.match(fake.creates[0]?.description ?? "", /## Intention/);
    assert.match(fake.creates[0]?.description ?? "", /## Vibe/);
    assert.match(fake.creates[0]?.description ?? "", /## Done-when/);
    assert.match(fake.creates[0]?.description ?? "", /## Map/);
    const goal = await readFile(join(tree, "GOAL.md"), "utf8");
    assert.match(goal, /Linear: \[EMO-501\]\(/);
    assert.match(goal, /- Herdr: billing-checkout \(w9Z\)/);
    assert.match(goal, new RegExp(`- Worktree: \`${tree}\``));
    const ticket = await readFile(join(tree, ".herdr-ticket"), "utf8");
    assert.match(ticket, /EMO-501/);
    assert.deepEqual(fake.reports, ["w9Z:EMO-501"]);
  });
});

test("bind uses GOAL.md Linear id and does not create", async () => {
  await withTree("tba-bind-", async (tree) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(tree, "GOAL.md"), [
      "# Goal: Billing checkout",
      "",
      "Linear: [EMO-370](https://linear.app/emo-eth/issue/EMO-370/billing)",
      "",
      "## Intention",
      "",
      "Pass checkout.",
      "",
    ].join("\n"), "utf8");
    const fake = deps({ tree });
    const first = await capture({ workspaceId: "w9Z" }, fake.deps);
    const second = await capture({ workspaceId: "w9Z" }, fake.deps);
    assert.equal(first.action, "bound");
    assert.equal(first.identifier, "EMO-370");
    assert.equal(second.action, "bound");
    assert.equal(fake.creates.length, 0);
    const goal = await readFile(join(tree, "GOAL.md"), "utf8");
    assert.match(goal, /Pass checkout/);
    assert.match(goal, /- Herdr: billing-checkout \(w9Z\)/);
    assert.equal(fake.reports.length, 2);
  });
});

test("bind uses .herdr-ticket when GOAL.md has no Linear id", async () => {
  await withTree("tba-file-", async (tree) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(tree, ".herdr-ticket"), "EMO-222\n", "utf8");
    const fake = deps({ tree });
    const result = await capture({ path: tree, name: "search relevance" }, fake.deps);
    assert.equal(result.action, "bound");
    assert.equal(result.identifier, "EMO-222");
    assert.equal(fake.creates.length, 0);
    const goal = await readFile(join(tree, "GOAL.md"), "utf8");
    assert.match(goal, /Linear: \[EMO-222\]\(/);
  });
});

test("refuses ticket-number chair names", async () => {
  await withTree("tba-refuse-", async (tree) => {
    const fake = deps({
      tree,
      workspace: {
        workspace_id: "w1",
        label: "EMO-12",
        worktree: { checkout_path: tree },
      },
    });
    await assert.rejects(
      () => capture({ workspaceId: "w1" }, fake.deps),
      /never ticket numbers \(got EMO-12\)/,
    );
    assert.equal(fake.creates.length, 0);
  });
});

test("refuses ticket-number work names", async () => {
  await withTree("tba-refuse-name-", async (tree) => {
    const fake = deps({ tree });
    await assert.rejects(
      () => capture({ path: tree, name: "NAT-44" }, fake.deps),
      /never ticket numbers \(got NAT-44\)/,
    );
    assert.equal(fake.creates.length, 0);
  });
});

test("parseCreatedIssue reads json and url text", () => {
  assert.equal(
    parseCreatedIssue('{"identifier":"EMO-9","url":"https://linear.app/emo-eth/issue/EMO-9/x"}').identifier,
    "EMO-9",
  );
  assert.equal(
    parseCreatedIssue("Created https://linear.app/emo-eth/issue/EMO-8/hello-world").identifier,
    "EMO-8",
  );
});

test("isTicketNumberName only matches bare ids", () => {
  assert.equal(isTicketNumberName("EMO-12"), true);
  assert.equal(isTicketNumberName("billing-checkout"), false);
  assert.equal(isTicketNumberName("EMO-12-extra"), false);
});

test("parseCliArgs accepts workspace, path, and name", () => {
  assert.deepEqual(parseCliArgs(["node", "main.ts", "--workspace", "w3Y"]), { workspaceId: "w3Y" });
  assert.deepEqual(parseCliArgs(["node", "main.ts", "--path", "/tmp/x", "--name", "idea"]), {
    path: "/tmp/x",
    name: "idea",
  });
  assert.equal(parseCliArgs(["node", "main.ts", "--help"]).help, true);
});

test("parseGoalTicket prefers the Linear bind line", () => {
  const parsed = parseGoalTicket([
    "# Goal: Work",
    "Linear: [EMO-426](https://linear.app/emo-eth/issue/EMO-426/ticket-bound-attention)",
    "## Done-when",
    "See EMO-449 later.",
  ].join("\n"));
  assert.equal(parsed?.identifier, "EMO-426");
});

test("upsertGoal collapses duplicate Linear bind lines", () => {
  const next = upsertGoal(
    [
      "# Goal: Work",
      "",
      "Linear: [EMO-1](https://linear.app/emo-eth/issue/EMO-1/a)",
      "",
      "Linear: [EMO-1](https://linear.app/emo-eth/issue/EMO-1/a)",
      "Plan: stay",
      "",
      "## Map",
      "",
      "- Keep me",
      "",
    ].join("\n"),
    { identifier: "EMO-1", url: "https://linear.app/emo-eth/issue/EMO-1/a" },
    { path: "/tmp/work", label: "work", workspaceId: "w1" },
  );
  assert.equal((next.match(/^Linear:/gm) ?? []).length, 1);
  assert.match(next, /Plan: stay/);
  assert.match(next, /- Keep me/);
  assert.match(next, /- Herdr: work \(w1\)/);
});

