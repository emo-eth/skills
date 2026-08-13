import assert from "node:assert/strict";
import test from "node:test";
import turnSummaryOmpExtension from "../src/omp.ts";
import { TURN_SUMMARY_REMINDER } from "../src/summary.ts";
import turnSummaryPiExtension from "../src/pi.ts";

type Handler = (event: unknown, context: unknown) => unknown;
type Command = {
  handler: (args: string, context: unknown) => unknown;
};
type ContextResult = {
  messages: unknown[];
};

class Host {
  readonly handlers = new Map<string, Handler>();
  readonly commands = new Map<string, Command>();
  readonly notices: string[] = [];

  on(event: string, handler: Handler): void {
    this.handlers.set(event, handler);
  }

  registerCommand(name: string, options: Command): void {
    this.commands.set(name, options);
  }

  emitContext(messages: unknown[] = []): Promise<ContextResult | undefined> {
    return Promise.resolve(this.handlers.get("context")?.({ messages }, this.context()) as ContextResult | undefined);
  }

  context(): unknown {
    return { ui: { notify: (message: string) => this.notices.push(message) } };
  }
}

class ContextOnlyHost {
  readonly handlers = new Map<string, Handler>();

  on(event: string, handler: Handler): void {
    this.handlers.set(event, handler);
  }

  emitContext(messages: unknown[] = []): Promise<ContextResult | undefined> {
    return Promise.resolve(this.handlers.get("context")?.({ messages }, {}) as ContextResult | undefined);
  }
}

function lastMessageText(result: ContextResult | undefined): string {
  if (!result) throw new Error("context handler returned no result");
  const message = result.messages.at(-1);
  if (typeof message !== "object" || message === null || !("content" in message)) {
    throw new Error("context handler returned an invalid message");
  }
  const content = message.content;
  if (!Array.isArray(content)) throw new Error("context message has no content");
  const item = content[0];
  if (typeof item !== "object" || item === null || !("text" in item) || typeof item.text !== "string") {
    throw new Error("context message has no text");
  }
  return item.text;
}

test("the reminder allows up to 400 words", () => {
  assert.equal(
    TURN_SUMMARY_REMINDER,
    "End this turn with a summary: Did / Needs you / Questions / Next. Omit empty sections. Keep it under 400 words.",
  );
});

const adapters = [
  ["Pi", turnSummaryPiExtension],
  ["OMP", turnSummaryOmpExtension],
] as const;

for (const [name, adapter] of adapters) {
  test(`${name} injects one fixed reminder on every context turn`, async () => {
    const host = new Host();
    const controller = adapter(host);
    assert.equal(controller?.isEnabled(), true);

    const existingMessage = { role: "user", content: [{ type: "text", text: "Keep this" }] };
    const first = await host.emitContext([existingMessage]);
    const second = await host.emitContext([]);

    assert.ok(first);
    assert.deepEqual(first.messages, [
      existingMessage,
      { role: "user", content: [{ type: "text", text: TURN_SUMMARY_REMINDER }] },
    ]);
    assert.ok(second);
    assert.deepEqual(second.messages, [
      { role: "user", content: [{ type: "text", text: TURN_SUMMARY_REMINDER }] },
    ]);
  });

  test(`${name} toggle command disables and re-enables the reminder`, async () => {
    const host = new Host();
    const controller = adapter(host);
    const command = host.commands.get("summary");
    assert.ok(command);

    await command.handler("off", host.context());
    assert.equal(controller?.isEnabled(), false);
    assert.equal(await host.emitContext([]), undefined);
    assert.deepEqual(host.notices, ["Turn summary reminder disabled"]);

    await command.handler("on", host.context());
    assert.equal(controller?.isEnabled(), true);
    assert.equal(lastMessageText(await host.emitContext([])), TURN_SUMMARY_REMINDER);
    assert.deepEqual(host.notices, ["Turn summary reminder disabled", "Turn summary reminder enabled"]);

    assert.throws(() => command.handler("maybe", host.context()), /Usage: \/summary on\|off/);
  });
}

test("a host without the optional command seam still receives the reminder", async () => {
  const host = new ContextOnlyHost();
  assert.doesNotThrow(() => turnSummaryOmpExtension(host));
  assert.equal(lastMessageText(await host.emitContext()), TURN_SUMMARY_REMINDER);
});

test("hosts without the native context seam fail closed without crashing", () => {
  assert.doesNotThrow(() => turnSummaryPiExtension({}));
  assert.doesNotThrow(() => turnSummaryOmpExtension(null));
});

test("a throwing host registration seam fails closed without crashing", () => {
  const host = { on: () => { throw new Error("unsupported host"); } };
  assert.doesNotThrow(() => turnSummaryPiExtension(host));
  assert.doesNotThrow(() => turnSummaryOmpExtension(host));
});
