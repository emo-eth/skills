import assert from "node:assert/strict";
import test from "node:test";
import { installLinearCommand, type RuntimeContext, type RuntimeHost } from "../src/host.ts";
import linearOmpExtension from "../src/omp.ts";
import linearPiExtension from "../src/pi.ts";
import type { ClassifierAgent, LinearRunner } from "../src/record.ts";

type Command = {
  description: string;
  handler: (args: string, context: RuntimeContext) => Promise<void> | void;
};

type EventHandler = (event: unknown, context: RuntimeContext) => unknown;

class FakeHost implements RuntimeHost {
  readonly commands = new Map<string, Command>();
  readonly handlers = new Map<string, EventHandler>();

  on(event: string, handler: EventHandler): void {
    this.handlers.set(event, handler);
  }

  registerCommand(name: string, options: Command): void {
    this.commands.set(name, options);
  }

  async emit(event: string, payload: unknown, context: RuntimeContext): Promise<void> {
    await this.handlers.get(event)?.(payload, context);
  }
}

type Notice = { message: string; level?: string };

const testClassifier: ClassifierAgent = async (prompt) =>
  JSON.stringify({
    title: prompt.user.includes("Fix memory leak")
      ? "Fix memory leak in buffer pool"
      : prompt.user.includes("Interactive issue")
        ? "Interactive issue"
        : prompt.user.includes("Direct issue")
          ? "Direct issue without confirmation"
          : prompt.user.includes("Event tracked")
            ? "Event tracked issue"
            : "Test issue",
    project: "Saddle",
    reviewBucket: "Review bucket: 09 Smithers, harnesses, and agent workflows",
    type: "Bug",
    priority: 2,
    team: "EMO",
  });

function createTestContext(options: {
  sessionId?: string;
  hasUI?: boolean;
  confirmResult?: boolean;
  inputResult?: string;
  model?: unknown;
  turn?: number;
} = {}): {
  context: RuntimeContext;
  notices: Notice[];
  confirmCalls: Array<{ title: string; message: string }>;
  inputCalls: Array<{ title: string; placeholder?: string }>;
  sessionEntries: unknown[];
} {
  const notices: Notice[] = [];
  const confirmCalls: Array<{ title: string; message: string }> = [];
  const inputCalls: Array<{ title: string; placeholder?: string }> = [];
  const sessionEntries: unknown[] = [];

  const context: RuntimeContext = {
    cwd: "/Users/emo/test-project",
    sessionId: options.sessionId ?? "session-123",
    turn: options.turn,
    model: options.model,
    hasUI: options.hasUI ?? true,
    ui: {
      notify: (message: string, level?: string) => {
        notices.push({ message, level });
      },
      confirm: async (title: string, message: string) => {
        confirmCalls.push({ title, message });
        return options.confirmResult ?? true;
      },
      input: async (title: string, placeholder?: string) => {
        inputCalls.push({ title, placeholder });
        return options.inputResult;
      },
    },
    sessionManager: {
      getSessionId: () => options.sessionId ?? "session-123",
      getSessionFile: () => "/tmp/session-123.json",
      getTurn: () => options.turn,
    },
  };

  return {
    context,
    notices,
    confirmCalls,
    inputCalls,
    sessionEntries,
  };
}

test("linearOmpExtension registers /linear command with description", () => {
  const host = new FakeHost();
  linearOmpExtension(host);

  const command = host.commands.get("linear");
  assert.ok(command);
  assert.ok(command.description.includes("Linear"));
});

test("linearPiExtension registers /linear command with description", () => {
  const host = new FakeHost();
  linearPiExtension(host);

  const command = host.commands.get("linear");
  assert.ok(command);
  assert.ok(command.description.includes("Linear"));
});

test("confirmation flow creates issue and notifies user without modifying transcript", async () => {
  const host = new FakeHost();
  const runnerCalls: Array<{ cmd: string; args: string[] }> = [];

  const mockRunner: LinearRunner = async (cmd, args) => {
    runnerCalls.push({ cmd, args });
    return {
      stdout: "Created issue EMO-500: Fix memory leak in buffer pool\nhttps://linear.app/emo-eth/issue/EMO-500/fix-memory-leak\n",
      stderr: "",
      exitCode: 0,
    };
  };

  installLinearCommand(host, "OMP", "omp", { runner: mockRunner, classifier: testClassifier });
  const command = host.commands.get("linear");
  assert.ok(command);

  const { context, notices, confirmCalls, sessionEntries } = createTestContext({
    confirmResult: true,
  });

  await command.handler("Fix memory leak in buffer pool", context);

  assert.equal(confirmCalls.length, 1);
  assert.ok(confirmCalls[0].title.includes("Fix memory leak in buffer pool"));
  assert.equal(runnerCalls.length, 1);
  assert.ok(runnerCalls[0].args.includes("-t"));
  assert.ok(runnerCalls[0].args.includes("Fix memory leak in buffer pool"));

  assert.equal(notices.length, 1);
  assert.equal(notices[0].level, "info");
  assert.ok(notices[0].message.includes("EMO-500"));
  assert.ok(notices[0].message.includes("https://linear.app/emo-eth/issue/EMO-500/fix-memory-leak"));

  assert.equal(sessionEntries.length, 0);
});

test("cancellation flow skips runner and notifies cancellation", async () => {
  const host = new FakeHost();
  let runnerInvoked = false;

  const mockRunner: LinearRunner = async () => {
    runnerInvoked = true;
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  installLinearCommand(host, "OMP", "omp", { runner: mockRunner, classifier: testClassifier });
  const command = host.commands.get("linear")!;

  const { context, notices, confirmCalls } = createTestContext({
    confirmResult: false,
  });

  await command.handler("Implement user profile page", context);

  assert.equal(confirmCalls.length, 1);
  assert.equal(runnerInvoked, false);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].level, "info");
  assert.ok(notices[0].message.includes("cancelled"));
});

test("interactive input flow prompts when command args are empty", async () => {
  const host = new FakeHost();
  const runnerCalls: string[][] = [];

  const mockRunner: LinearRunner = async (_cmd, args) => {
    runnerCalls.push(args);
    return {
      stdout: "Created issue EMO-501: Interactive issue\n",
      stderr: "",
      exitCode: 0,
    };
  };

  installLinearCommand(host, "Pi", "pi", { runner: mockRunner, classifier: testClassifier });
  const command = host.commands.get("linear")!;

  const { context, notices, inputCalls, confirmCalls } = createTestContext({
    inputResult: "Interactive issue",
    confirmResult: true,
  });

  await command.handler("", context);

  assert.equal(inputCalls.length, 1);
  assert.equal(confirmCalls.length, 1);
  assert.equal(runnerCalls.length, 1);
  assert.ok(runnerCalls[0].includes("Interactive issue"));
  assert.equal(notices.length, 1);
  assert.ok(notices[0].message.includes("EMO-501"));
});

test("interactive input cancellation exits early", async () => {
  const host = new FakeHost();
  let runnerInvoked = false;

  const mockRunner: LinearRunner = async () => {
    runnerInvoked = true;
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  installLinearCommand(host, "Pi", "pi", { runner: mockRunner, classifier: testClassifier });
  const command = host.commands.get("linear")!;

  const { context, notices, inputCalls, confirmCalls } = createTestContext({
    inputResult: undefined,
  });

  await command.handler("   ", context);

  assert.equal(inputCalls.length, 1);
  assert.equal(confirmCalls.length, 0);
  assert.equal(runnerInvoked, false);
  assert.equal(notices.length, 1);
  assert.ok(notices[0].message.includes("cancelled"));
});

test("bare command in non-interactive mode notifies error usage", async () => {
  const host = new FakeHost();
  installLinearCommand(host, "OMP", "omp", { classifier: testClassifier });
  const command = host.commands.get("linear")!;

  const { context, notices } = createTestContext({
    hasUI: false,
  });

  await command.handler("", context);

  assert.equal(notices.length, 1);
  assert.equal(notices[0].level, "error");
  assert.ok(notices[0].message.includes("Usage: /linear"));
});

test("non-interactive execution creates issue directly without confirmation prompt", async () => {
  const host = new FakeHost();
  const runnerCalls: string[][] = [];

  const mockRunner: LinearRunner = async (_cmd, args) => {
    runnerCalls.push(args);
    return {
      stdout: "Created issue EMO-502: Direct issue without confirmation\n",
      stderr: "",
      exitCode: 0,
    };
  };

  installLinearCommand(host, "OMP", "omp", { runner: mockRunner, classifier: testClassifier });
  const command = host.commands.get("linear")!;

  const { context, notices, confirmCalls } = createTestContext({
    hasUI: false,
  });

  await command.handler("Direct issue without confirmation", context);

  assert.equal(confirmCalls.length, 0);
  assert.equal(runnerCalls.length, 1);
  assert.equal(notices.length, 1);
  assert.ok(notices[0].message.includes("EMO-502"));
});

test("runner error notifies with error level", async () => {
  const host = new FakeHost();
  const mockRunner: LinearRunner = async () => ({
    stdout: "",
    stderr: "API rate limit exceeded",
    exitCode: 1,
  });

  installLinearCommand(host, "OMP", "omp", { runner: mockRunner, classifier: testClassifier });
  const command = host.commands.get("linear")!;

  const { context, notices } = createTestContext({
    confirmResult: true,
  });

  await command.handler("Fix rate limit handling", context);

  assert.equal(notices.length, 1);
  assert.equal(notices[0].level, "error");
  assert.ok(notices[0].message.includes("API rate limit exceeded"));
});

test("lifecycle events record turn and model in session state", async () => {
  const host = new FakeHost();
  const capturedArgs: unknown[] = [];

  const mockRunner: LinearRunner = async (_cmd, args) => {
    capturedArgs.push(...args);
    return { stdout: "Created issue EMO-503: Event tracked issue\n", stderr: "", exitCode: 0 };
  };

  installLinearCommand(host, "OMP", "omp", { runner: mockRunner, classifier: testClassifier });
  const command = host.commands.get("linear")!;

  const { context } = createTestContext({
    sessionId: "tracked-session",
    hasUI: false,
  });

  await host.emit("before_agent_start", { model: "anthropic/claude-3-7-sonnet" }, context);
  await host.emit("turn_start", { turn: 5 }, context);

  await command.handler("Event tracked issue", context);

  const descIndex = (capturedArgs as string[]).indexOf("-d");
  assert.ok(descIndex !== -1);
  const description = (capturedArgs as string[])[descIndex + 1];
  assert.ok(description.includes("- **Turn:** 5"));
  assert.ok(description.includes("- **Model:** anthropic/claude-3-7-sonnet"));
});
