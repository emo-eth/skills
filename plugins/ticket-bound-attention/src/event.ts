import type { CaptureInput } from "./capture.ts";

const CAPTURE_EVENTS = new Set(["worktree.created", "worktree.opened"]);

export function isCaptureEvent(eventName: string | undefined): boolean {
  return eventName !== undefined && CAPTURE_EVENTS.has(eventName);
}

export function captureInputFromEnv(env: NodeJS.ProcessEnv): CaptureInput | undefined {
  const eventName = env.HERDR_PLUGIN_EVENT;
  if (eventName && !isCaptureEvent(eventName)) return undefined;
  const fromEvent = parseObject(env.HERDR_PLUGIN_EVENT_JSON);
  const fromContext = parseObject(env.HERDR_PLUGIN_CONTEXT_JSON);
  const data = asRecord(fromEvent?.data) ?? fromEvent;
  const workspace = asRecord(data?.workspace) ?? asRecord(fromContext);
  const worktree = asRecord(data?.worktree)
    ?? asRecord(workspace?.worktree)
    ?? asRecord(fromContext?.worktree);
  const workspaceId = stringValue(workspace?.workspace_id)
    ?? stringValue(worktree?.open_workspace_id)
    ?? stringValue(fromContext?.workspace_id)
    ?? stringValue(env.HERDR_WORKSPACE_ID);
  const path = stringValue(worktree?.path)
    ?? stringValue(worktree?.checkout_path)
    ?? stringValue(fromContext?.workspace_cwd);
  const name = stringValue(workspace?.label)
    ?? stringValue(worktree?.label)
    ?? stringValue(fromContext?.workspace_label);
  if (!workspaceId && !path) return undefined;
  return {
    ...(workspaceId ? { workspaceId } : {}),
    ...(path ? { path } : {}),
    ...(name ? { name } : {}),
    env,
  };
}

function parseObject(text: string | undefined): Record<string, unknown> | undefined {
  if (!text?.trim()) return undefined;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
