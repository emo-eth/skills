import { isRecord } from "../shared/guards.ts";

export type CompanionStatus = "idle" | "working" | "blocked" | "done";

export type CompanionContext = {
  sessionId?: string;
  isIdle?: () => boolean;
  ui?: {
    notify?: (message: string, level?: string) => void;
    setStatus?: (key: string, value: string | undefined) => void;
  };
  sessionManager?: { getSessionId?: () => string | undefined };
};

export type CompanionHost = {
  on?: (event: string, handler: (event: unknown, context: CompanionContext) => unknown) => void;
  registerCommand?: (
    name: string,
    options: {
      description?: string;
      handler: (args: string, context: CompanionContext) => unknown;
    },
  ) => void;
  appendEntry?: (type: string, data?: unknown) => void;
  setStatus?: (key: string, value: string | undefined) => void;
  ui?: { notify?: (message: string, level?: string) => void };
};

const HELP_MESSAGE = "focus-order status <working|idle|blocked|done>; focus-order clear";

const STATUS_MESSAGES: Record<CompanionStatus, string> = {
  idle: "focus-order status: idle",
  working: "focus-order status: working",
  blocked: "focus-order status: blocked",
  done: "focus-order status: done",
};

export function installFocusOrderCompanion(
  host: CompanionHost,
  source: "Pi" | "OMP",
): void {
  if (typeof host.registerCommand !== "function") {
    throw new Error(`Focus Order requires ${source}'s registerCommand hook`);
  }

  const resolveSessionId = (context: CompanionContext): string | undefined =>
    context.sessionId ?? context.sessionManager?.getSessionId?.();
  const notify = (context: CompanionContext): ((message: string, level?: string) => void) | undefined =>
    context.ui?.notify ?? host.ui?.notify;
  const setStatus = (context: CompanionContext): ((key: string, value: string | undefined) => void) | undefined =>
    context.ui?.setStatus ?? host.setStatus;
  const report = (status: CompanionStatus, context: CompanionContext): string => {
    const value = `${source.toLowerCase()}:${status}`;
    setStatus(context)?.("focus-order", value);
    host.appendEntry?.("focus-order-status", {
      source: source.toLowerCase(),
      status,
      session_id: resolveSessionId(context),
    });
    return `focus-order status: ${status}`;
  };

  host.registerCommand("focus-order", {
    description: "Report this agent's focus-order waiting state",
    handler: (args, context) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const requested = tokens[0] === "status" ? tokens[1] : tokens[0];
      if (!requested || requested === "help") {
        const help = HELP_MESSAGE;
        notify(context)?.(help, "info");
        return help;
      }
      if (requested === "clear") return report("working", context);
      if (!isCompanionStatus(requested)) {
        throw new Error("focus-order status must be working, idle, blocked, or done");
      }
      const message = report(requested, context);
      notify(context)?.(STATUS_MESSAGES[requested], requested === "working" ? "info" : "warning");
      return message;
    },
  });


  host.on?.("before_agent_start", (_event, context) => report("working", context));
  host.on?.("agent_end", (event, context) => {
    const willContinue = isRecord(event) && event.willContinue === true;
    return report(willContinue ? "working" : "done", context);
  });
}

function isCompanionStatus(value: string): value is CompanionStatus {
  return value === "idle"
    || value === "working"
    || value === "blocked"
    || value === "done";
}

