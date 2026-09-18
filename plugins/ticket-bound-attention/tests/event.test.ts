import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { capture, parseCliArgs, parseCommand, type CaptureDeps } from "../src/capture.ts";
import { captureInputFromEnv, isCaptureEvent } from "../src/event.ts";

test("isCaptureEvent only matches created and opened", () => {
  assert.equal(isCaptureEvent("worktree.created"), true);
  assert.equal(isCaptureEvent("worktree.opened"), true);
  assert.equal(isCaptureEvent("worktree.removed"), false);
  assert.equal(isCaptureEvent("startup"), false);
});

test("parseCommand uses event, action, or argv", () => {
  assert.equal(parseCommand(["node", "main.ts"], { HERDR_PLUGIN_EVENT: "worktree.created" }), "capture");
  assert.equal(parseCommand(["node", "main.ts"], { HERDR_PLUGIN_EVENT: "worktree.removed" }), "skip");
  assert.equal(parseCommand(["node", "main.ts"], { HERDR_PLUGIN_ACTION_ID: "capture" }), "capture");
  assert.equal(parseCommand(["node", "main.ts", "capture", "--workspace", "w3Y"]), "capture");
  assert.equal(parseCommand(["node", "main.ts", "--workspace", "w3Y"]), "capture");
  assert.equal(parseCommand(["node", "main.ts"], { HERDR_PLUGIN_ACTION_ID: "rank" }), "rank");
  assert.equal(parseCommand(["node", "main.ts", "rank"]), "rank");
});

test("parseCliArgs skips the capture subcommand", () => {
  assert.deepEqual(parseCliArgs(["node", "main.ts", "capture", "--workspace", "w3Y"]), { workspaceId: "w3Y" });
});

test("captureInputFromEnv reads worktree.created envelope", () => {
  const env = {
    HERDR_PLUGIN_EVENT: "worktree.created",
    HERDR_PLUGIN_EVENT_JSON: JSON.stringify({
      event: "worktree_created",
      data: {
        type: "worktree_created",
        workspace: {
          workspace_id: "w9",
          label: "billing-checkout",
          worktree: { checkout_path: "/tmp/billing" },
        },
        worktree: { path: "/tmp/billing", label: "billing-checkout", open_workspace_id: "w9" },
      },
    }),
  };
  assert.deepEqual(captureInputFromEnv(env), {
    workspaceId: "w9",
    path: "/tmp/billing",
    name: "billing-checkout",
    env,
  });
});

test("captureInputFromEnv falls back to context json", () => {
  const env = {
    HERDR_PLUGIN_EVENT: "worktree.opened",
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
      workspace_id: "w8",
      workspace_label: "search relevance",
      worktree: { checkout_path: "/tmp/search" },
    }),
  };
  assert.deepEqual(captureInputFromEnv(env), {
    workspaceId: "w8",
    path: "/tmp/search",
    name: "search relevance",
    env,
  });
});

test("event-derived capture binds and does not create a second ticket", async () => {
  const tree = await mkdtemp(join(tmpdir(), "tba-event-"));
  try {
    await writeFile(join(tree, "GOAL.md"), [
      "# Goal: Search relevance",
      "",
      "Linear: [EMO-222](https://linear.app/emo-eth/issue/EMO-222/search)",
      "",
    ].join("\n"), "utf8");
    const creates: string[] = [];
    const deps: CaptureDeps = {
      async readFile(path) {
        try {
          return await readFile(path, "utf8");
        } catch (error) {
          if ((error as { code?: string }).code === "ENOENT") return undefined;
          throw error;
        }
      },
      async writeFile(path, contents) {
        await writeFile(path, contents, "utf8");
      },
      async createIssue(input) {
        creates.push(input.title);
        return { identifier: "EMO-999", url: "https://linear.app/emo-eth/issue/EMO-999/x" };
      },
      async getWorkspace(id) {
        return id === "w8"
          ? { workspace_id: "w8", label: "search relevance", worktree: { checkout_path: tree } }
          : undefined;
      },
      async listWorkspaces() {
        return [];
      },
      async reportTicket() {},
    };
    const input = captureInputFromEnv({
      HERDR_PLUGIN_EVENT: "worktree.opened",
      HERDR_PLUGIN_EVENT_JSON: JSON.stringify({
        event: "worktree_opened",
        data: {
          type: "worktree_opened",
          workspace: { workspace_id: "w8", label: "search relevance", worktree: { checkout_path: tree } },
          worktree: { path: tree, already_open: true },
          already_open: true,
        },
      }),
    });
    const result = await capture(input!, deps);
    assert.equal(result.action, "bound");
    assert.equal(result.identifier, "EMO-222");
    assert.equal(creates.length, 0);
  } finally {
    await rm(tree, { recursive: true, force: true });
  }
});

test("resolveBin honors LINEAR_BIN override", async () => {
  const { resolveBin } = await import("../src/main.ts");
  assert.equal(resolveBin("linear", {}, "/opt/custom/linear"), "/opt/custom/linear");
});
