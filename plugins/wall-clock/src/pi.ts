import { installHostExtension } from "./host.ts";

export default function wallClockPiExtension(pi: any): void {
  installHostExtension(pi, {
    enforcement: {
      name: "Pi",
      canBlockNew: true,
      abortRunning: async ({ context }) => {
        if (typeof context?.abort !== "function") throw new Error("Pi did not provide an abort signal for the running action");
        await context.abort();
      },
      abortObserved: isObservedAbort,
    },
  });
}

function isObservedAbort(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const value = event as Record<string, unknown>;
  if (value.abortObserved === true || value.aborted === true || value.cancelled === true || value.canceled === true) return true;
  const text = JSON.stringify(value.result ?? value.content ?? value.message ?? "");
  return /\b(abort(?:ed|ing)?|cancel(?:led|ed|ing)?|interrupt(?:ed|ion)?)\b/i.test(text);
}
