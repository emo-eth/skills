import { isRecord } from "../shared/guards.ts";
import { call } from "./transport.ts";
import type { AgentSnapshot } from "../shared/types.ts";

export type PaneInfo = {
  pane_id: string;
  workspace_id?: string;
  tab_id?: string;
  agent?: string;
  display_agent?: string;
  agent_status?: string;
  title?: string;
  terminal_title?: string;
  cwd?: string;
  foreground_cwd?: string;
  focused?: boolean;
  agent_session?: AgentSnapshot["agent_session"];
  [key: string]: unknown;
};

type WorkspaceInfo = {
  workspace_id: string;
  label?: string;
  worktree?: {
    checkout_path?: string;
    repo_key?: string;
    repo_name?: string;
    repo_root?: string;
  };
};

export async function listAgents(): Promise<AgentSnapshot[]> {
  const [agentResponse, workspaceResponse] = await Promise.allSettled([
    call("agent.list", {}),
    call("workspace.list", {}),
  ]);
  if (agentResponse.status === "rejected") throw agentResponse.reason;
  const agentResult = agentResponse.value;
  const workspaces = workspaceResponse.status === "fulfilled"
    ? workspaceMap(workspaceResponse.value.workspaces)
    : new Map<string, WorkspaceInfo>();
  const candidates = agentResult.agents ?? agentResult.panes;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((value) => {
    const pane = normalizePane(value, workspaces);
    return pane ? [pane] : [];
  });
}

export async function focusAgent(target: string): Promise<void> {
  await call("agent.focus", { target });
}

export async function openPopup(options: {
  entrypoint: "manager" | "attention";
  width: string;
  height: number;
  workspaceId?: string;
}): Promise<void> {
  await call("plugin.pane.open", {
    plugin_id: "wranglr",
    entrypoint: options.entrypoint,
    placement: "popup",
    width: options.width,
    height: options.height,
    workspace_id: options.workspaceId,
    focus: true,
  });
}

export async function closePopup(): Promise<void> {
  await call("popup.close", {});
}


function workspaceMap(value: unknown): Map<string, WorkspaceInfo> {
  if (!Array.isArray(value)) return new Map();
  const workspaces = new Map<string, WorkspaceInfo>();
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const workspaceId = stringValue(candidate.workspace_id ?? candidate.workspaceId);
    if (!workspaceId) continue;
    const worktree = isRecord(candidate.worktree)
      ? {
          checkout_path: stringValue(candidate.worktree.checkout_path),
          repo_key: stringValue(candidate.worktree.repo_key),
          repo_name: stringValue(candidate.worktree.repo_name),
          repo_root: stringValue(candidate.worktree.repo_root),
        }
      : undefined;
    workspaces.set(workspaceId, {
      workspace_id: workspaceId,
      label: stringValue(candidate.label) ?? undefined,
      worktree,
    });
  }
  return workspaces;
}

function normalizePane(
  value: unknown,
  workspaces: Map<string, WorkspaceInfo>,
): AgentSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const paneId = stringValue(value.pane_id ?? value.paneId ?? value.id);
  const workspaceId = stringValue(value.workspace_id ?? value.workspaceId);
  const tabId = stringValue(value.tab_id ?? value.tabId);
  if (!paneId || !workspaceId || !tabId) return undefined;
  const status = stringValue(value.agent_status ?? value.agentStatus ?? value.status) ?? "unknown";
  const agent = stringValue(value.agent);
  const displayAgent = stringValue(value.display_agent ?? value.displayAgent);
  const session = normalizeSession(value.agent_session ?? value.agentSession);
  const worktree = isRecord(value.worktree) ? value.worktree : undefined;
  const workspace = workspaces.get(workspaceId);
  const worktreeId = stringValue(
    value.worktree_id
    ?? value.worktreeId
    ?? worktree?.id
    ?? worktree?.path
    ?? workspace?.worktree?.checkout_path
    ?? workspace?.worktree?.repo_key,
  );
  return {
    pane_id: paneId,
    workspace_id: workspaceId,
    workspace_label: stringValue(value.workspace_label ?? value.workspaceLabel)
      ?? workspace?.label,
    tab_id: tabId,
    agent: agent ?? undefined,
    display_agent: displayAgent ?? undefined,
    title: stringValue(value.title) ?? undefined,
    terminal_title: stringValue(value.terminal_title ?? value.terminalTitle) ?? undefined,
    agent_status: normalizeStatus(status),
    focused: value.focused === true,
    cwd: stringValue(value.cwd) ?? undefined,
    foreground_cwd: stringValue(value.foreground_cwd ?? value.foregroundCwd) ?? undefined,
    worktree_id: worktreeId,
    worktree_path: stringValue(value.worktree_path ?? value.worktreePath ?? worktree?.path)
      ?? workspace?.worktree?.checkout_path,
    worktree_label: stringValue(value.worktree_label ?? value.worktreeLabel ?? worktree?.label)
      ?? workspace?.worktree?.repo_name
      ?? workspace?.label,
    agent_session: session,
  };
}

function normalizeStatus(value: string): AgentSnapshot["agent_status"] {
  if (value === "idle" || value === "working" || value === "blocked" || value === "done") {
    return value;
  }
  return "unknown";
}

function normalizeSession(value: unknown): AgentSnapshot["agent_session"] {
  if (!isRecord(value)) return undefined;
  const source = stringValue(value.source);
  const agent = stringValue(value.agent);
  const kind = value.kind === "id" || value.kind === "path" ? value.kind : undefined;
  const sessionValue = stringValue(value.value);
  if (!source || !agent || !kind || !sessionValue) return undefined;
  return { source, agent, kind, value: sessionValue };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
