import assert from "node:assert/strict";
import test from "node:test";
import { QuestionnaireComponent } from "../src/tui.ts";
import type { Answer, Question } from "../src/types.ts";

const TEST_QUESTIONS: Question[] = [
  {
    id: "framework",
    prompt: "Choose web framework:",
    header: "Framework",
    type: "select",
    options: [
      { value: "hono", label: "Hono" },
      { value: "express", label: "Express" },
      { value: "fastify", label: "Fastify" },
    ],
  },
  {
    id: "database",
    prompt: "Select database:",
    header: "DB",
    type: "select",
    options: [
      { value: "sqlite", label: "SQLite" },
      { value: "pg", label: "PostgreSQL" },
    ],
    recommended: 0,
  },
  {
    id: "features",
    prompt: "Select extra features:",
    header: "Features",
    type: "select",
    multi: true,
    options: [
      { value: "auth", label: "Auth" },
      { value: "tracing", label: "OpenTelemetry" },
      { value: "cache", label: "Redis cache" },
    ],
  },
  {
    id: "use_docker",
    prompt: "Generate Dockerfile?",
    header: "Deploy",
    type: "confirm",
  },
  {
    id: "app_name",
    prompt: "Application name:",
    header: "Name",
    type: "input",
  },
];

test("QuestionnaireComponent navigates options and submits answers", () => {
  const answered: Record<string, Answer> = {};
  let isDone = false;
  let isPaused = false;

  const comp = new QuestionnaireComponent({
    title: "Test Wizard",
    questions: TEST_QUESTIONS.slice(0, 2),
    stateFile: ".test-state.json",
    onAnswer: (qId, ans) => {
      answered[qId] = ans;
    },
    onDone: (completed, paused) => {
      isDone = completed;
      isPaused = paused;
    },
  });

  // First question: Framework. Press Down to select Express, then Enter
  comp.handleInput("\u001b[B"); // Down arrow
  comp.handleInput("\r"); // Enter

  assert.ok(answered.framework);
  assert.equal(answered.framework.value, "express");

  // Second question: Database. Press Enter (defaults to SQLite / recommended 0)
  comp.handleInput("\r");

  assert.ok(answered.database);
  assert.equal(answered.database.value, "sqlite");
  assert.equal(isDone, true);
  assert.equal(isPaused, false);
});

test("QuestionnaireComponent supports confirm type with y and n keys", () => {
  const answered: Record<string, Answer> = {};
  let isDone = false;

  const comp = new QuestionnaireComponent({
    questions: [TEST_QUESTIONS[3]], // use_docker (confirm)
    stateFile: ".test-state.json",
    onAnswer: (qId, ans) => {
      answered[qId] = ans;
    },
    onDone: (completed) => {
      isDone = completed;
    },
  });

  comp.handleInput("y");

  assert.ok(answered.use_docker);
  assert.equal(answered.use_docker.value, true);
  assert.equal(answered.use_docker.label, "Yes");
  assert.equal(isDone, true);
});

test("QuestionnaireComponent supports multi-select with Space and Enter", () => {
  const answered: Record<string, Answer> = {};
  let isDone = false;

  const comp = new QuestionnaireComponent({
    questions: [TEST_QUESTIONS[2]], // features (multi)
    stateFile: ".test-state.json",
    onAnswer: (qId, ans) => {
      answered[qId] = ans;
    },
    onDone: (completed) => {
      isDone = completed;
    },
  });

  // Toggle first option (auth)
  comp.handleInput(" ");
  // Move to third option (cache)
  comp.handleInput("\u001b[B"); // down
  comp.handleInput("\u001b[B"); // down
  comp.handleInput(" "); // toggle cache

  // Submit with Enter
  comp.handleInput("\r");

  assert.ok(answered.features);
  assert.deepEqual(answered.features.value, ["auth", "cache"]);
  assert.equal(isDone, true);
});

test("QuestionnaireComponent supports text input typing and backspace", () => {
  const answered: Record<string, Answer> = {};
  let isDone = false;

  const comp = new QuestionnaireComponent({
    questions: [TEST_QUESTIONS[4]], // app_name (input)
    stateFile: ".test-state.json",
    onAnswer: (qId, ans) => {
      answered[qId] = ans;
    },
    onDone: (completed) => {
      isDone = completed;
    },
  });

  // Type "my-apx"
  for (const ch of "my-apx") {
    comp.handleInput(ch);
  }
  // Backspace 'x', type 'p'
  comp.handleInput("\u007f");
  comp.handleInput("p");
  // Submit Enter
  comp.handleInput("\r");

  assert.ok(answered.app_name);
  assert.equal(answered.app_name.value, "my-app");
  assert.equal(answered.app_name.custom, true);
  assert.equal(isDone, true);
});

test("QuestionnaireComponent supports backtracking with 'b' key", () => {
  const answered: Record<string, Answer> = {};

  const comp = new QuestionnaireComponent({
    questions: TEST_QUESTIONS.slice(0, 2),
    stateFile: ".test-state.json",
    allowBacktrack: true,
    onAnswer: (qId, ans) => {
      answered[qId] = ans;
    },
    onDone: () => {},
  });

  // Question 1: Framework -> choose "hono"
  comp.handleInput("\r");
  assert.equal(answered.framework?.value, "hono");

  // Now on Question 2. Press 'b' to go back to Question 1
  comp.handleInput("b");

  // Change answer to "fastify" (down, down, enter)
  comp.handleInput("\u001b[B");
  comp.handleInput("\u001b[B");
  comp.handleInput("\r");

  assert.equal(answered.framework?.value, "fastify");
});

test("QuestionnaireComponent pauses and saves progress with 'q'", () => {
  let paused = false;
  let completed = false;

  const comp = new QuestionnaireComponent({
    questions: TEST_QUESTIONS,
    stateFile: ".test-state.json",
    onAnswer: () => {},
    onDone: (c, p) => {
      completed = c;
      paused = p;
    },
  });

  // Press 'q' immediately
  comp.handleInput("q");
  assert.equal(paused, true);
  assert.equal(completed, false);
});

test("QuestionnaireComponent resumes from partial initialAnswers", () => {
  const initialAnswers: Record<string, Answer> = {
    framework: {
      id: "framework",
      value: "hono",
      label: "Hono",
      answeredAt: new Date().toISOString(),
    },
  };

  const comp = new QuestionnaireComponent({
    questions: TEST_QUESTIONS.slice(0, 2),
    initialAnswers,
    stateFile: ".test-state.json",
    onAnswer: () => {},
    onDone: () => {},
  });

  // Verify render shows question 2 (Database [2/2])
  const lines = comp.render(80);
  const renderedText = lines.join("\n");
  assert.ok(renderedText.includes("[2/2]"));
  assert.ok(renderedText.includes("Select database:"));
});
