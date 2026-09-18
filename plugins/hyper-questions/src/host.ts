import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  computeFingerprint,
  DEFAULT_STATE_FILE,
  formatAnswersSummary,
  readState,
  removeState,
  STATE_VERSION,
  writeStateAtomic,
} from "./state.ts";
import { QuestionnaireComponent, type ThemeLike, type TuiLike } from "./tui.ts";
import type {
  Answer,
  HyperQuestionsParams,
  HyperQuestionsResult,
  Question,
  QuestionnaireState,
} from "./types.ts";

export type RuntimeContext = {
  cwd?: string;
  mode?: "tui" | "rpc" | "json" | "print";
  hasUI?: boolean;
  signal?: AbortSignal;
  ui?: {
    custom?: <T>(
      factory: (tui: TuiLike, theme: ThemeLike, keybindings: unknown, done: (result: T) => void) => unknown,
      options?: unknown,
    ) => Promise<T>;
    select?: (title: string, options: string[]) => Promise<string | undefined>;
    confirm?: (title: string, message: string) => Promise<boolean>;
    input?: (prompt: string, placeholder?: string) => Promise<string | undefined>;
    notify?: (message: string, level?: "info" | "warning" | "error") => void;
  };
};

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: HyperQuestionsResult;
};

export type RegisteredToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: RuntimeContext,
  ) => Promise<ToolResult>;
};

export type RegisteredCommandDefinition = {
  description?: string;
  handler: (args: string, ctx: RuntimeContext) => Promise<void> | void;
};

export type RuntimeHost = {
  registerTool?: (definition: RegisteredToolDefinition) => void;
  registerCommand?: (name: string, options: RegisteredCommandDefinition) => void;
};

export const HYPER_ASK_PARAMETERS_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Optional title for this questionnaire or interview session",
    },
    questions: {
      type: "array",
      description: "List of questions to ask the user",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Unique identifier for this question" },
          prompt: { type: "string", description: "The question or prompt to display" },
          header: { type: "string", description: "Short category or step label (e.g. Scope, Database)" },
          type: {
            type: "string",
            enum: ["select", "confirm", "input", "editor"],
            description: "Question input type (defaults to select if options exist, else input)",
          },
          options: {
            type: "array",
            description: "Choices available for select questions",
            items: {
              type: "object",
              properties: {
                value: { type: "string", description: "Value returned when selected" },
                label: { type: "string", description: "Display label" },
                description: { type: "string", description: "Optional explanation below label" },
                preview: { type: "string", description: "Optional rich preview content" },
              },
              required: ["label"],
            },
          },
          allowOther: {
            type: "boolean",
            description: "Allow user to type a custom answer (default true for select)",
          },
          multi: {
            type: "boolean",
            description: "Allow multiple selections for select questions",
          },
          recommended: {
            description: "Default or recommended option index or value",
          },
          placeholder: {
            type: "string",
            description: "Placeholder text for input questions",
          },
        },
        required: ["id", "prompt"],
      },
    },
    stateFile: {
      type: "string",
      description: "Path to save and resume progress (defaults to .hyper-questions-state.json)",
    },
    resume: {
      type: "boolean",
      description: "Whether to resume previous answers if state file exists (default true)",
    },
    outputFile: {
      type: "string",
      description: "Optional file path to write final answers to upon completion",
    },
    allowBacktrack: {
      type: "boolean",
      description: "Allow user to press 'b' or Backspace to revisit previous questions (default true)",
    },
  },
  required: ["questions"],
};

export class HyperQuestionsRunner {
  public async execute(
    params: HyperQuestionsParams,
    ctx: RuntimeContext,
  ): Promise<ToolResult> {
    const questions = params.questions ?? [];
    if (questions.length === 0) {
      return {
        content: [{ type: "text", text: "Error: questions array must not be empty" }],
      };
    }

    const stateFile = params.stateFile ? resolve(params.stateFile) : resolve(DEFAULT_STATE_FILE);
    const fingerprint = computeFingerprint(questions);

    let state: QuestionnaireState = {
      version: STATE_VERSION,
      fingerprint,
      title: params.title,
      stateFile,
      answers: {},
      completed: false,
      updatedAt: new Date().toISOString(),
    };

    // Attempt to resume from existing state
    if (params.resume !== false) {
      const existing = await readState(stateFile, fingerprint);
      if (existing) {
        state = existing;
      }
    }

    // Check UI mode
    const isTui = ctx.mode === "tui" || ctx.mode === undefined;
    const hasCustomUI = typeof ctx.ui?.custom === "function";

    if (isTui && hasCustomUI && ctx.ui?.custom) {
      // Run custom TUI component
      const tuiResult = await ctx.ui.custom<{ completed: boolean; paused: boolean }>(
        (tui, theme, _kb, done) => {
          return new QuestionnaireComponent({
            title: params.title,
            questions,
            initialAnswers: state.answers,
            stateFile,
            allowBacktrack: params.allowBacktrack !== false,
            theme,
            tui,
            onAnswer: async (qId, ans) => {
              state.answers[qId] = ans;
              state.updatedAt = new Date().toISOString();
              await writeStateAtomic(stateFile, state);
            },
            onDone: (completed, paused) => {
              done({ completed, paused });
            },
          });
        },
      );

      state.completed = tuiResult.completed;
      state.updatedAt = new Date().toISOString();
      await writeStateAtomic(stateFile, state);

      return this.buildResult(params, state, tuiResult.paused);
    }

    // Sequential fallback for environments with standard UI prompts
    if (ctx.ui && (ctx.ui.select || ctx.ui.input || ctx.ui.confirm)) {
      let paused = false;
      for (const q of questions) {
        if (state.answers[q.id]) continue; // already answered

        const type = q.type ?? (q.options && q.options.length > 0 ? "select" : "input");
        let ans: Answer | undefined;

        if (type === "confirm" && ctx.ui.confirm) {
          const val = await ctx.ui.confirm(q.prompt, "Confirm:");
          ans = {
            id: q.id,
            value: val,
            label: val ? "Yes" : "No",
            answeredAt: new Date().toISOString(),
          };
        } else if (type === "select" && ctx.ui.select && q.options) {
          const labels = q.options.map((o) => o.label);
          if (q.allowOther !== false) labels.push("Other (type your own)");

          const chosen = await ctx.ui.select(q.prompt, labels);
          if (chosen === undefined) {
            paused = true;
            break;
          }

          if (chosen === "Other (type your own)" && ctx.ui.input) {
            const customText = await ctx.ui.input("Enter your custom answer:");
            ans = {
              id: q.id,
              value: customText ?? "",
              label: customText ?? "",
              custom: true,
              answeredAt: new Date().toISOString(),
            };
          } else {
            const opt = q.options.find((o) => o.label === chosen);
            ans = {
              id: q.id,
              value: opt?.value ?? chosen,
              label: chosen,
              answeredAt: new Date().toISOString(),
            };
          }
        } else if (ctx.ui.input) {
          const val = await ctx.ui.input(q.prompt, q.placeholder);
          if (val === undefined) {
            paused = true;
            break;
          }
          ans = {
            id: q.id,
            value: val,
            label: val,
            answeredAt: new Date().toISOString(),
          };
        }

        if (ans) {
          state.answers[q.id] = ans;
          state.updatedAt = new Date().toISOString();
          await writeStateAtomic(stateFile, state);
        } else {
          paused = true;
          break;
        }
      }

      state.completed = Object.keys(state.answers).length === questions.length;
      await writeStateAtomic(stateFile, state);
      return this.buildResult(params, state, paused);
    }

    // Headless / non-interactive execution error
    return {
      content: [
        {
          type: "text",
          text: `Interactive questionnaire requires an active TUI or UI prompts. Current mode: ${ctx.mode ?? "unknown"}. Progress saved to ${stateFile}.`,
        },
      ],
      details: {
        title: params.title,
        completed: false,
        paused: true,
        cancelled: false,
        answers: state.answers,
        orderedAnswers: [],
        stateFile,
      },
    };
  }

  private async buildResult(
    params: HyperQuestionsParams,
    state: QuestionnaireState,
    paused: boolean,
  ): Promise<ToolResult> {
    const summary = formatAnswersSummary(
      params.title,
      params.questions,
      state.answers,
      state.completed,
      state.stateFile,
    );

    // If an output file is specified and we finished, write it
    if (params.outputFile && state.completed) {
      try {
        await writeFile(resolve(params.outputFile), summary.markdown, "utf8");
      } catch {
        // best effort write
      }
    }

    const details: HyperQuestionsResult = {
      title: params.title,
      completed: state.completed,
      paused,
      cancelled: !state.completed && !paused,
      answers: state.answers,
      orderedAnswers: summary.orderedAnswers,
      stateFile: state.stateFile,
      outputFile: params.outputFile ? resolve(params.outputFile) : undefined,
    };

    return {
      content: [{ type: "text", text: summary.markdown }],
      details,
    };
  }
}

/**
 * Installs the hyper_ask tool and optional helper commands onto the host.
 */
export function installHyperQuestions(host: RuntimeHost): void {
  if (typeof host?.registerTool !== "function") {
    throw new Error("hyper-questions requires host.registerTool");
  }

  const runner = new HyperQuestionsRunner();

  host.registerTool({
    name: "hyper_ask",
    label: "Ask Questions (Interactive & Resumable)",
    description:
      "Ask the user sequential or batched questions with instant progress saving, pause/resume support, and backtracking. Use for requirements gathering, user interviews, decision forms, and surveys.",
    parameters: HYPER_ASK_PARAMETERS_SCHEMA,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      return runner.execute(params as HyperQuestionsParams, ctx);
    },
  });

  if (typeof host.registerCommand === "function") {
    host.registerCommand("hyper-questions", {
      description: "Manage hyper-questions state (status / reset)",
      handler: async (args, ctx) => {
        const command = args.trim().toLowerCase();
        const stateFile = resolve(DEFAULT_STATE_FILE);

        if (command === "reset") {
          await removeState(stateFile);
          ctx.ui?.notify?.("Questionnaire state reset", "info");
          return;
        }

        const state = await readState(stateFile);
        if (!state) {
          ctx.ui?.notify?.("No active saved questionnaire state found", "info");
          return;
        }

        const count = Object.keys(state.answers).length;
        ctx.ui?.notify?.(
          `Questionnaire "${state.title ?? "untitled"}": ${count} answered (completed: ${state.completed})`,
          "info",
        );
      },
    });
  }
}
