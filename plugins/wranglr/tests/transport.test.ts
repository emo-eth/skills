import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  call,
  request,
  subscribe,
} from "../src/herdr/transport.ts";
import type { HerdrEvent } from "../src/shared/types.ts";

type JsonMessage = Record<string, unknown>;

/**
 * A tiny local net.Server harness standing in for the real Herdr daemon socket.
 * It sniffs newline-delimited JSON frames and exposes event-driven helpers so
 * tests wait on real conditions rather than fixed durations.
 */
type ServerHandle = {
  /** Unix socket path the harness is listening on. */
  path: string;
  /** Every JSON line received so far, in order. */
  received: JsonMessage[];
  /** Write a newline-delimited JSON frame back to the client. */
  write: (obj: unknown) => void;
  /** Resolves when the client socket has fully closed (used to confirm teardown). */
  closed: Promise<void>;
  /** Resolves with the first received message matching `pred`. */
  waitFor: (pred: (msg: JsonMessage) => boolean) => Promise<JsonMessage>;
  /** Close the server. */
  close: () => Promise<void>;
};

function startServer(): Promise<ServerHandle> {
  const { promise: ready, resolve: resolveReady } = Promise.withResolvers<ServerHandle>();
  const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<void>();

  const sockPath = path.join(
    os.tmpdir(),
    `focus-transport-${process.pid}-${Math.random().toString(36).slice(2)}.sock`,
  );
  const received: JsonMessage[] = [];
  const waiters: Array<{ pred: (m: JsonMessage) => boolean; resolve: (m: JsonMessage) => void }> = [];
  let serverSocket: net.Socket | undefined;
  let buffer = "";

  const push = (msg: JsonMessage): void => {
    received.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(msg)) {
        const waiter = waiters.splice(i, 1)[0];
        waiter.resolve(msg);
      }
    }
  };

  const waitFor = (pred: (msg: JsonMessage) => boolean): Promise<JsonMessage> => {
    const existing = received.find(pred);
    if (existing) return Promise.resolve(existing);
    const { promise, resolve } = Promise.withResolvers<JsonMessage>();
    waiters.push({ pred, resolve });
    return promise;
  };

  const server = net.createServer((socket) => {
    serverSocket = socket;
    socket.setEncoding("utf8");
    // A destroyed client can make later writes fail; never let that crash tests.
    socket.on("error", () => {});
    socket.on("close", resolveClosed);
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        let parsed: JsonMessage;
        try {
          parsed = JSON.parse(line) as JsonMessage;
        } catch {
          continue;
        }
        push(parsed);
      }
    });
  });

  server.listen(sockPath, () => {
    resolveReady({
      path: sockPath,
      received,
      write: (obj) => serverSocket?.write(`${JSON.stringify(obj)}\n`),
      closed,
      waitFor,
      close: () => new Promise((resolveClose) => server.close(() => resolveClose(undefined))),
    });
  });

  return ready;
}

/** Run `run` against a fresh server with HERDR_SOCKET_PATH set; always restore env and close. */
async function withServer(run: (srv: ServerHandle) => Promise<void>): Promise<void> {
  const previousSocket = process.env.HERDR_SOCKET_PATH;
  const srv = await startServer();
  process.env.HERDR_SOCKET_PATH = srv.path;
  try {
    await run(srv);
  } finally {
    if (previousSocket === undefined) {
      delete process.env.HERDR_SOCKET_PATH;
    } else {
      process.env.HERDR_SOCKET_PATH = previousSocket;
    }
    await srv.close();
  }
}

describe("transport", () => {
  it("request frames id/method/params and resolves the matching response, ignoring unrelated lines", async () => {
    await withServer(async (srv) => {
      const pending = request("focus.test", { foo: "bar" });

      const msg = await srv.waitFor((m) => m.method === "focus.test");

      // Framing: a single newline-delimited JSON request with the expected body.
      assert.equal(typeof msg.id, "string");
      assert.ok((msg.id as string).startsWith("wranglr-"));
      assert.deepEqual(msg.params, { foo: "bar" });
      assert.equal(srv.received.length, 1);

      // An unrelated line must be ignored; only the matching id resolves the request.
      srv.write({ id: "some-other-id", result: { nope: true } });
      srv.write({ id: msg.id, result: { ok: true } });

      const response = await pending;
      assert.deepEqual(response, { id: msg.id, result: { ok: true } });
    });
  });

  it("call rejects with `code: message` on an error response", async () => {
    await withServer(async (srv) => {
      const pending = call("focus.bad", {});
      const msg = await srv.waitFor((m) => m.method === "focus.bad");
      srv.write({ id: msg.id, error: { code: "BROKEN", message: "nope" } });

      await assert.rejects(pending, (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "BROKEN: nope");
        return true;
      });
    });
  });

  it("call falls back to a default message when the error payload omits message", async () => {
    await withServer(async (srv) => {
      const pending = call("focus.bad", {});
      const msg = await srv.waitFor((m) => m.method === "focus.bad");
      srv.write({ id: msg.id, error: { code: "X" } });

      await assert.rejects(pending, (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "X: Herdr request failed");
        return true;
      });
    });
  });

  it("subscribe frames events.subscribe, resolves only on ack, then forwards events", async () => {
    await withServer(async (srv) => {
      const events: HerdrEvent[] = [];
      const { promise: gotEvent, resolve: resolveGotEvent } = Promise.withResolvers<void>();
      const pending = subscribe([{ type: "focus.changed" }], (event) => {
        events.push(event);
        if (event.event === "focus.changed") resolveGotEvent();
      });

      const msg = await srv.waitFor((m) => m.method === "events.subscribe");
      assert.equal(msg.method, "events.subscribe");
      assert.ok((msg.id as string).startsWith("wranglr-sub-"));
      assert.deepEqual(msg.params, { subscriptions: [{ type: "focus.changed" }] });

      // Must not resolve until the matching acknowledgement arrives.
      let resolved = false;
      pending.then(() => {
        resolved = true;
      });
      assert.equal(resolved, false);

      srv.write({ id: msg.id, result: {} });
      const sub = await pending;
      assert.equal(resolved, true);

      // Events arriving after the ack are forwarded to the handler.
      srv.write({ event: "focus.changed", data: { a: 1 } });
      await gotEvent;
      assert.deepEqual(events[0].data, { a: 1 });

      sub.close();
      await sub.closed;
    });
  });

  it("subscription close ends the subscription and stops forwarding later events", async () => {
    await withServer(async (srv) => {
      const events: HerdrEvent[] = [];
      const { promise: firstEvent, resolve: resolveFirstEvent } = Promise.withResolvers<void>();
      const pending = subscribe([{ type: "focus.changed" }], (event) => {
        events.push(event);
        if (event.event === "focus.changed") resolveFirstEvent();
      });
      const msg = await srv.waitFor((m) => m.method === "events.subscribe");
      srv.write({ id: msg.id, result: {} });
      const sub = await pending;
      assert.ok(sub.closed instanceof Promise);

      // Confirm live forwarding before closing.
      srv.write({ event: "focus.changed", data: { one: 1 } });
      await firstEvent;
      assert.equal(events.length, 1);

      sub.close();
      await sub.closed;

      // Any event written after close must not reach the handler. Awaiting the
      // server-side close confirms the client socket has torn down, so the write
      // is deterministically dropped rather than guessed via a fixed delay.
      srv.write({ event: "focus.changed", data: { two: 2 } });
      await srv.closed;
      assert.equal(events.length, 1);
    });
  });
});
