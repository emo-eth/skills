import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  DELEGATION_CANCEL_EVENT,
  DELEGATION_REQUEST_EVENT,
  DELEGATION_RESPONSE_EVENT,
  SubagentsAdapter,
  type DelegationResponse,
  type EventBus,
} from "../src/subagents.ts";
import type { BotContextMode, BotDefinition, BotRoster } from "../src/types.ts";

type EventHandler = (payload: unknown) => void;


interface DelegationRequestPayload {
  requestId: string;
  ownerRunId: string;
  nodeId: string;
  agent: string;
  task: string;
  context: BotContextMode;
  cwd: string;
  timeoutMs: number;
  result: { kind: "text" };
}

interface CancelPayload {
  requestId: string;
  ownerRunId: string;
  nodeId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USAGE = {
  input: 120,
  output: 45,
  cacheRead: 8,
  cacheWrite: 0,
  cost: 0.0132,
  turns: 2,
  toolCalls: 1,
  durationMs: 800,
};

function makeBot(overrides: Partial<BotDefinition> = {}): BotDefinition {
  return {
    name: "scout",
    runtimeName: "bot-scout",
    title: "Scout",
    description: "Explores untracked areas of the codebase",
    domains: ["exploration"],
    fallbackModels: ["zai/glm-5.3-flash"],
    delegates: [],
    memory: "off",
    context: "fresh",
    timeoutMs: 5_000,
    maxSubagentDepth: 0,
    enabled: true,
    scope: "project",
    configPath: "/project/bots.yml",
    ...overrides,
  };
}

function makeRoster(bots: BotDefinition[]): BotRoster {
  return {
    version: 1,
    bots,
    domainOwners: { exploration: "bot-scout" },
    sharedInstructions: "Shared bot instructions",
    sources: ["/project/bots.yml"],
    projectRoot: "/project",
    agentDir: "/project/.pi",
  };
}

class FakeEventBus implements EventBus {
  readonly emitted: Array<{ event: string; payload: unknown }> = [];

  private readonly handlers = new Map<string, EventHandler[]>();


  on(event: string, handler: EventHandler): () => void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
    return () => {
      const current = this.handlers.get(event);
      if (!current) return;
      const index = current.indexOf(handler);
      if (index >= 0) current.splice(index, 1);
    };
  }

  emit(event: string, payload: unknown): void {
    this.emitted.push({ event, payload });
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(payload);
  }

  payloadsOf<T>(event: string): T[] {
    return this.emitted
      .filter((entry) => entry.event === event)
      .map((entry) => entry.payload as T);
  }

  listenerCount(event: string): number {
    return (this.handlers.get(event) ?? []).length;
  }

}

function makeAdapter(): { bus: FakeEventBus; adapter: SubagentsAdapter } {
  const bus = new FakeEventBus();
  return { bus, adapter: new SubagentsAdapter(bus) };
}

function runInput(
  bot: BotDefinition,
  overrides: Partial<Parameters<SubagentsAdapter["run"]>[0]> = {},
): Parameters<SubagentsAdapter["run"]>[0] {
  return {
    bot,
    task: "Map the auth module",
    cwd: "/project/work",
    ownerRunId: "run-1",
    nodeId: "node-7",
    ...overrides,
  };
}

test("activateRoster exposes enabled native agent names", () => {
  const { bus, adapter } = makeAdapter();
  adapter.activateRoster(makeRoster([
    makeBot(),
    makeBot({ name: "guard", runtimeName: "bot-guard", domains: ["safety"], enabled: false }),
  ]));
  assert.deepEqual(adapter.availableNames(), ["bot-scout"]);
  assert.deepEqual(bus.emitted, []);
});

test("activateRoster replaces availability and dispose clears it", () => {
  const { adapter } = makeAdapter();
  adapter.activateRoster(makeRoster([
    makeBot(),
    makeBot({ name: "guard", runtimeName: "bot-guard", domains: ["safety"] }),
  ]));
  assert.deepEqual(adapter.availableNames(), ["bot-scout", "bot-guard"]);
  adapter.activateRoster(makeRoster([
    makeBot({ name: "nova", runtimeName: "bot-nova", domains: ["delivery"] }),
  ]));
  assert.deepEqual(adapter.availableNames(), ["bot-nova"]);
  adapter.dispose();
  assert.deepEqual(adapter.availableNames(), []);
});

test("run emits the exact delegation request and resolves the completed response", async () => {
  const { bus, adapter } = makeAdapter();
  const scout = makeBot();
  adapter.activateRoster(makeRoster([scout]));

  const promise = adapter.run(runInput(scout));
  const request = bus.payloadsOf<DelegationRequestPayload>(DELEGATION_REQUEST_EVENT)[0];
  assert.match(request.requestId, UUID_PATTERN);
  assert.deepEqual(request, {
    requestId: request.requestId,
    ownerRunId: "run-1",
    nodeId: "node-7",
    agent: "bot-scout",
    task: "Map the auth module",
    context: "fresh",
    cwd: "/project/work",
    timeoutMs: 5_000,
    result: { kind: "text" },
  });
  assert.equal(bus.listenerCount(DELEGATION_RESPONSE_EVENT), 1);

  const response: DelegationResponse = {
    requestId: request.requestId,
    ownerRunId: "run-1",
    nodeId: "node-7",
    status: "completed",
    agent: "bot-scout",
    model: "zai/glm-5.3-flash",
    exitCode: 0,
    launchContractDigest: "digest-1",
    result: { kind: "text", text: "mapped" },
    usage: USAGE,
  };
  bus.emit(DELEGATION_RESPONSE_EVENT, response);

  assert.equal(await promise, response);
  assert.deepEqual(bus.payloadsOf(DELEGATION_CANCEL_EVENT), []);
  assert.equal(bus.listenerCount(DELEGATION_RESPONSE_EVENT), 0);
});

test("run ignores responses that do not correlate", async () => {
  const { bus, adapter } = makeAdapter();
  const promise = adapter.run(runInput(makeBot()));
  const request = bus.payloadsOf<DelegationRequestPayload>(DELEGATION_REQUEST_EVENT)[0];
  const correlation = { requestId: request.requestId, ownerRunId: "run-1", nodeId: "node-7" };

  bus.emit(DELEGATION_RESPONSE_EVENT, {
    ...correlation,
    requestId: randomUUID(),
    status: "completed",
    result: { kind: "text", text: "other request" },
  });
  bus.emit(DELEGATION_RESPONSE_EVENT, {
    ...correlation,
    ownerRunId: "run-9",
    status: "completed",
    result: { kind: "text", text: "other run" },
  });
  bus.emit(DELEGATION_RESPONSE_EVENT, {
    ...correlation,
    nodeId: "node-9",
    status: "completed",
    result: { kind: "text", text: "other node" },
  });
  bus.emit(DELEGATION_RESPONSE_EVENT, {
    requestId: request.requestId,
    status: "completed",
    result: { kind: "text", text: "missing correlation" },
  });

  assert.equal(bus.listenerCount(DELEGATION_RESPONSE_EVENT), 1);
  assert.deepEqual(bus.payloadsOf(DELEGATION_CANCEL_EVENT), []);

  const matched: DelegationResponse = {
    ...correlation,
    status: "completed",
    result: { kind: "text", text: "matched" },
  };
  bus.emit(DELEGATION_RESPONSE_EVENT, matched);

  assert.equal(await promise, matched);
});

test("run passes through non-completed statuses without interpreting them", async () => {
  for (const status of ["failed", "cancelled", "timed_out"] as const) {
    const { bus, adapter } = makeAdapter();
    const promise = adapter.run(runInput(makeBot()));
    const request = bus.payloadsOf<DelegationRequestPayload>(DELEGATION_REQUEST_EVENT)[0];

    const response: DelegationResponse = {
      requestId: request.requestId,
      ownerRunId: "run-1",
      nodeId: "node-7",
      status,
      error: `delegation ended with ${status}`,
      exitCode: 1,
    };
    bus.emit(DELEGATION_RESPONSE_EVENT, response);

    assert.equal(await promise, response);
  }
});

test("run cancels and rejects when the signal aborts", async () => {
  const { bus, adapter } = makeAdapter();
  const controller = new AbortController();

  const promise = adapter.run(runInput(makeBot(), { signal: controller.signal }));
  const request = bus.payloadsOf<DelegationRequestPayload>(DELEGATION_REQUEST_EVENT)[0];
  controller.abort();

  await assert.rejects(promise, { message: "Bot delegation was cancelled." });
  assert.deepEqual(bus.payloadsOf<CancelPayload>(DELEGATION_CANCEL_EVENT), [
    { requestId: request.requestId, ownerRunId: "run-1", nodeId: "node-7" },
  ]);
  assert.equal(bus.listenerCount(DELEGATION_RESPONSE_EVENT), 0);
});

test("run rejects immediately for a pre-aborted signal without emitting a request", async () => {
  const { bus, adapter } = makeAdapter();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(adapter.run(runInput(makeBot(), { signal: controller.signal })), {
    message: "Bot delegation was cancelled.",
  });

  assert.deepEqual(bus.payloadsOf(DELEGATION_REQUEST_EVENT), []);
  assert.deepEqual(bus.payloadsOf(DELEGATION_CANCEL_EVENT), []);
});

test("child process denies runs and exposes no parent-native availability", async () => {
  const prior = makeAdapter();
  const scout = makeBot();
  prior.adapter.activateRoster(makeRoster([scout]));

  const previous = process.env.PI_SUBAGENT_CHILD;
  process.env.PI_SUBAGENT_CHILD = "1";
  try {
    prior.adapter.activateRoster(makeRoster([
      makeBot({ name: "nova", runtimeName: "bot-nova", domains: ["research"] }),
    ]));
    assert.deepEqual(prior.adapter.availableNames(), []);
    await assert.rejects(prior.adapter.run(runInput(scout)), {
      message: "A bot delegates to peers with Pi's native subagent tool, not bots run.",
    });
    assert.deepEqual(prior.bus.emitted, []);

    const fresh = makeAdapter();
    fresh.adapter.activateRoster(makeRoster([makeBot()]));
    assert.deepEqual(fresh.adapter.availableNames(), []);
    await assert.rejects(fresh.adapter.run(runInput(makeBot())), {
      message: "A bot delegates to peers with Pi's native subagent tool, not bots run.",
    });
    assert.deepEqual(fresh.bus.emitted, []);
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
    else process.env.PI_SUBAGENT_CHILD = previous;
  }

  if (previous === undefined) assert.equal(process.env.PI_SUBAGENT_CHILD, undefined);
  else assert.equal(process.env.PI_SUBAGENT_CHILD, previous);
});
