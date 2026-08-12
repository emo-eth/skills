export function isObservedNativeAbort(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const value = event as Record<string, unknown>;
  if (hasStructuredAbort(value)) return true;
  if (value.isError !== true) return false;
  const text = JSON.stringify(value.result ?? value.content ?? value.message ?? "");
  return /\[(?:operation|command|tool call|request)?\s*(?:aborted|cancelled|canceled)\]|\b(?:operation|command|tool call|request)\s+(?:was\s+)?(?:aborted|cancelled|canceled)\b/i.test(text);
}

function hasStructuredAbort(value: Record<string, unknown>): boolean {
  if (value.status === "aborted" || value.abortObserved === true || value.aborted === true || value.cancelled === true || value.canceled === true) return true;
  const details = value.details ?? (value.result && typeof value.result === "object" ? (value.result as Record<string, unknown>).details : undefined);
  return Boolean(details && typeof details === "object" && (
    (details as Record<string, unknown>).aborted === true
      || (details as Record<string, unknown>).cancelled === true
      || (details as Record<string, unknown>).canceled === true
  ));
}
