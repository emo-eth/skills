import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type YearnHost = "omp" | "pi";

export type YearnRecord = {
  schema: "yearn.v1";
  id: string;
  recordedAt: string;
  wish: string;
  host: YearnHost;
  cwd: string;
  sessionId?: string;
  sessionName?: string;
  model?: string;
};

export type ExtensionContext = {
  cwd?: unknown;
  model?: unknown;
  sessionManager?: {
    getSessionId?: () => unknown;
    getSessionName?: () => unknown;
  };
  ui?: {
    notify?: (message: string, level?: string) => void;
  };
};

export type ExtensionApi = {
  registerCommand: (
    name: string,
    options: {
      description: string;
      handler: (args: string, ctx: ExtensionContext) => Promise<void>;
    },
  ) => void;
};

const LOG_PATH_ENV = "YEARNINGS_PATH";
const DEFAULT_LOG_PATH = join(homedir(), ".yearn", "yearnings.ndjson");

export function yearnLogPath(): string {
  const configuredPath = process.env[LOG_PATH_ENV]?.trim();
  return resolve(configuredPath || DEFAULT_LOG_PATH);
}

export function installYearnExtension(api: ExtensionApi, host: YearnHost): void {
  api.registerCommand("yearn", {
    description: "Record a personal want or wish",
    handler: async (args, ctx) => {
      const wish = typeof args === "string" ? args.trim() : "";
      if (!wish) {
        notify(ctx, "Usage: /yearn <want or wish>", "error");
        return;
      }

      const cwd = stringValue(ctx.cwd) ?? process.cwd();
      const record: YearnRecord = {
        schema: "yearn.v1",
        id: randomUUID(),
        recordedAt: new Date().toISOString(),
        wish,
        host,
        cwd,
        ...sessionMetadata(ctx),
        ...modelMetadata(ctx),
      };

      const path = yearnLogPath();
      try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notify(ctx, `Yearn could not be recorded: ${message}`, "error");
        return;
      }

      notify(ctx, `Yearn recorded in ${path}`, "info");
    },
  });
}

function sessionMetadata(ctx: ExtensionContext): Pick<YearnRecord, "sessionId" | "sessionName"> {
  const sessionId = callSessionMethod(ctx, "getSessionId");
  const sessionName = callSessionMethod(ctx, "getSessionName");
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(sessionName ? { sessionName } : {}),
  };
}

function modelMetadata(ctx: ExtensionContext): Pick<YearnRecord, "model"> {
  const model = ctx.model;
  if (typeof model === "string" && model.trim()) return { model: model.trim() };
  if (model && typeof model === "object" && "id" in model) {
    const id = stringValue(model.id)?.trim();
    if (id) return { model: id };
  }
  return {};
}

function callSessionMethod(ctx: ExtensionContext, method: "getSessionId" | "getSessionName"): string | undefined {
  try {
    const value = ctx.sessionManager?.[method]?.();
    return stringValue(value)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function notify(ctx: ExtensionContext, message: string, level: string): void {
  try {
    ctx.ui?.notify?.(message, level);
  } catch {
    // A failed notification must not turn a successful append into a failed command.
  }
}
