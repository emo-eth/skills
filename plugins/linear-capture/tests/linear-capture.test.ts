import { describe, expect, it } from "bun:test";
import {
  CANONICAL_SECTIONS,
  checkStructuralRules,
  defaultEvaluatorRunner,
  installLinearCapture,
  parseCommandArgs,
  parseDraftResponse,
  runLinearCapture,
} from "../src/host.ts";
import linearCaptureOmpExtension from "../src/omp.ts";
import linearCapturePiExtension from "../src/pi.ts";
import type {
  EvaluatorResult,
  LinearRunnerResult,
  RuntimeContext,
  RuntimeHost,
} from "../src/types.ts";

function createValidSpec(overrides: { completedLook?: string; envLimits?: string } = {}): string {
  return `## What problem are you trying to solve?
Operators need a fast terminal capture command to record issues directly into Linear.

## Why is it important?
Context-switching to a browser loses nuance and drops operator flow.

## What does it feel like in use?
Typing /linear captures the intent, presents a formatted spec, and posts after confirmation.

## Deliverables
- Plugin implementation with pi and omp entrypoints.
- Test suite verifying capture and posting flow.

## What does completed look like?
${overrides.completedLook ?? "Running the command creates an issue on Linear and outputs the issue URL."}

## Validation steps for reviewers
\`bun test\`

## Environment limits & User Validation needs
${overrides.envLimits ?? "None: 100% pre-merge testable."}`;
}

describe("parseCommandArgs", () => {
  it("parses empty input", () => {
    const res = parseCommandArgs("");
    expect(res.noInterview).toBe(false);
    expect(res.project).toBeUndefined();
    expect(res.title).toBeUndefined();
    expect(res.rawIntent).toBe("");
  });

  it("parses raw intent without flags", () => {
    const res = parseCommandArgs("search results feel sluggish when typing fast");
    expect(res.noInterview).toBe(false);
    expect(res.project).toBeUndefined();
    expect(res.title).toBeUndefined();
    expect(res.rawIntent).toBe("search results feel sluggish when typing fast");
  });

  it("parses --no-interview flag", () => {
    const res = parseCommandArgs("--no-interview fix memory leak in worker");
    expect(res.noInterview).toBe(true);
    expect(res.rawIntent).toBe("fix memory leak in worker");
  });

  it("parses --project and --title with quotes and equals", () => {
    const res1 = parseCommandArgs('--project "Command Center" --title "Bug fix" slow startup');
    expect(res1.project).toBe("Command Center");
    expect(res1.title).toBe("Bug fix");
    expect(res1.rawIntent).toBe("slow startup");

    const res2 = parseCommandArgs("--project=Creatordex --title=Refactor clean up old files");
    expect(res2.project).toBe("Creatordex");
    expect(res2.title).toBe("Refactor");
    expect(res2.rawIntent).toBe("clean up old files");
  });
});

describe("parseDraftResponse", () => {
  it("parses valid JSON response", () => {
    const json = JSON.stringify({
      title: "Fix worker memory leak",
      project: "Command Center",
      interview_questions: ["What is the target threshold?"],
      spec: createValidSpec(),
    });
    const res = parseDraftResponse(json, "worker memory leak");
    expect(res.title).toBe("Fix worker memory leak");
    expect(res.project).toBe("Command Center");
    expect(res.interview_questions).toEqual(["What is the target threshold?"]);
    expect(res.spec).toContain("## What problem are you trying to solve?");
  });

  it("parses JSON wrapped in markdown code blocks", () => {
    const raw = `\`\`\`json
{
  "title": "Slow query optimization",
  "project": "Saddle",
  "interview_questions": [],
  "spec": "${createValidSpec().replace(/\n/g, "\\n")}"
}
\`\`\``;
    const res = parseDraftResponse(raw, "slow query");
    expect(res.title).toBe("Slow query optimization");
    expect(res.project).toBe("Saddle");
    expect(res.interview_questions).toEqual([]);
    expect(res.spec).toContain("## Deliverables");
  });

  it("falls back to markdown extraction when JSON is invalid", () => {
    const raw = `# Title: Raw Markdown Spec

${createValidSpec()}`;
    const res = parseDraftResponse(raw, "fallback intent");
    expect(res.title).toBe("Raw Markdown Spec");
    expect(res.project).toBe("Command Center");
    expect(res.interview_questions).toEqual([]);
    expect(res.spec).toBe(raw);
  });
});

describe("checkStructuralRules", () => {
  it("passes for a spec containing all 7 sections with observable criteria", () => {
    const spec = createValidSpec();
    const check = checkStructuralRules(spec);
    expect(check.valid).toBe(true);
    expect(check.deficiencies).toEqual([]);
  });

  it("rejects specs missing canonical sections", () => {
    const spec = `## What problem are you trying to solve?
Some problem`;
    const check = checkStructuralRules(spec);
    expect(check.valid).toBe(false);
    expect(check.deficiencies.length).toBe(6);
    expect(check.deficiencies).toContain("Missing canonical section: ## Why is it important?");
  });

  it("rejects 'tests pass' in completed look section", () => {
    const spec = createValidSpec({ completedLook: "done when tests pass" });
    const check = checkStructuralRules(spec);
    expect(check.valid).toBe(false);
    expect(check.deficiencies.some((d) => d.includes("Rejects 'tests pass'"))).toBe(true);
  });

  it("rejects empty environment limits section", () => {
    const spec = createValidSpec({ envLimits: "   " });
    const check = checkStructuralRules(spec);
    expect(check.valid).toBe(false);
    expect(check.deficiencies.some((d) => d.includes("Environment limits & User Validation needs' is empty"))).toBe(true);
  });
});

describe("defaultEvaluatorRunner real subprocess", () => {
  it("runs offline evaluator against a valid spec and returns SPECIFIED", async () => {
    const spec = createValidSpec();
    const res = await defaultEvaluatorRunner(spec);
    expect(res.status).toBe("SPECIFIED");
    expect(res.score).toBeGreaterThanOrEqual(0.8);
    expect(res.one_what).toBe(true);
  });

  it("runs offline evaluator against an incomplete spec and reports deficiencies", async () => {
    const spec = `## What problem are you trying to solve?\nBrief text.`;
    const res = await defaultEvaluatorRunner(spec);
    expect(res.status).not.toBe("SPECIFIED");
    expect(res.deficiencies.length).toBeGreaterThan(0);
  });
});

describe("runLinearCapture integration with fakes", () => {
  it("executes full capture flow cleanly", async () => {
    const runnerCalls: string[][] = [];
    const notifications: Array<{ message: string; level?: string }> = [];
    const confirmPrompts: string[] = [];

    const fakeLinearRunner = async (args: string[]): Promise<LinearRunnerResult> => {
      runnerCalls.push(args);
      return {
        stdout: "Creating issue in EMO\nhttps://linear.app/emo-eth/issue/EMO-999/linear-capture-smoke",
        stderr: "",
        exitCode: 0,
      };
    };

    const fakeEvaluatorRunner = async (): Promise<EvaluatorResult> => ({
      status: "SPECIFIED",
      score: 1.0,
      one_what: true,
      deficiencies: [],
      recommendations: [],
      sections_present: Object.fromEntries(CANONICAL_SECTIONS.map((s) => [s.key, true])),
    });

    const fakeModelCaller = async (): Promise<string> =>
      JSON.stringify({
        title: "linear-capture smoke",
        project: "Command Center",
        interview_questions: [],
        spec: createValidSpec(),
      });

    const ctx: RuntimeContext = {
      ui: {
        notify: (message, level) => notifications.push({ message, level }),
        confirm: async (title, message) => {
          confirmPrompts.push(`${title}: ${message}`);
          return true;
        },
      },
    };

    const result = await runLinearCapture(
      "linear-capture smoke",
      ctx,
      undefined,
      {
        linearRunner: fakeLinearRunner,
        evaluatorRunner: fakeEvaluatorRunner,
        modelCaller: fakeModelCaller,
      },
    );

    expect(result.success).toBe(true);
    expect(result.url).toBe("https://linear.app/emo-eth/issue/EMO-999/linear-capture-smoke");
    expect(runnerCalls.length).toBe(1);
    expect(runnerCalls[0]).toContain("issue");
    expect(runnerCalls[0]).toContain("create");
    expect(runnerCalls[0]).toContain("--team");
    expect(runnerCalls[0]).toContain("EMO");
    expect(runnerCalls[0]).toContain("--project");
    expect(runnerCalls[0]).toContain("Command Center");
    expect(runnerCalls[0]).toContain("--title");
    expect(runnerCalls[0]).toContain("linear-capture smoke");
  });

  it("conducts targeted interview when draft has questions", async () => {
    let callCount = 0;
    const interviewQuestionsAsked: string[] = [];

    const fakeModelCaller = async (): Promise<string> => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          title: "Vague intent issue",
          project: "Command Center",
          interview_questions: ["What is the specific failure mode?"],
          spec: createValidSpec(),
        });
      }
      return JSON.stringify({
        title: "Vague intent issue (refined)",
        project: "Command Center",
        interview_questions: [],
        spec: createValidSpec(),
      });
    };

    const ctx: RuntimeContext = {
      ui: {
        input: async (prompt) => {
          interviewQuestionsAsked.push(prompt);
          return "UI freezes on rapid click";
        },
        confirm: async () => true,
      },
    };

    const result = await runLinearCapture("something is broken", ctx, undefined, {
      linearRunner: async () => ({
        stdout: "https://linear.app/emo-eth/issue/EMO-888/vague-intent",
        stderr: "",
        exitCode: 0,
      }),
      evaluatorRunner: async () => ({
        status: "SPECIFIED",
        score: 1.0,
        one_what: true,
        deficiencies: [],
        recommendations: [],
        sections_present: {},
      }),
      modelCaller: fakeModelCaller,
    });

    expect(result.success).toBe(true);
    expect(interviewQuestionsAsked.length).toBe(1);
    expect(interviewQuestionsAsked[0]).toContain("What is the specific failure mode?");
    expect(callCount).toBe(2);
  });

  it("skips interview when --no-interview flag is passed", async () => {
    let callCount = 0;
    const interviewQuestionsAsked: string[] = [];

    const fakeModelCaller = async (): Promise<string> => {
      callCount++;
      return JSON.stringify({
        title: "Vague intent issue",
        project: "Command Center",
        interview_questions: ["Should this be asked?"],
        spec: createValidSpec(),
      });
    };

    const ctx: RuntimeContext = {
      ui: {
        input: async (prompt) => {
          interviewQuestionsAsked.push(prompt);
          return "answer";
        },
        confirm: async () => true,
      },
    };

    const result = await runLinearCapture("--no-interview intent with questions", ctx, undefined, {
      linearRunner: async () => ({
        stdout: "https://linear.app/emo-eth/issue/EMO-777/no-interview",
        stderr: "",
        exitCode: 0,
      }),
      evaluatorRunner: async () => ({
        status: "SPECIFIED",
        score: 1.0,
        one_what: true,
        deficiencies: [],
        recommendations: [],
        sections_present: {},
      }),
      modelCaller: fakeModelCaller,
    });

    expect(result.success).toBe(true);
    expect(interviewQuestionsAsked.length).toBe(0);
    expect(callCount).toBe(1);
  });

  it("handles deficiencies when user chooses to post anyway", async () => {
    let posted = false;
    const confirmPrompts: string[] = [];

    const ctx: RuntimeContext = {
      ui: {
        confirm: async (title, message) => {
          confirmPrompts.push(title);
          return true; // Post anyway & confirm post
        },
      },
    };

    const result = await runLinearCapture("spec with deficiency", ctx, undefined, {
      linearRunner: async () => {
        posted = true;
        return {
          stdout: "https://linear.app/emo-eth/issue/EMO-666/posted-anyway",
          stderr: "",
          exitCode: 0,
        };
      },
      evaluatorRunner: async () => ({
        status: "UNDERSPECIFIED",
        score: 0.5,
        one_what: true,
        deficiencies: ["Minor deficiency in validation steps"],
        recommendations: [],
        sections_present: {},
      }),
      modelCaller: async () =>
        JSON.stringify({
          title: "Minor deficiency issue",
          project: "Command Center",
          interview_questions: [],
          spec: createValidSpec(),
        }),
    });

    expect(result.success).toBe(true);
    expect(posted).toBe(true);
    expect(confirmPrompts).toContain("Structural Deficiencies Detected");
  });

  it("handles deficiencies when user fixes via editor", async () => {
    let posted = false;
    let editorOpened = false;

    const ctx: RuntimeContext = {
      ui: {
        confirm: async (title) => {
          if (title === "Structural Deficiencies Detected") {
            return false; // Choose not to post anyway -> triggers editor
          }
          return true; // Confirm post
        },
        editor: async () => {
          editorOpened = true;
          return createValidSpec(); // Fixed spec
        },
      },
    };

    const result = await runLinearCapture("deficiency to fix", ctx, undefined, {
      linearRunner: async () => {
        posted = true;
        return {
          stdout: "https://linear.app/emo-eth/issue/EMO-555/fixed-spec",
          stderr: "",
          exitCode: 0,
        };
      },
      evaluatorRunner: async (spec) => ({
        status: spec.includes("done when tests pass") ? "UNDERSPECIFIED" : "SPECIFIED",
        score: spec.includes("done when tests pass") ? 0.4 : 1.0,
        one_what: true,
        deficiencies: spec.includes("done when tests pass") ? ["tests pass rejected"] : [],
        recommendations: [],
        sections_present: {},
      }),
      modelCaller: async () =>
        JSON.stringify({
          title: "Needs fix issue",
          project: "Command Center",
          interview_questions: [],
          spec: createValidSpec({ completedLook: "done when tests pass" }),
        }),
    });

    expect(result.success).toBe(true);
    expect(editorOpened).toBe(true);
    expect(posted).toBe(true);
  });

  it("cancels posting when user declines confirmation", async () => {
    let linearRunnerCalled = false;

    const ctx: RuntimeContext = {
      ui: {
        confirm: async () => false,
      },
    };

    const result = await runLinearCapture("some issue intent", ctx, undefined, {
      linearRunner: async () => {
        linearRunnerCalled = true;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      evaluatorRunner: async () => ({
        status: "SPECIFIED",
        score: 1.0,
        one_what: true,
        deficiencies: [],
        recommendations: [],
        sections_present: {},
      }),
      modelCaller: async () =>
        JSON.stringify({
          title: "Declined issue",
          project: "Command Center",
          interview_questions: [],
          spec: createValidSpec(),
        }),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("cancelled by user");
    expect(linearRunnerCalled).toBe(false);
  });

  it("prompts for raw intent when omitted", async () => {
    let prompted = false;

    const ctx: RuntimeContext = {
      ui: {
        input: async () => {
          prompted = true;
          return "prompted raw intent";
        },
        confirm: async () => true,
      },
    };

    const result = await runLinearCapture("", ctx, undefined, {
      linearRunner: async () => ({
        stdout: "https://linear.app/emo-eth/issue/EMO-444/prompted",
        stderr: "",
        exitCode: 0,
      }),
      evaluatorRunner: async () => ({
        status: "SPECIFIED",
        score: 1.0,
        one_what: true,
        deficiencies: [],
        recommendations: [],
        sections_present: {},
      }),
      modelCaller: async () =>
        JSON.stringify({
          title: "Prompted issue",
          project: "Command Center",
          interview_questions: [],
          spec: createValidSpec(),
        }),
    });

    expect(result.success).toBe(true);
    expect(prompted).toBe(true);
  });

  it("registers linear command via installLinearCapture and exports", async () => {
    const commands = new Map<string, { description?: string; handler: (args: string, ctx: RuntimeContext) => Promise<void> | void }>();
    const fakeHost: RuntimeHost = {
      registerCommand: (name, options) => {
        commands.set(name, options);
      },
    };

    installLinearCapture(fakeHost);
    expect(commands.has("linear")).toBe(true);
    expect(commands.get("linear")?.description).toContain("7-question");

    // Test entrypoints
    commands.clear();
    linearCapturePiExtension(fakeHost);
    expect(commands.has("linear")).toBe(true);

    commands.clear();
    linearCaptureOmpExtension(fakeHost);
    expect(commands.has("linear")).toBe(true);
  });
});
