import assert from "node:assert/strict";
import test from "node:test";
import type { AdvisorConfig } from "../src/config.ts";
import {
  ADVISOR_FOLLOWUP_MARKER,
  DEFAULT_MAX_TRANSCRIPT_CHARS,
  boundTranscript,
  buildFollowUpMessage,
  buildReviewPrompt,
  normalizeNote,
  parseModelSelector,
  parseVerdict,
  runAdvisorReviews,
  serializeTranscript,
  type AdvisorOutcome,
  type ResolvedReviewModel,
  type ReviewModel,
} from "../src/review.ts";

function advisor(name: string, overrides: Partial<AdvisorConfig> = {}): AdvisorConfig {
  return { name, ...overrides };
}

const OK_MODEL: ReviewModel = { provider: "anthropic", id: "claude-sonnet-4-5" };

function recordingInput(overrides: Record<string, unknown> = {}) {
  const completeCalls: Array<{ model: ReviewModel; system: string; user: string }> = [];
  const recorded: Array<{ advisor: AdvisorConfig; outcome: AdvisorOutcome }> = [];
  const sends: string[] = [];
  const dedupe = new Set<string>();
  const input = {
    advisors: [advisor("vibe")],
    sharedInstructions: "shared baseline",
    transcript: [
      { role: "user", content: "Build the feature" },
      { role: "assistant", content: [{ type: "text", text: "Done" }] },
    ],
    dedupe,
    resolveModel: (): ResolvedReviewModel => ({ kind: "ok", model: OK_MODEL }),
    complete: async (model: ReviewModel, system: string, user: string): Promise<string> => {
      completeCalls.push({ model, system, user });
      return '{"pass": true}';
    },
    record: (entry: AdvisorConfig, outcome: AdvisorOutcome) => {
      recorded.push({ advisor: entry, outcome });
    },
    sendFollowUp: (message: string): boolean => {
      sends.push(message);
      return true;
    },
    ...overrides,
  };
  return { input, completeCalls, recorded, sends, dedupe };
}

test("pass verdict records pass and sends no follow-up", async () => {
  const { input, recorded, sends } = recordingInput();
  const result = await runAdvisorReviews(input);
  assert.equal(result.followUp, undefined);
  assert.equal(sends.length, 0);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].outcome.kind, "pass");
});

test("concern verdict returns exactly one marked follow-up with advisor and note", async () => {
  const { input, recorded } = recordingInput({
    complete: async () => '{"severity": "concern", "note": "The retry loop swallows errors."}',
  });
  const result = await runAdvisorReviews(input);
  assert.ok(result.followUp);
  assert.equal(result.followUp.severity, "concern");
  assert.equal(result.followUp.note, "The retry loop swallows errors.");
  assert.ok(result.followUp.message.startsWith(ADVISOR_FOLLOWUP_MARKER));
  assert.ok(result.followUp.message.includes("vibe"));
  assert.equal(recorded[0].outcome.kind, "note");
});

test("nit verdict is retained but never becomes a follow-up", async () => {
  const { input, recorded } = recordingInput({
    complete: async () => '{"severity": "nit", "note": "Minor: rename the variable."}',
  });
  const result = await runAdvisorReviews(input);
  assert.equal(result.followUp, undefined);
  assert.equal(recorded[0].outcome.kind, "note");
  assert.equal(recorded[0].outcome.severity, "nit");
});

test("exact normalized notes dedupe per session; duplicates are suppressed", async () => {
  const verdict = '{"severity": "blocker", "note": "  The   retry loop  swallows errors.  "}';
  const first = recordingInput({ complete: async () => verdict });
  const resultOne = await runAdvisorReviews(first.input);
  assert.ok(resultOne.followUp);
  assert.ok(first.dedupe.has(normalizeNote("The retry loop swallows errors.")));

  const second = recordingInput({ complete: async () => verdict });
  second.input.dedupe = first.dedupe;
  const resultTwo = await runAdvisorReviews(second.input);
  assert.equal(resultTwo.followUp, undefined);
  assert.equal(second.recorded[0].outcome.kind, "note");
  assert.equal(second.recorded[0].outcome.suppressedDuplicate, true);
});

test("the most severe note wins; ties go to the first advisor in roster order", async () => {
  const { input, recorded } = recordingInput({
    advisors: [advisor("first"), advisor("second")],
    complete: async (model) => {
      if (model.id === "first-model") {
        return '{"severity": "concern", "note": "Concern from first."}';
      }
      return '{"severity": "blocker", "note": "Blocker from second."}';
    },
    resolveModel: (entry) => {
      return {
        kind: "ok",
        model:
          entry.name === "first"
            ? { provider: "p", id: "first-model" }
            : { provider: "p", id: "second-model" },
      };
    },
  });
  const result = await runAdvisorReviews(input);
  assert.ok(result.followUp);
  assert.equal(result.followUp.severity, "blocker");
  assert.ok(result.followUp.message.includes("second"));
  assert.equal(recorded.length, 2, "both advisors record outcomes");

  const tie = recordingInput({
    advisors: [advisor("alpha"), advisor("beta")],
    complete: async () => '{"severity": "concern", "note": "Tied concern."}',
  });
  const tieResult = await runAdvisorReviews(tie.input);
  assert.ok(tieResult.followUp);
  assert.ok(tieResult.followUp.message.includes("alpha"));
  assert.equal(tie.recorded.length, 2);
});

test("an unresolvable model yields no_model without calling complete", async () => {
  const { input, completeCalls, recorded } = recordingInput({
    resolveModel: () => ({ kind: "no_model", reason: 'model "anthropic/ghost" not found' }),
  });
  const result = await runAdvisorReviews(input);
  assert.equal(result.followUp, undefined);
  assert.equal(completeCalls.length, 0);
  assert.equal(recorded[0].outcome.kind, "no_model");
  assert.equal(recorded[0].outcome.reason, 'model "anthropic/ghost" not found');
});

test("an advisor failure is isolated: other advisors still review, nothing throws", async () => {
  let callCount = 0;
  const { input, recorded } = recordingInput({
    advisors: [advisor("broken"), advisor("healthy")],
    resolveModel: (entry) => ({
      kind: "ok",
      model:
        entry.name === "broken"
          ? { provider: "p", id: "broken-model" }
          : { provider: "p", id: "healthy-model" },
    }),
    complete: async (model) => {
      callCount++;
      if (model.id === "broken-model") throw new Error("provider exploded");
      return '{"pass": true}';
    },
  });
  const result = await runAdvisorReviews(input);
  assert.equal(result.followUp, undefined);
  assert.equal(callCount, 2);
  assert.equal(recorded[0].outcome.kind, "error");
  assert.equal(recorded[0].outcome.message, "provider exploded");
  assert.equal(recorded[1].outcome.kind, "pass");
});

test("an unparseable verdict records an error and never a follow-up", async () => {
  const { input, recorded } = recordingInput({
    complete: async () => "I reviewed it and it looks mostly fine, maybe check the error paths.",
  });
  const result = await runAdvisorReviews(input);
  assert.equal(result.followUp, undefined);
  assert.equal(recorded[0].outcome.kind, "error");
});

test("transcript text is bounded and elided before reaching complete", async () => {
  const prefix = "Transcript of the completed turn:\n\n";
  const huge = "x".repeat(DEFAULT_MAX_TRANSCRIPT_CHARS * 2);
  const { input, completeCalls } = recordingInput({
    transcript: [
      { role: "user", content: huge },
      { role: "assistant", content: [{ type: "text", text: "tail text" }] },
    ],
  });
  await runAdvisorReviews(input);
  assert.equal(completeCalls.length, 1);
  assert.ok(completeCalls[0].user.length <= DEFAULT_MAX_TRANSCRIPT_CHARS + prefix.length);
  assert.ok(completeCalls[0].user.includes("transcript truncated"));
  assert.ok(completeCalls[0].user.includes("tail text"));
});

test("serializeTranscript renders roles, tool results, and tool calls compactly", () => {
  const text = serializeTranscript([
    { role: "user", content: "hello" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Let me check" },
        { type: "toolCall", name: "bash" },
      ],
    },
    { role: "toolResult", toolName: "bash", isError: true, content: [{ type: "text", text: "boom" }] },
  ]);
  assert.ok(text.includes("### user\nhello"));
  assert.ok(text.includes("(tool call: bash)"));
  assert.ok(text.includes("### toolResult: bash [error]\nboom"));
});

test("boundTranscript keeps short transcripts intact", () => {
  const text = "short";
  assert.equal(boundTranscript(text, 100), text);
});

test("parseVerdict accepts bare JSON, markdown-wrapped JSON, and pass", () => {
  assert.deepEqual(parseVerdict('{"pass": true}'), { kind: "pass" });
  assert.deepEqual(parseVerdict('```json\n{"severity": "blocker", "note": "Fix it."}\n```'), {
    kind: "note",
    severity: "blocker",
    note: "Fix it.",
  });
  assert.deepEqual(parseVerdict('prefix text {"severity": "nit", "note": "Polish."} suffix'), {
    kind: "note",
    severity: "nit",
    note: "Polish.",
  });
  assert.equal(parseVerdict("not json at all").kind, "error");
  assert.equal(parseVerdict('{"severity": "warning", "note": "x"}').kind, "error");
  assert.equal(parseVerdict('{"severity": "blocker"}').kind, "error");
});

test("buildReviewPrompt includes shared and advisor instructions plus the tools limitation", () => {
  const withTools = buildReviewPrompt({
    advisorName: "vibe",
    sharedInstructions: "shared",
    advisorInstructions: "special",
    tools: ["bash", "read"],
    transcript: "t",
  });
  assert.ok(withTools.system.includes("shared"));
  assert.ok(withTools.system.includes("special"));
  assert.ok(withTools.system.includes("no tool loop"));
  assert.ok(withTools.system.includes("bash, read"));
  assert.ok(withTools.user.includes("t"));

  const withoutTools = buildReviewPrompt({
    advisorName: "vibe",
    sharedInstructions: undefined,
    advisorInstructions: undefined,
    tools: undefined,
    transcript: "t",
  });
  assert.ok(!withoutTools.system.includes("no tool loop"));
});

test("parseModelSelector handles provider/model and OMP thinking-level suffixes", () => {
  assert.deepEqual(parseModelSelector("anthropic/claude-sonnet-4-5"), {
    provider: "anthropic",
    id: "claude-sonnet-4-5",
  });
  assert.deepEqual(parseModelSelector("x-ai/grok-code-fast:high"), {
    provider: "x-ai",
    id: "grok-code-fast",
  });
  assert.equal(parseModelSelector("noslash"), undefined);
  assert.equal(parseModelSelector("provider/"), undefined);
  assert.equal(parseModelSelector(""), undefined);
});

test("buildFollowUpMessage is marked, names the advisor, and demands action", () => {
  const message = buildFollowUpMessage("vibe", "blocker", "Fix the leak.");
  assert.ok(message.startsWith(ADVISOR_FOLLOWUP_MARKER));
  assert.ok(message.includes("vibe"));
  assert.ok(message.includes("blocker"));
  assert.ok(message.includes("Fix the leak."));
  assert.ok(message.toLowerCase().includes("before continuing"));
});
