import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  HyperQuestionsRunner,
  installHyperQuestions,
  type RegisteredCommandDefinition,
  type RegisteredToolDefinition,
  type RuntimeContext,
  type RuntimeHost,
} from "../src/host.ts";
import type { ThemeLike, TuiLike } from "../src/tui.ts";
import { readState } from "../src/state.ts";
import type { Question } from "../src/types.ts";

const TEST_QUESTIONS: Question[] = [
  {
    id: "arch",
    prompt: "Choose architecture style:",
    type: "select",
    options: [
      { value: "modular", label: "Modular monolith" },
      { value: "microservices", label: "Microservices" },
    ],
  },
  {
    id: "auth",
    prompt: "Enable OAuth2?",
    type: "confirm",
  },
];

class FakeHost implements RuntimeHost {
  readonly tools = new Map<string, RegisteredToolDefinition>();
  readonly commands = new Map<string, RegisteredCommandDefinition>();

  registerTool(definition: RegisteredToolDefinition): void {
    this.tools.set(definition.name, definition);
  }

  registerCommand(name: string, options: RegisteredCommandDefinition): void {
    this.commands.set(name, options);
  }
}

test("installHyperQuestions registers hyper_ask tool and hyper-questions command", () => {
  const host = new FakeHost();
  installHyperQuestions(host);

  assert.ok(host.tools.has("hyper_ask"));
  const tool = host.tools.get("hyper_ask")!;
  assert.equal(tool.name, "hyper_ask");
  assert.ok(tool.description.includes("saving"));

  assert.ok(host.commands.has("hyper-questions"));
});

test("installHyperQuestions throws if registerTool is not available", () => {
  assert.throws(
    () => installHyperQuestions({} as unknown as RuntimeHost),
    /requires host\.registerTool/,
  );
});

test("HyperQuestionsRunner executes in TUI mode and saves state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hyper-runner-test-"));
  const stateFile = join(dir, "state.json");
  const outputFile = join(dir, "output.md");

  try {
    const runner = new HyperQuestionsRunner();

    // Mock TUI context where custom TUI executes the questionnaire
    const ctx: RuntimeContext = {
      mode: "tui",
      ui: {
        custom: async <T>(
          factory: (tui: TuiLike, theme: ThemeLike, keybindings: unknown, done: (result: T) => void) => unknown,
        ): Promise<T> => {
          // Simulate answering both questions
          let completed = false;
          let paused = false;
          const component = factory(
            { requestRender: () => {} },
            {},
            {},
            (result: unknown) => {
              const res = result as { completed: boolean; paused: boolean };
              completed = res.completed;
              paused = res.paused;
            },
          ) as { handleInput: (key: string) => void };

          // Answer Q1: Modular monolith (Enter)
          component.handleInput("\r");
          // Answer Q2: Confirm OAuth2 (y)
          component.handleInput("y");

          return { completed, paused } as unknown as T;
        },
      },
    };

    const result = await runner.execute(
      {
        title: "Architecture Questionnaire",
        questions: TEST_QUESTIONS,
        stateFile,
        outputFile,
      },
      ctx,
    );

    assert.ok(result.details);
    assert.equal(result.details.completed, true);
    assert.equal(result.details.paused, false);
    assert.equal(result.details.answers.arch?.value, "modular");
    assert.equal(result.details.answers.auth?.value, true);

    // Verify state was saved to disk
    const saved = await readState(stateFile);
    assert.ok(saved);
    assert.equal(saved.completed, true);
    assert.equal(saved.answers.arch?.value, "modular");
    assert.equal(saved.answers.auth?.value, true);

    // Verify output file was written
    const outputContent = await readFile(outputFile, "utf8");
    assert.ok(outputContent.includes("Architecture Questionnaire"));
    assert.ok(outputContent.includes("Modular monolith"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("HyperQuestionsRunner pauses and resumes cleanly across invocations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hyper-resume-test-"));
  const stateFile = join(dir, "state.json");

  try {
    const runner = new HyperQuestionsRunner();

    // Invocation 1: Answer Q1, then pause with 'q'
    const ctx1: RuntimeContext = {
      mode: "tui",
      ui: {
        custom: async <T>(
          factory: (tui: TuiLike, theme: ThemeLike, keybindings: unknown, done: (result: T) => void) => unknown,
        ): Promise<T> => {
          let completed = false;
          let paused = false;
          const component = factory(
            { requestRender: () => {} },
            {},
            {},
            (result: unknown) => {
              const res = result as { completed: boolean; paused: boolean };
              completed = res.completed;
              paused = res.paused;
            },
          ) as { handleInput: (key: string) => void };

          // Answer Q1: Modular monolith (Enter)
          component.handleInput("\r");
          // Pause on Q2: 'q'
          component.handleInput("q");

          return { completed, paused } as unknown as T;
        },
      },
    };
    const res1 = await runner.execute(
      {
        title: "Two-step Run",
        questions: TEST_QUESTIONS,
        stateFile,
        resume: true,
      },
      ctx1,
    );

    assert.ok(res1.details);
    assert.equal(res1.details.completed, false);
    assert.equal(res1.details.paused, true);
    assert.equal(res1.details.answers.arch?.value, "modular");
    assert.equal(res1.details.answers.auth, undefined);

    // Invocation 2: Resume! Component starts at Q2. Answer Q2 (y) to complete
    const ctx2: RuntimeContext = {
      mode: "tui",
      ui: {
        custom: async <T>(
          factory: (tui: TuiLike, theme: ThemeLike, keybindings: unknown, done: (result: T) => void) => unknown,
        ): Promise<T> => {
          let completed = false;
          let paused = false;
          const component = factory(
            { requestRender: () => {} },
            {},
            {},
            (result: unknown) => {
              const res = result as { completed: boolean; paused: boolean };
              completed = res.completed;
              paused = res.paused;
            },
          ) as { handleInput: (key: string) => void };

          // Answer Q2: 'y'
          component.handleInput("y");

          return { completed, paused } as unknown as T;
        },
      },
    };

    const res2 = await runner.execute(
      {
        title: "Two-step Run",
        questions: TEST_QUESTIONS,
        stateFile,
        resume: true,
      },
      ctx2,
    );

    assert.ok(res2.details);
    assert.equal(res2.details.completed, true);
    assert.equal(res2.details.paused, false);
    assert.equal(res2.details.answers.arch?.value, "modular");
    assert.equal(res2.details.answers.auth?.value, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("HyperQuestionsRunner reports error when questions array is empty", async () => {
  const runner = new HyperQuestionsRunner();
  const result = await runner.execute({ questions: [] }, {});
  assert.ok(result.content[0].text.includes("Error: questions array must not be empty"));
});

test("HyperQuestionsRunner informs caller when in headless/print mode without UI", async () => {
  const runner = new HyperQuestionsRunner();
  const result = await runner.execute(
    { questions: TEST_QUESTIONS },
    { mode: "print" },
  );
  assert.ok(result.content[0].text.includes("Interactive questionnaire requires an active TUI"));
  assert.equal(result.details?.completed, false);
  assert.equal(result.details?.paused, true);
});
