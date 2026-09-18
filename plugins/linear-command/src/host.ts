import {
  classifyLinearIssue,
  collectGitMetadata,
  executeLinearCreate,
  parseCommandArgs,
  priorityLabel,
  type AmbientContext,
  type LinearRunner,
} from "./record.ts";

export type SessionManager = {
  getSessionId?: () => string | undefined;
  getSessionFile?: () => string | undefined;
  getTurn?: () => number | undefined;
};

export type RuntimeContext = {
  cwd?: string;
  sessionId?: string;
  sessionFile?: string;
  turn?: number;
  model?: unknown;
  hasUI?: boolean;
  sessionManager?: SessionManager;
  ui?: {
    notify?: (message: string, level?: string) => void;
    confirm?: (title: string, message: string) => Promise<boolean>;
    input?: (title: string, placeholder?: string) => Promise<string | undefined>;
    select?: (title: string, options: string[]) => Promise<string | undefined>;
  };
};

export type RuntimeHost = {
  on?(event: string, handler: (event: unknown, context: RuntimeContext) => unknown): void;
  registerCommand(
    name: string,
    options: {
      description: string;
      handler: (args: string, context: RuntimeContext) => Promise<void> | void;
    },
  ): void;
};

type SessionState = {
  model?: string;
  turn?: number;
};

export type InstallOptions = {
  runner?: LinearRunner;
};

function modelToString(model: unknown): string | undefined {
  if (typeof model === "string") return model.trim() || undefined;
  if (!model || typeof model !== "object") return undefined;
  const obj = model as Record<string, unknown>;
  const provider = typeof obj.provider === "string" ? obj.provider.trim() : undefined;
  const id = typeof obj.id === "string" ? obj.id.trim() : typeof obj.name === "string" ? obj.name.trim() : undefined;
  if (provider && id) return `${provider}/${id}`;
  return id;
}

function resolveSessionId(context: RuntimeContext): string | undefined {
  if (context.sessionId) return context.sessionId;
  if (context.sessionManager?.getSessionId) {
    const id = context.sessionManager.getSessionId();
    if (id) return id;
  }
  return undefined;
}

function resolveSessionFile(context: RuntimeContext): string | undefined {
  if (context.sessionFile) return context.sessionFile;
  if (context.sessionManager?.getSessionFile) {
    const file = context.sessionManager.getSessionFile();
    if (file) return file;
  }
  return undefined;
}

function resolveTurn(context: RuntimeContext, stateTurn?: number): number | undefined {
  if (typeof context.turn === "number") return context.turn;
  if (context.sessionManager?.getTurn) {
    const turn = context.sessionManager.getTurn();
    if (typeof turn === "number") return turn;
  }
  return stateTurn;
}

export function installLinearCommand(
  host: RuntimeHost,
  agent: string,
  runtime: "omp" | "pi",
  options: InstallOptions = {},
): void {
  const sessionStates = new Map<string, SessionState>();

  const getState = (context: RuntimeContext): SessionState => {
    const key = resolveSessionId(context) || resolveSessionFile(context) || context.cwd || "default";
    let state = sessionStates.get(key);
    if (!state) {
      state = {};
      sessionStates.set(key, state);
    }
    return state;
  };

  if (typeof host.on === "function") {
    const registerEvent = (name: string, handler: (event: unknown, ctx: RuntimeContext) => void) => {
      try {
        host.on?.(name, handler);
      } catch {}
    };

    registerEvent("turn_start", (event, ctx) => {
      const state = getState(ctx);
      if (event && typeof event === "object" && "turn" in event && typeof (event as { turn: unknown }).turn === "number") {
        state.turn = (event as { turn: number }).turn;
      }
    });

    registerEvent("before_agent_start", (event, ctx) => {
      const state = getState(ctx);
      if (ctx.model) {
        state.model = modelToString(ctx.model);
      } else if (event && typeof event === "object" && "model" in event) {
        state.model = modelToString((event as { model: unknown }).model);
      }
    });
  }

  host.registerCommand("linear", {
    description: "Create a Linear issue out-of-band with automatic taxonomy classification",
    handler: async (args: string, context: RuntimeContext) => {
      let rawArgs = typeof args === "string" ? args.trim() : "";
      const isInteractive = context.hasUI !== false && typeof context.ui?.confirm === "function";

      if (!rawArgs) {
        if (context.hasUI !== false && typeof context.ui?.input === "function") {
          const prompted = await context.ui.input("Linear issue", "Describe the issue or enter flags...");
          if (!prompted || !prompted.trim()) {
            context.ui?.notify?.("Linear issue creation cancelled", "info");
            return;
          }
          rawArgs = prompted.trim();
        } else {
          context.ui?.notify?.("Usage: /linear <issue description>", "error");
          return;
        }
      }

      const cwd = context.cwd || process.cwd();
      const state = getState(context);
      const git = await collectGitMetadata(cwd);

      const ambient: AmbientContext = {
        cwd,
        git,
        sessionId: resolveSessionId(context),
        sessionFile: resolveSessionFile(context),
        turn: resolveTurn(context, state.turn),
        model: modelToString(context.model) || state.model,
      };

      const parsed = parseCommandArgs(rawArgs);
      const classified = classifyLinearIssue(parsed, ambient);

      if (isInteractive && context.ui?.confirm) {
        const confirmed = await context.ui.confirm(
          `Create Linear issue: [${classified.type}] ${classified.title}`,
          `Team: ${classified.team}\nProject: ${classified.project ?? "None"}\nPriority: ${priorityLabel(classified.priority)}\nLabels: ${classified.labels.join(", ")}`,
        );
        if (!confirmed) {
          context.ui?.notify?.("Linear issue creation cancelled", "info");
          return;
        }
      }

      try {
        const result = await executeLinearCreate(classified, { cwd, runner: options.runner });
        const idPart = result.id ? `${result.id}: ` : "";
        const urlPart = result.url ? ` (${result.url})` : "";
        context.ui?.notify?.(
          `Created Linear issue ${idPart}${result.title}${urlPart}`,
          "info",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.ui?.notify?.(`Failed to create Linear issue: ${message}`, "error");
      }
    },
  });
}
