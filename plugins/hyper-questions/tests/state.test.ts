import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  computeFingerprint,
  formatAnswersSummary,
  readState,
  removeState,
  STATE_VERSION,
  writeStateAtomic,
} from "../src/state.ts";
import type { Answer, Question, QuestionnaireState } from "../src/types.ts";

const SAMPLE_QUESTIONS: Question[] = [
  {
    id: "q1",
    prompt: "Which database should we use?",
    header: "Database",
    type: "select",
    options: [
      { value: "postgres", label: "PostgreSQL", description: "Relational SQL database" },
      { value: "sqlite", label: "SQLite", description: "Embedded database" },
    ],
    recommended: 0,
  },
  {
    id: "q2",
    prompt: "Enable authentication?",
    header: "Auth",
    type: "confirm",
  },
  {
    id: "q3",
    prompt: "Enter project name:",
    header: "Project",
    type: "input",
  },
];

test("computeFingerprint produces deterministic SHA-256 and detects changes", () => {
  const fp1 = computeFingerprint(SAMPLE_QUESTIONS);
  const fp2 = computeFingerprint(SAMPLE_QUESTIONS);
  assert.equal(fp1, fp2);
  assert.equal(typeof fp1, "string");
  assert.equal(fp1.length, 64);

  const modified = [
    ...SAMPLE_QUESTIONS.slice(0, 2),
    { ...SAMPLE_QUESTIONS[2], prompt: "Enter modified project name:" },
  ];
  const fp3 = computeFingerprint(modified);
  assert.notEqual(fp1, fp3);
});

test("writeStateAtomic writes state that readState recovers correctly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hyper-q-test-"));
  const stateFile = join(dir, "state.json");

  try {
    const fp = computeFingerprint(SAMPLE_QUESTIONS);
    const answers: Record<string, Answer> = {
      q1: {
        id: "q1",
        value: "postgres",
        label: "PostgreSQL",
        answeredAt: new Date().toISOString(),
      },
    };

    const state: QuestionnaireState = {
      version: STATE_VERSION,
      fingerprint: fp,
      title: "Architecture Decisions",
      stateFile,
      answers,
      completed: false,
      updatedAt: new Date().toISOString(),
    };

    await writeStateAtomic(stateFile, state);

    // Read back with matching fingerprint
    const read = await readState(stateFile, fp);
    assert.ok(read);
    assert.equal(read.version, STATE_VERSION);
    assert.equal(read.title, "Architecture Decisions");
    assert.equal(read.answers.q1?.value, "postgres");
    assert.equal(read.completed, false);

    // Read back with mismatched fingerprint returns undefined
    const mismatched = await readState(stateFile, "mismatched-fingerprint");
    assert.equal(mismatched, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readState handles missing and corrupted files gracefully", async () => {
  const nonExistent = join(tmpdir(), "non-existent-state-12345.json");
  const result = await readState(nonExistent);
  assert.equal(result, undefined);

  const dir = await mkdtemp(join(tmpdir(), "hyper-q-corrupt-"));
  const corruptFile = join(dir, "corrupt.json");
  try {
    await writeFile(corruptFile, "{ invalid json ...", "utf8");
    const readCorrupt = await readState(corruptFile);
    assert.equal(readCorrupt, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeState cleans up the state file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hyper-q-rm-"));
  const stateFile = join(dir, "state.json");
  try {
    await writeFile(stateFile, "{}", "utf8");
    await removeState(stateFile);
    const after = await readState(stateFile);
    assert.equal(after, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("formatAnswersSummary renders markdown table and ordered answers", () => {
  const answers: Record<string, Answer> = {
    q1: {
      id: "q1",
      value: "postgres",
      label: "PostgreSQL",
      answeredAt: new Date().toISOString(),
    },
    q2: {
      id: "q2",
      value: true,
      label: "Yes",
      answeredAt: new Date().toISOString(),
    },
  };

  const { markdown, orderedAnswers } = formatAnswersSummary(
    "Setup Wizard",
    SAMPLE_QUESTIONS,
    answers,
    false,
    ".state.json",
  );

  assert.ok(markdown.includes("## Setup Wizard"));
  assert.ok(markdown.includes("Status:** Paused / In-progress"));
  assert.ok(markdown.includes("1. [Database] Which database should we use?"));
  assert.ok(markdown.includes("Answer:** PostgreSQL (postgres)"));
  assert.ok(markdown.includes("2. [Auth] Enable authentication?"));
  assert.ok(markdown.includes("Answer:** Yes"));
  assert.ok(markdown.includes("3. [Project] Enter project name:"));
  assert.ok(markdown.includes("*Not answered yet*"));

  assert.equal(orderedAnswers.length, 2);
  assert.equal(orderedAnswers[0].id, "q1");
  assert.equal(orderedAnswers[0].answer, "postgres");
});
