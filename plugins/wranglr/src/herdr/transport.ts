import net from "node:net";

import { isRecord } from "../shared/guards.ts";
import type { HerdrEvent } from "../shared/types.ts";

export type ApiResponse = {
  id?: string;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  [key: string]: unknown;
};

type EventHandler = (event: HerdrEvent) => void;

let requestSequence = 0;
const REQUEST_TIMEOUT_MS = 10_000;
type TimerHandle = NodeJS.Timeout;

export type HerdrSubscription = {
  closed: Promise<void>;
  close: () => void;
};

export function herdrSocketPath(): string {
  const path = process.env.HERDR_SOCKET_PATH;
  if (!path) throw new Error("HERDR_SOCKET_PATH is not set");
  return path;
}

export async function request(
  method: string,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  const id = `wranglr-${process.pid}-${requestSequence++}`;
  const socket = net.createConnection(herdrSocketPath());
  return new Promise<ApiResponse>((resolve, reject) => {
    let buffer = "";
    let settled = false;
    let timeout: TimerHandle | undefined;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      socket.destroy();
      callback();
    };
    timeout = setTimeout(() => {
      finish(() => reject(new Error(`Herdr request timed out: ${method}`)));
    }, REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        let parsed: ApiResponse;
        try {
          parsed = JSON.parse(line) as ApiResponse;
        } catch {
          continue;
        }
        if (parsed.id !== id) continue;
        finish(() => resolve(parsed));
        return;
      }
    });
    socket.on("error", (error) => finish(() => reject(error)));
    socket.on("close", () => {
      if (!settled) finish(() => reject(new Error("Herdr socket closed before the response")));
    });
  });
}

export async function call(
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await request(method, params);
  if (response.error) {
    const code = typeof response.error.code === "string" ? response.error.code : "unknown";
    const message = typeof response.error.message === "string"
      ? response.error.message
      : "Herdr request failed";
    throw new Error(`${code}: ${message}`);
  }
  return response.result ?? {};
}
export async function subscribe(
  subscriptions: Array<Record<string, unknown>>,
  onEvent: EventHandler,
): Promise<HerdrSubscription> {
  const id = `wranglr-sub-${process.pid}-${requestSequence++}`;
  const socket = net.createConnection(herdrSocketPath());
  let buffer = "";
  let acknowledged = false;
  let settled = false;
  let acknowledgementTimeout: TimerHandle | undefined;
  let resolveClosed: () => void = () => undefined;
  let resolveAcknowledgement: () => void = () => undefined;
  let rejectAcknowledgement: (error: Error) => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const acknowledgedPromise = new Promise<void>((resolve, reject) => {
    resolveAcknowledgement = resolve;
    rejectAcknowledgement = reject;
  });

  const close = (): void => {
    if (settled) return;
    settled = true;
    if (acknowledgementTimeout) {
      clearTimeout(acknowledgementTimeout);
      acknowledgementTimeout = undefined;
    }
    if (!acknowledged) {
      rejectAcknowledgement(new Error("Herdr event subscription closed before acknowledgement"));
    }
    socket.destroy();
    resolveClosed();
  };

  acknowledgementTimeout = setTimeout(() => {
    rejectAcknowledgement(new Error("Herdr event subscription acknowledgement timed out"));
    close();
  }, REQUEST_TIMEOUT_MS);
  acknowledgementTimeout.unref?.();

  socket.setEncoding("utf8");
  socket.on("connect", () => {
    socket.write(`${JSON.stringify({
      id,
      method: "events.subscribe",
      params: { subscriptions },
    })}\n`);
  });
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed.id === id) {
        if (isRecord(parsed.error)) {
          const message = typeof parsed.error.message === "string"
            ? parsed.error.message
            : "event subscription failed";
          rejectAcknowledgement(new Error(message));
          close();
        } else {
          acknowledged = true;
          clearTimeout(acknowledgementTimeout);
          acknowledgementTimeout = undefined;
          resolveAcknowledgement();
        }
        continue;
      }
      if (!acknowledged) continue;
      const event = eventFromMessage(parsed);
      if (event) onEvent(event);
    }
  });
  socket.on("error", (error) => {
    if (!acknowledged) {
      rejectAcknowledgement(error instanceof Error ? error : new Error(String(error)));
    }
    close();
  });
  socket.on("close", () => {
    if (settled) return;
    settled = true;
    clearTimeout(acknowledgementTimeout);
    acknowledgementTimeout = undefined;
    if (!acknowledged) {
      rejectAcknowledgement(new Error("Herdr event subscription closed"));
    }
    resolveClosed();
  });

  await acknowledgedPromise;
  return { closed, close };
}

function eventFromMessage(message: Record<string, unknown>): HerdrEvent | undefined {
  const eventName = typeof message.event === "string"
    ? message.event
    : typeof message.type === "string"
      ? message.type
      : typeof message.method === "string"
        ? message.method
        : undefined;
  if (!eventName) return undefined;
  const data = message.data ?? message.params;
  return {
    event: eventName,
    data: isRecord(data) ? data : {},
    raw: message,
  };
}
