import { installHostExtension } from "./host.ts";
import type { RuntimeContext } from "./host.ts";
import { isObservedNativeAbort } from "./native-abort.ts";
import { createStatusPulse } from "./pulse.ts";
import type { ToolProposal } from "./types.ts";

const ABORTABLE_PI_TOOLS = new Set(["bash", "read", "write", "edit", "grep", "find", "ls"]);

export default function wallClockPiExtension(pi: any) {
  return installHostExtension(pi, {
    // OMP does not get this: its footer strips VT escapes from hook status
    // text (sanitizeStatusText), so a color pulse cannot render there.
    statusPulse: createStatusPulse(),
    enforcement: {
      name: "Pi",
      canBlockNew: true,
      canAbortAction: (proposal, context) => canAbort(proposal, context, ABORTABLE_PI_TOOLS),
      abortRunning: abortContexts,
      abortObserved: isObservedNativeAbort,
      canAbortProvider: (context) => typeof context?.abort === "function" && Boolean(context?.signal),
      abortProvider: async ({ context }) => {
        if (typeof context.abort !== "function") throw new Error("Pi lost the abort function for the active provider request");
        await context.abort();
      },
    },
  });
}

function canAbort(proposal: ToolProposal, context: RuntimeContext | undefined, allowedTools: Set<string>): boolean {
  return allowedTools.has(proposal.toolName.toLowerCase()) && typeof context?.abort === "function";
}

async function abortContexts(request: { targets: Array<{ context: RuntimeContext }> }): Promise<void> {
  const contexts = new Set(request.targets.map((target) => target.context));
  for (const context of contexts) {
    if (typeof context.abort !== "function") throw new Error("Pi lost the abort function for an admitted action");
    await context.abort();
  }
}
