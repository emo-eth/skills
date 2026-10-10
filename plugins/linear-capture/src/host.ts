import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DraftSpecResult,
  EvaluatorResult,
  EvaluatorRunner,
  LinearCaptureOptions,
  LinearRunner,
  LinearRunnerResult,
  ModelCaller,
  RuntimeContext,
  RuntimeHost,
} from "./types.ts";

export const CANONICAL_SECTIONS = [
  { key: "problem", heading: "## What problem are you trying to solve?" },
  { key: "importance", heading: "## Why is it important?" },
  { key: "feel_in_use", heading: "## What does it feel like in use?" },
  { key: "deliverables", heading: "## Deliverables" },
  { key: "completed_look", heading: "## What does completed look like?" },
  { key: "validation_steps", heading: "## Validation steps for reviewers" },
  { key: "environment_limits", heading: "## Environment limits & User Validation needs" },
] as const;

export const KNOWN_PROJECTS = [
  "Command Center",
  "Creatordex",
  "Japan Trip 2026",
  "Saddle",
  "BMO / Springfield",
  "Personal / Ops",
] as const;

export const DEFAULT_PROJECT = "Command Center";

export const DRAFT_SYSTEM_PROMPT = `You are a Vibe Driven Development (VDD) specification specialist for Team EMO.
Your job is to convert raw issue intent into the canonical 7-question Linear issue specification.

The specification must strictly answer the following 7 questions in this exact order:

## What problem are you trying to solve?
[One crisp paragraph describing the user problem, failure mode, or missing capability. Governed strictly by the "One What Per Ticket" rule (single primary outcome). No implementation trivia.]

## Why is it important?
[The stakes: why this matters now, who is blocked or degraded, and what happens if left unaddressed.]

## What does it feel like in use?
[The qualitative experience, ergonomics, and feel boundaries. Describes what broken feels like versus what good feels like. Explicit negative limits (what to avoid). STRICTLY ZERO code syntax, variable names, or CLI flags.]

## Deliverables
[Concrete engineering artifacts shipped: modified API routes, UI components, database schema migrations, test suites, and the clickable HTTPS GitHub PR link placeholder.]

## What does completed look like?
[Observable customer/user behavior and external system outcomes. Checkable conditions from the outside (system states, HTTP response codes, DB records, UI transitions). NEVER 'tests pass' or tautological checkmarks like 'done when finished'.]

## Validation steps for reviewers
[Exact executable shell commands, test suites, or reproduction scripts an independent agent can run cold to prove the change, e.g. bun test or executable bash.]

## Environment limits & User Validation needs
[Explicitly names missing test accounts, payment keys, live hardware configs, or staging secrets that cannot be exercised in the autonomous test harness. If none, state explicitly: "None: 100% pre-merge testable."]

Rules:
1. "One What Per Ticket": address exactly one primary outcome in Question 1.
2. Completed look: must NEVER say 'tests pass', 'done when tests pass', or 'all tests pass'. It must be observable system behavior or external state.
3. Feel section: ZERO code syntax, variable names, or CLI flags.
4. Interview questions: if the intent does not provide enough clarity for all sections (for example, missing feel limits, environment constraints, or observable verification), produce up to 3 targeted, specific interview questions in interview_questions. If the intent is sufficiently detailed, interview_questions must be an empty array [].
5. Project: suggest one project from: "Command Center", "Creatordex", "Japan Trip 2026", "Saddle", "Personal / Ops". Default to "Command Center" if unclear.

Respond ONLY with a JSON object in the following format (no other text outside JSON):
{
  "title": "<Concise issue title, under 80 characters>",
  "project": "<Suggested project name>",
  "interview_questions": [
    "<At most 3 targeted clarifying questions only for sections that could not be filled with confidence from intent>"
  ],
  "spec": "<The complete markdown specification answering all 7 questions in exact order>"
}`;

export type ParsedArgs = {
  noInterview: boolean;
  project?: string;
  title?: string;
  rawIntent: string;
};

export function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (char === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (/\s/.test(char) && !inDouble && !inSingle) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

export function parseCommandArgs(input: string): ParsedArgs {
  const parts = tokenizeArgs(input);
  let noInterview = false;
  let project: string | undefined;
  let title: string | undefined;
  const intentWords: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "--no-interview") {
      noInterview = true;
    } else if (part === "--project" && i + 1 < parts.length) {
      project = parts[++i];
    } else if (part.startsWith("--project=")) {
      project = part.slice("--project=".length);
    } else if (part === "--title" && i + 1 < parts.length) {
      title = parts[++i];
    } else if (part.startsWith("--title=")) {
      title = part.slice("--title=".length);
    } else {
      intentWords.push(part);
    }
  }

  return {
    noInterview,
    project,
    title,
    rawIntent: intentWords.join(" ").trim(),
  };
}

export function parseDraftResponse(raw: string, defaultIntent: string): DraftSpecResult {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    const firstNewline = cleaned.indexOf("\n");
    const lastBackticks = cleaned.lastIndexOf("```");
    if (firstNewline !== -1 && lastBackticks > firstNewline) {
      cleaned = cleaned.slice(firstNewline + 1, lastBackticks).trim();
    }
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") {
      const title =
        typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title.trim()
          : defaultIntent.slice(0, 70);
      const project =
        typeof parsed.project === "string" && parsed.project.trim()
          ? parsed.project.trim()
          : DEFAULT_PROJECT;
      const interview_questions = Array.isArray(parsed.interview_questions)
        ? parsed.interview_questions.filter((q: unknown) => typeof q === "string" && q.trim()).slice(0, 3)
        : [];
      const spec = typeof parsed.spec === "string" && parsed.spec.trim() ? parsed.spec.trim() : "";
      if (spec) {
        return { title, project, interview_questions, spec };
      }
    }
  } catch {
    // Strict JSON parse failed; try regex-based field extraction
  }

  // Fallback field extraction
  let title = defaultIntent.slice(0, 70);
  const titleMatch = raw.match(/"title"\s*:\s*"([^"]+)"/) || raw.match(/^#+\s*(?:Title:\s*)?([^\n]+)/m);
  if (titleMatch) title = titleMatch[1].trim();

  let project = DEFAULT_PROJECT;
  const projectMatch = raw.match(/"project"\s*:\s*"([^"]+)"/);
  if (projectMatch) project = projectMatch[1].trim();

  const interview_questions: string[] = [];
  const iqMatch = raw.match(/"interview_questions"\s*:\s*\[([\s\S]*?)\]/);
  if (iqMatch) {
    const qMatches = iqMatch[1].matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g);
    for (const qm of qMatches) {
      if (qm[1].trim()) interview_questions.push(qm[1].replace(/\\"/g, '"').trim());
    }
  }

  let spec = "";
  const specPropMatch = raw.match(/"spec"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"|\s*\})/);
  if (specPropMatch) {
    spec = specPropMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
  }

  if (!spec) {
    if (raw.trim().startsWith("{") || raw.includes('"spec"')) {
      const headingIndex = raw.indexOf("## What problem are you trying to solve?");
      if (headingIndex !== -1) {
        let candidate = raw.slice(headingIndex);
        candidate = candidate.replace(/"\s*\}?\s*$/, "").trim();
        candidate = candidate.replace(/\\n/g, "\n").replace(/\\"/g, '"');
        spec = candidate;
      }
    }
  }

  if (!spec) {
    spec = raw;
  }

  return {
    title,
    project,
    interview_questions: interview_questions.slice(0, 3),
    spec,
  };
}

export function checkStructuralRules(spec: string): { valid: boolean; deficiencies: string[] } {
  const deficiencies: string[] = [];

  for (const { heading } of CANONICAL_SECTIONS) {
    if (!spec.includes(heading)) {
      deficiencies.push(`Missing canonical section: ${heading}`);
    }
  }

  const completedLookMatch = spec.match(/## What does completed look like\?\s*\n([\s\S]*?)(?=(?:\n## )|$)/);
  if (completedLookMatch) {
    const content = completedLookMatch[1].trim().toLowerCase();
    const tautologicalPatterns = [
      /\btests pass\b/,
      /\bdone when tests pass\b/,
      /\ball tests pass\b/,
      /\btest passes\b/,
      /\bdone when finished\b/,
      /\bdone when the work is finished\b/,
      /\beverything works\b/,
    ];
    for (const pat of tautologicalPatterns) {
      if (pat.test(content)) {
        deficiencies.push(
          `Completed look contains unobservable tautology ('${content}'). Rejects 'tests pass'. Must specify observable system behavior or external state.`,
        );
        break;
      }
    }
    if (content.length === 0) {
      deficiencies.push("Section '## What does completed look like?' is empty.");
    }
  }

  const envLimitsMatch = spec.match(/## Environment limits & User Validation needs\s*\n([\s\S]*?)(?=(?:\n## )|$)/);
  if (envLimitsMatch) {
    const content = envLimitsMatch[1].trim();
    if (content.length === 0) {
      deficiencies.push(
        "Section '## Environment limits & User Validation needs' is empty. Must state 'None: 100% pre-merge testable.' or name dependencies.",
      );
    }
  }

  return {
    valid: deficiencies.length === 0,
    deficiencies,
  };
}

export const defaultEvaluatorRunner: EvaluatorRunner = async (specMarkdown: string): Promise<EvaluatorResult> => {
  const vddPackagesPath = process.env.VDD_PACKAGES_PATH ?? "/Users/emo/dev/vdd/packages/tickets";

  return new Promise<EvaluatorResult>((resolve) => {
    const pythonCode =
      "import sys, json; from evaluator import evaluate_ticket_spec; res = evaluate_ticket_spec(sys.stdin.read(), force_offline=True); print(json.dumps(res.to_dict()))";

    const proc = spawn("python3", ["-c", pythonCode], {
      env: {
        ...process.env,
        PYTHONPATH: `${vddPackagesPath}:${process.env.PYTHONPATH ?? ""}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", () => {
      try {
        const parsed = JSON.parse(stdout.trim() || stderr.trim());
        resolve({
          status: parsed.status ?? "SPECIFIED",
          score: typeof parsed.score === "number" ? parsed.score : 1.0,
          one_what: Boolean(parsed.one_what),
          deficiencies: Array.isArray(parsed.deficiencies) ? parsed.deficiencies : [],
          recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
          sections_present: parsed.sections_present ?? {},
        });
      } catch (err) {
        resolve({
          status: "UNDERSPECIFIED",
          score: 0,
          one_what: false,
          deficiencies: [`Evaluator execution error: ${String(err)} (stderr: ${stderr.trim()})`],
          recommendations: ["Ensure python3 and evaluator.py are accessible."],
          sections_present: {},
        });
      }
    });

    proc.stdin.write(specMarkdown);
    proc.stdin.end();
  });
};

export const defaultLinearRunner: LinearRunner = async (args: string[]): Promise<LinearRunnerResult> => {
  return new Promise<LinearRunnerResult>((resolve) => {
    const proc = spawn("linear", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 0,
      });
    });

    proc.on("error", (err) => {
      resolve({
        stdout: stdout.trim(),
        stderr: `${stderr}\n${err.message}`.trim(),
        exitCode: 1,
      });
    });
  });
};

export async function callModel(
  ctx: RuntimeContext,
  systemPrompt: string,
  userPrompt: string,
  modelCallerOverride?: ModelCaller,
): Promise<string> {
  if (modelCallerOverride) {
    return modelCallerOverride(systemPrompt, userPrompt);
  }

  const registry = ctx.modelRegistry;
  const currentModel = ctx.model;

  if (typeof registry?.complete === "function") {
    const resolvedModel = currentModel
      ? (registry.find?.(currentModel.provider ?? "", currentModel.id ?? "") ?? currentModel)
      : currentModel;
    const response = await registry.complete(resolvedModel, {
      systemPrompt,
      messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
    });
    return textOfMessage(response);
  }

  if (currentModel) {
    try {
      const piAi = (await import("@oh-my-pi/pi-ai")) as {
        completeSimple?: (model: unknown, context: unknown, options?: unknown) => Promise<unknown>;
        complete?: (model: unknown, context: unknown, options?: unknown) => Promise<unknown>;
      };
      const completeFn = piAi.completeSimple ?? piAi.complete;
      if (typeof completeFn === "function") {
        const apiKey = registry?.getApiKey ? await registry.getApiKey(currentModel) : undefined;
        const response = await completeFn(
          currentModel,
          {
            systemPrompt,
            messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
          },
          apiKey ? { apiKey } : undefined,
        );
        return textOfMessage(response);
      }
    } catch {
      // Fall through
    }
  }

  throw new Error("No model completion provider available in the current runtime context.");
}

function textOfMessage(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const msg = message as Record<string, unknown>;
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    const parts: string[] = [];
    for (const part of msg.content) {
      if (part && typeof part === "object") {
        const item = part as Record<string, unknown>;
        if (item.type === "text" && typeof item.text === "string") {
          parts.push(item.text);
        } else if (typeof item.text === "string") {
          parts.push(item.text);
        }
      }
    }
    return parts.join("\n");
  }
  return "";
}

export function notify(ctx: RuntimeContext, message: string, level: "info" | "warning" | "error" = "info"): void {
  try {
    ctx.ui?.notify?.(message, level);
  } catch {
    // Silently continue if UI notify is unavailable
  }
}

export async function runLinearCapture(
  argsStr: string,
  ctx: RuntimeContext,
  host?: RuntimeHost,
  options: LinearCaptureOptions = {},
): Promise<{ success: boolean; url?: string; error?: string }> {
  const linearRunner = options.linearRunner ?? defaultLinearRunner;
  const evaluatorRunner = options.evaluatorRunner ?? defaultEvaluatorRunner;

  const parsed = parseCommandArgs(argsStr);

  let rawIntent = parsed.rawIntent;
  if (!rawIntent) {
    if (ctx.ui?.input) {
      const prompted = await ctx.ui.input("Enter issue intent or problem description:");
      if (!prompted || !prompted.trim()) {
        notify(ctx, "Linear capture aborted: no intent provided.", "warning");
        return { success: false, error: "no intent provided" };
      }
      rawIntent = prompted.trim();
    } else {
      notify(ctx, "Usage: /linear [--no-interview] [--project <name>] [--title <title>] <raw intent>", "warning");
      return { success: false, error: "missing raw intent" };
    }
  }

  notify(ctx, "Drafting 7-question spec with current model...", "info");

  let draft: DraftSpecResult;
  try {
    const userPrompt = `Raw Issue Intent: ${rawIntent}
${parsed.project ? `Target Project: ${parsed.project}` : ""}
${parsed.title ? `Target Title: ${parsed.title}` : ""}`;

    const modelResponse = await callModel(ctx, DRAFT_SYSTEM_PROMPT, userPrompt, options.modelCaller);
    draft = parseDraftResponse(modelResponse, rawIntent);
    if (parsed.title) draft.title = parsed.title;
    if (parsed.project) draft.project = parsed.project;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    notify(ctx, `Failed to draft specification: ${errMsg}`, "error");
    return { success: false, error: errMsg };
  }

  // Optional Interview Loop (at most 3 targeted questions)
  if (!parsed.noInterview && draft.interview_questions.length > 0) {
    const questionsToAsk = draft.interview_questions.slice(0, 3);
    const answers: Array<{ question: string; answer: string }> = [];

    for (const question of questionsToAsk) {
      if (ctx.ui?.input) {
        const answer = await ctx.ui.input(`[Interview] ${question}`);
        if (answer && answer.trim()) {
          answers.push({ question, answer: answer.trim() });
        }
      } else if (host?.sendUserMessage) {
        host.sendUserMessage(`[Linear Capture Question] ${question}`, { deliverAs: "followUp" });
      }
    }

    if (answers.length > 0) {
      notify(ctx, "Incorporating interview answers into specification...", "info");
      const refinementPrompt = `Original Intent: ${rawIntent}
Current Draft Title: ${draft.title}
Current Draft Spec:
${draft.spec}

Operator Answers to Clarifying Questions:
${answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n")}

Update the 7-question specification incorporating all answers. Keep interview_questions as [] since clarification is complete.`;

      try {
        const updatedResponse = await callModel(ctx, DRAFT_SYSTEM_PROMPT, refinementPrompt, options.modelCaller);
        const updatedDraft = parseDraftResponse(updatedResponse, rawIntent);
        draft.spec = updatedDraft.spec;
        if (updatedDraft.title && !parsed.title) draft.title = updatedDraft.title;
        if (updatedDraft.project && !parsed.project) draft.project = updatedDraft.project;
      } catch (err) {
        notify(ctx, `Warning: could not refine spec with answers: ${String(err)}`, "warning");
      }
    }
  }

  // Structural check before posting
  let structuralCheck = checkStructuralRules(draft.spec);
  let evalResult = await evaluatorRunner(draft.spec);

  let combinedDeficiencies = [
    ...structuralCheck.deficiencies,
    ...evalResult.deficiencies.filter((d) => !structuralCheck.deficiencies.includes(d)),
  ];

  if (combinedDeficiencies.length > 0) {
    notify(ctx, `Spec has ${combinedDeficiencies.length} structural deficiency(ies).`, "warning");
    const deficiencySummary = combinedDeficiencies.map((d) => `- ${d}`).join("\n");

    if (ctx.ui?.confirm) {
      const fixOrPost = await ctx.ui.confirm(
        "Structural Deficiencies Detected",
        `The drafted specification has deficiencies:\n${deficiencySummary}\n\nPost anyway? (Select Cancel to abort or edit)`,
      );
      if (!fixOrPost) {
        if (ctx.ui?.editor) {
          const edited = await ctx.ui.editor("Edit Specification", draft.spec);
          if (edited && edited.trim()) {
            draft.spec = edited.trim();
            structuralCheck = checkStructuralRules(draft.spec);
            evalResult = await evaluatorRunner(draft.spec);
            combinedDeficiencies = [
              ...structuralCheck.deficiencies,
              ...evalResult.deficiencies.filter((d) => !structuralCheck.deficiencies.includes(d)),
            ];
          } else {
            notify(ctx, "Linear capture aborted by user.", "info");
            return { success: false, error: "aborted by user" };
          }
        } else {
          notify(ctx, "Linear capture aborted by user due to structural deficiencies.", "info");
          return { success: false, error: "aborted due to deficiencies" };
        }
      }
    }
  }

  // Project resolution
  let chosenProject = draft.project || options.defaultProject || DEFAULT_PROJECT;
  if (!parsed.project && ctx.ui?.select) {
    const selected = await ctx.ui.select(`Confirm Linear Project (suggested: ${chosenProject})`, [
      chosenProject,
      ...KNOWN_PROJECTS.filter((p) => p !== chosenProject),
    ]);
    if (selected) {
      chosenProject = selected;
    }
  }

  // Mandatory User Confirmation Before Posting
  if (ctx.ui?.confirm) {
    const preview = `Title: ${draft.title}
Project: ${chosenProject}
Team: EMO

Specification Preview:
${draft.spec.slice(0, 500)}...

Post this issue to Linear?`;

    const confirmed = await ctx.ui.confirm("Confirm Linear Issue Creation", preview);
    if (!confirmed) {
      notify(ctx, "Linear issue creation cancelled by user.", "info");
      return { success: false, error: "cancelled by user" };
    }
  }

  // Write spec to a temporary file and invoke linear CLI
  const tempDir = await mkdtemp(join(tmpdir(), "linear-capture-"));
  const tempFile = join(tempDir, "spec.md");
  try {
    await writeFile(tempFile, draft.spec, "utf-8");

    const cliArgs = [
      "issue",
      "create",
      "--team",
      "EMO",
      "--project",
      chosenProject,
      "--title",
      draft.title,
      "--description-file",
      tempFile,
      "--no-interactive",
    ];

    notify(ctx, `Posting issue "${draft.title}" to Linear project "${chosenProject}"...`, "info");
    const result = await linearRunner(cliArgs);

    if (result.exitCode !== 0) {
      const errMsg = `Linear CLI failed (exit code ${result.exitCode}): ${result.stderr || result.stdout}`;
      notify(ctx, errMsg, "error");
      return { success: false, error: errMsg };
    }

    const output = `${result.stdout}\n${result.stderr}`;
    const urlMatch = output.match(/https:\/\/linear\.app\/[^\s]+/);
    const issueUrl = urlMatch ? urlMatch[0] : undefined;

    if (issueUrl) {
      notify(ctx, `Created Linear issue: ${issueUrl}`, "info");
      return { success: true, url: issueUrl };
    }

    notify(ctx, `Created Linear issue:\n${result.stdout}`, "info");
    return { success: true, url: result.stdout };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function installLinearCapture(hostValue: unknown, options: LinearCaptureOptions = {}): void {
  const host = hostValue as RuntimeHost;
  if (!host || typeof host.registerCommand !== "function") {
    return;
  }

  host.registerCommand("linear", {
    description: "Capture an issue with canonical 7-question VDD spec, optional interview, and Linear posting",
    handler: async (args: string, ctx: RuntimeContext) => {
      await runLinearCapture(args, ctx, host, options);
    },
  });
}
