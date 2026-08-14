export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export type GuardMode = "focus" | "modal";

export type AgentSession = {
  source: string;
  agent: string;
  kind: "id" | "path";
  value: string;
};

export type AgentSnapshot = {
  pane_id: string;
  name?: string;
  agent?: string;
  title?: string;
  terminal_title?: string;
  display_agent?: string;
  agent_status: AgentStatus;
  workspace_id: string;
  workspace_label?: string;
  tab_id: string;
  focused: boolean;
  state_change_seq?: number;
  cwd?: string;
  foreground_cwd?: string;
  worktree_id?: string;
  worktree_path?: string;
  worktree_label?: string;
  agent_session?: AgentSession;
};

export type AgentIdentity =
  | {
      kind: "session";
      source: string;
      agent: string;
      sessionKind: "id" | "path";
      value: string;
    }
  | {
      kind: "pane";
      workspaceId: string;
      paneId: string;
    };

export type WorktreeIdentity = {
  kind: "worktree";
  value: string;
};

export type StoredAgent = {
  identity: AgentIdentity;
  label?: string;
};

export type StoredWorktree = {
  identity: WorktreeIdentity;
  label?: string;
};

export type WranglrState = {
  version: 1;
  enabled: boolean;
  mode: GuardMode;
  ordered_agents: StoredAgent[];
  ordered_worktrees: StoredWorktree[];
  snoozed_agents: StoredAgent[];
};

export type HerdrEvent = {
  event: string;
  data: Record<string, unknown>;
  raw: Record<string, unknown>;
};

const URGENT_STATUS: Record<AgentStatus, boolean> = {
  idle: true,
  working: false,
  blocked: true,
  done: true,
  unknown: false,
};

export function isUrgentStatus(status: AgentStatus): boolean {
  return URGENT_STATUS[status] === true;
}
