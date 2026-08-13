export const TURN_SUMMARY_REMINDER =
  "End this turn with a summary: Did / Needs you / Questions / Next. Omit empty sections. Keep it under 400 words.";

const TURN_SUMMARY_COMMAND = "summary";

type RuntimeContext = {
  ui?: {
    notify?: (message: string, level?: string) => void;
  };
};

type RuntimeHost = {
  on?: (event: string, handler: (event: unknown, context: RuntimeContext) => unknown) => void;
  registerCommand?: (
    name: string,
    options: {
      description?: string;
      handler: (args: string, context: RuntimeContext) => unknown;
    },
  ) => void;
};

export type TurnSummaryController = {
  isEnabled: () => boolean;
};

export function installTurnSummary(hostValue: unknown): TurnSummaryController | undefined {
  const host = asRuntimeHost(hostValue);
  if (!host?.on) return undefined;

  let enabled = true;
  try {
    host.on("context", (event) => {
      if (!enabled) return undefined;
      const messages = isRecord(event) && Array.isArray(event.messages) ? event.messages : [];
      return {
        messages: [
          ...messages,
          {
            role: "user",
            content: [{ type: "text", text: TURN_SUMMARY_REMINDER }],
          },
        ],
      };
    });
  } catch {
    return undefined;
  }

  if (host.registerCommand) {
    try {
      host.registerCommand(TURN_SUMMARY_COMMAND, {
        description: "Enable or disable the end-of-turn summary reminder.",
        handler: (args, context) => {
          const command = args.trim().toLowerCase();
          if (command === "on") {
            enabled = true;
            notify(context, "Turn summary reminder enabled");
            return undefined;
          }
          if (command === "off") {
            enabled = false;
            notify(context, "Turn summary reminder disabled");
            return undefined;
          }
          throw new Error("Usage: /summary on|off");
        },
      });
    } catch {
      // The reminder still works when the optional command seam is unavailable.
    }
  }

  return { isEnabled: () => enabled };
}

function asRuntimeHost(value: unknown): RuntimeHost | undefined {
  if (!isRecord(value) || typeof value.on !== "function") return undefined;
  return {
    on: value.on.bind(value) as RuntimeHost["on"],
    registerCommand: typeof value.registerCommand === "function"
      ? value.registerCommand.bind(value) as RuntimeHost["registerCommand"]
      : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function notify(context: RuntimeContext, message: string): void {
  try {
    context.ui?.notify?.(message, "info");
  } catch {
    // A host notification failure must not disable the reminder command.
  }
}
