import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import focusOrderOmpExtension from "../src/agents/omp.ts";
import focusOrderPiExtension from "../src/agents/pi.ts";
import { listAgents } from "../src/herdr/client.ts";
import { runSnapshot } from "../src/herdr/enforce.ts";
import {
  addOrMoveToEnd,
  addOrMoveWorktreeToEnd,
  snoozeAgent,
  worktreeRankOf,
} from "../src/shared/identity.ts";
import {
  defaultState,
  loadState,
  saveState,
} from "../src/shared/store.ts";
import type { AgentSnapshot } from "../src/shared/types.ts";

type Frame = Record<string, unknown>;
type Responder = (
  msg: Frame,
  reply: (result: unknown) => void,
  fail: (code: string, message: string) => void,
) => void;

type ServerHandle = {
  path: string;
  received: Frame[];
  waitFor: (pred: (msg: Frame) => boolean) => Promise<Frame>;
  respond: Responder;
  close: () => Promise<void>;
};

function startFakeHerdr(): Promise<ServerHandle> {
  const { promise: ready, resolve: resolveReady } = Promise.withResolvers<ServerHandle>();
  const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<void>();
  const sockPath = path.join(
    os.tmpdir(),
    `focus-audit-${process.pid}-${Math.random().toString(36).slice(2)}.sock`,
  );
  const received: Frame[] = [];
  const waiters: Array<{ pred: (m: Frame) => boolean; resolve: (m: Frame) => void }> = [];
  const sockets = new Set<net.Socket>();
  let respond: Responder = () => {};

  const push = (msg: Frame): void => {
    received.push(msg);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].pred(msg)) {
        const waiter = waiters.splice(i, 1)[0];
        waiter.resolve(msg);
      }
    }
  };

  const waitFor = (pred: (m: Frame) => boolean): Promise<Frame> => {
    const existing = received.find(pred);
    if (existing) return Promise.resolve(existing);
    const { promise, resolve } = Promise.withResolvers<Frame>();
    waiters.push({ pred, resolve });
    return promise;
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        let parsed: Frame;
        try {
          parsed = JSON.parse(line) as Frame;
        } catch {
          continue;
        }
        push(parsed);
        respond(
          parsed,
          (result) => socket.write(`${JSON.stringify({ id: parsed.id, result })}\n`),
          (code, message) =>
            socket.write(`${JSON.stringify({ id: parsed.id, error: { code, message } })}\n`),
        );
      }
    });
  });

  server.listen(sockPath, () => {
    resolveReady({
      path: sockPath,
      received,
      waitFor,
      set respond(responder: Responder) {
        respond = responder;
      },
      get respond(): Responder {
        return respond;
      },
      close: () => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolveClosed(undefined));
        return closed;
      },
    });
  });

  return ready;
}

async function withFixture(
  run: (srv: ServerHandle, stateDir: string) => Promise<void>,
): Promise<void> {
  const previousSocket = process.env.HERDR_SOCKET_PATH;
  const previousStateDir = process.env.HERDR_PLUGIN_STATE_DIR;
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "focus-audit-"));
  const srv = await startFakeHerdr();
  process.env.HERDR_SOCKET_PATH = srv.path;
  process.env.HERDR_PLUGIN_STATE_DIR = stateDir;
  try {
    await run(srv, stateDir);
  } finally {
    if (previousSocket === undefined) delete process.env.HERDR_SOCKET_PATH;
    else process.env.HERDR_SOCKET_PATH = previousSocket;
    if (previousStateDir === undefined) delete process.env.HERDR_PLUGIN_STATE_DIR;
    else process.env.HERDR_PLUGIN_STATE_DIR = previousStateDir;
    await srv.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

type NativeHost = {
  registerCommand: (
    name: string,
    options: { description?: string; handler: (args: string, context: unknown) => unknown },
  ) => void;
  on: (event: string, handler: (event: unknown, context: unknown) => unknown) => void;
  appendEntry: (type: string, data?: unknown) => void;
  commands: Record<string, { handler: (args: string, context: unknown) => unknown }>;
  entries: Array<{ type: string; data?: unknown }>;
};

type NativeContextProbe = {
  context: unknown;
  statusCalls: Array<{ key: string; value: string | undefined }>;
  notifications: Array<{ message: string; level?: string }>;
};

function makeNativeHost(): NativeHost {
  const commands: NativeHost["commands"] = {};
  const entries: NativeHost["entries"] = [];
  return {
    registerCommand: (name, options) => {
      commands[name] = options;
    },
    on: () => {},
    appendEntry: (type, data) => {
      entries.push({ type, data });
    },
    commands,
    entries,
  };
}

function makeNativeContext(): NativeContextProbe {
  const statusCalls: NativeContextProbe["statusCalls"] = [];
  const notifications: NativeContextProbe["notifications"] = [];
  const context = {
    ui: {
      setStatus: (key: string, value: string | undefined) => {
        statusCalls.push({ key, value });
      },
      notify: (message: string, level?: string) => {
        notifications.push({ message, level });
      },
    },
    sessionManager: {
      getSessionId: () => "session-actual",
    },
  };
  return { context, statusCalls, notifications };
}

const testPane: AgentSnapshot = {
  pane_id: "p1",
  workspace_id: "w",
  tab_id: "t",
  agent_status: "blocked",
  focused: false,
};

test("native command context reports visible blocked/help and persists the real session id", { timeout: 15000 }, () => {
  for (const [source, extension] of [
    ["Pi", focusOrderPiExtension],
    ["OMP", focusOrderOmpExtension],
  ] as const) {
    const host = makeNativeHost();
    extension(host);
    const command = host.commands["focus-order"];
    assert.ok(command, `${source} adapter should register the focus-order command`);

    const blocked = makeNativeContext();
    command.handler("blocked", blocked.context);
    assert.deepEqual(
      blocked.statusCalls.at(-1),
      { key: "focus-order", value: `${source.toLowerCase()}:blocked` },
      `${source}: blocked status should reach ctx.ui.setStatus`,
    );
    assert.ok(
      blocked.notifications.some(
        (n) => n.message.includes("blocked") && n.level === "warning",
      ),
      `${source}: blocked report should surface a visible warning notification`,
    );
    const entry = host.entries.at(-1);
    assert.equal(entry?.type, "focus-order-status");
    assert.deepEqual(entry?.data, {
      source: source.toLowerCase(),
      status: "blocked",
      session_id: "session-actual",
    });

    const help = makeNativeContext();
    command.handler("help", help.context);
    assert.ok(
      help.notifications.some(
        (n) => n.message.includes("focus-order status <working|idle|blocked|done>"),
      ),
      `${source}: help should be surfaced visibly, not returned to a consumer that ignores strings`,
    );
  }
});

test("runSnapshot keeps a concurrently persisted enabled=false while clearing snoozes", { timeout: 15000 }, async () => {
  await withFixture(async (srv) => {
    saveState(defaultState());
    saveState(snoozeAgent(loadState(), testPane));

    let agentReply: (() => void) | undefined;
    let workspaceReply: (() => void) | undefined;
    srv.respond = (msg, reply) => {
      if (agentReply && workspaceReply) return;
      if (msg.method === "agent.list") {
        agentReply = () =>
          reply({
            agents: [{ ...testPane, agent_status: "working" }],
          });
      } else if (msg.method === "workspace.list") {
        workspaceReply = () => reply({ workspaces: [] });
      }
      if (agentReply && workspaceReply) {
        saveState({ ...loadState(), enabled: false });
        agentReply();
        workspaceReply();
      }
    };

    await runSnapshot();

    const final = loadState();
    assert.equal(
      final.enabled,
      false,
      "stale in-memory snapshot must not overwrite the concurrently persisted enabled=false",
    );
    assert.equal(
      final.snoozed_agents.length,
      0,
      "snooze for the now-working agent should be cleared",
    );
  });
});

test("listAgents rejects when workspace.list fails instead of dropping worktree identity", { timeout: 15000 }, async () => {
  await withFixture(async (srv) => {
    let failWorkspaces = false;
    srv.respond = (msg, reply, fail) => {
      if (msg.method === "agent.list") {
        reply({ agents: [{ ...testPane, pane_id: "p" }] });
      } else if (msg.method === "workspace.list") {
        if (failWorkspaces) fail("FAILED", "fixture unavailable");
        else {
          reply({
            workspaces: [
              { workspace_id: "w", worktree: { checkout_path: "/repo/feature" } },
            ],
          });
        }
      }
    };

    const first = await listAgents();
    assert.equal(first.length, 1);
    assert.equal(first[0].pane_id, "p");
    const ranked = addOrMoveWorktreeToEnd(defaultState(), first[0]);
    assert.equal(worktreeRankOf(ranked, first[0]), 1);

    failWorkspaces = true;
    await assert.rejects(
      listAgents(),
      /FAILED: fixture unavailable/,
      "a failed workspace.list must reject rather than silently losing worktree identities",
    );
  });
});

test("attention entrypoint dispatches focus on blank Enter", { timeout: 30000 }, async () => {
  await withFixture(async (srv) => {
    saveState(addOrMoveToEnd({ ...defaultState(), mode: "modal", enabled: true }, testPane));
    srv.respond = (msg, reply) => {
      if (msg.method === "agent.list") {
        reply({ agents: [testPane] });
      } else if (msg.method === "workspace.list") {
        reply({ workspaces: [] });
      } else {
        reply({});
      }
    };

    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", fileURLToPath(new URL("../src/herdr/attention.ts", import.meta.url))],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    const { promise: rendered, resolve: resolveRendered } = Promise.withResolvers<void>();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.includes("Attention required")) resolveRendered();
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    try {
      let tripwire: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          rendered,
          new Promise<never>((_, reject) => {
            tripwire = setTimeout(() => {
              child.kill("SIGTERM");
              reject(new Error(`attention never rendered: ${stdout}\n${stderr}`));
            }, 15000);
          }),
        ]);
      } finally {
        clearTimeout(tripwire);
      }
      child.stdin.write("\n");
      const focus = await srv.waitFor(
        (msg) => msg.method === "tab.focus"
          && typeof msg.params === "object"
          && msg.params !== null
          && "tab_id" in msg.params
          && msg.params.tab_id === "t",
      );
      assert.ok(focus, "blank Enter should dispatch tab.focus for the selected urgent agent");

      const { promise: exited, resolve: resolveExit } = Promise.withResolvers<number | null>();
      child.on("exit", (code) => resolveExit(code));
      child.stdin.end("u\n");
      await srv.waitFor((msg) => msg.method === "popup.close");
      const code = await exited;
      assert.equal(code, 0, `attention should exit cleanly after disabling the guard: ${stderr}`);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const { promise: killed, resolve: resolveKilled } = Promise.withResolvers<void>();
        child.on("exit", () => resolveKilled());
        child.kill("SIGTERM");
        await killed;
      }
    }
  });
});
