export type RuntimeContext = {
  cwd?: string;
  mode?: "tui" | "rpc" | "json" | "print";
  hasUI?: boolean;
  signal?: AbortSignal;
  ui?: {
    input?: (prompt: string, placeholder?: string) => Promise<string | undefined>;
    confirm?: (title: string, message: string) => Promise<boolean>;
    select?: (title: string, options: string[]) => Promise<string | undefined>;
    notify?: (message: string, level?: "info" | "warning" | "error") => void;
    editor?: (title: string, prefill?: string) => Promise<string | undefined>;
  };
  modelRegistry?: {
    find?: (provider: string, modelId: string) => unknown;
    hasConfiguredAuth?: (model: unknown) => boolean;
    complete?: (
      model: unknown,
      context: {
        systemPrompt?: string | string[];
        messages: Array<{ role: string; content: string; timestamp?: number }>;
      },
      options?: unknown,
    ) => Promise<unknown>;
    getApiKey?: (model: unknown) => Promise<string | undefined> | string | undefined;
    resolver?: (model: unknown) => unknown;
  };
  model?: { provider?: string; id?: string };
  sessionManager?: {
    getEntries?: () => unknown[];
    getBranch?: () => unknown[];
  };
};

export type RuntimeHost = {
  registerCommand?: (
    name: string,
    options: {
      description?: string;
      handler: (args: string, ctx: RuntimeContext) => Promise<void> | void;
    },
  ) => void;
  sendUserMessage?: (content: string, options?: { deliverAs?: "steer" | "followUp" }) => void;
};

export type LinearRunnerResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type LinearRunner = (args: string[]) => Promise<LinearRunnerResult>;

export type EvaluatorResult = {
  status: "SPECIFIED" | "UNDERSPECIFIED" | "NEEDS_HUMAN_NUANCE";
  score: number;
  one_what: boolean;
  deficiencies: string[];
  recommendations: string[];
  sections_present: Record<string, boolean>;
};

export type EvaluatorRunner = (specMarkdown: string) => Promise<EvaluatorResult>;

export type ModelCaller = (systemPrompt: string, userPrompt: string) => Promise<string>;

export type DraftSpecResult = {
  title: string;
  project: string;
  interview_questions: string[];
  spec: string;
};

export type LinearCaptureOptions = {
  linearRunner?: LinearRunner;
  evaluatorRunner?: EvaluatorRunner;
  modelCaller?: ModelCaller;
  vddPackagesPath?: string;
  defaultProject?: string;
};
