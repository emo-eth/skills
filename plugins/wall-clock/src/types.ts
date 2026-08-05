export type Phase = "inactive" | "active" | "wrap-up" | "expired" | "complete";

export type ActionClass = "read" | "write" | "destructive" | "delegate" | "finalize" | "other";

export type AssignmentStatus = "pending" | "active" | "complete" | "partial" | "blocked" | "expired";

export type Clock = {
  now(): number;
};

export type DeadlineInput = {
  deadlineMs?: number;
  durationMs?: number;
  wrapUpMs?: number;
};

export type PlanItem = {
  id: string;
  title: string;
  status: "pending" | "active" | "complete" | "blocked" | "deferred";
};

export type AssignmentInput = {
  id?: string;
  parentPlanItemId: string;
  objective: string;
  scope: string[];
  acceptance: string[];
  budgetMs: number;
  wrapUpMs?: number;
};

export type Assignment = AssignmentInput & {
  id: string;
  parentSessionId: string;
  childSessionId?: string;
  issuedAt: number;
  hardDeadline: number;
  wrapUpAt: number;
  status: AssignmentStatus;
};

export type Shortcut = {
  choice: string;
  tradeoff: string;
};

export type ChildReport = {
  assignmentId: string;
  status: "complete" | "partial" | "blocked" | "expired";
  completed: string[];
  evidence: string[];
  partial: string[];
  skipped: string[];
  validation: string[];
  shortcuts: Shortcut[];
  risks: string[];
  unknowns: string[];
  recommendedParentAction: string;
};

export type SessionState = {
  version: 1;
  sessionId: string;
  issuedAt: number;
  hardDeadline: number;
  wrapUpAt: number;
  plan: PlanItem[];
  assignments: Assignment[];
  reports: ChildReport[];
  revision: number;
  stopped: boolean;
};

export type PersistedState = SessionState;

export type ToolProposal = {
  toolName: string;
  input?: unknown;
  action?: ActionClass;
  estimatedMs?: number;
  assignmentId?: string;
};

export type ToolDecision = {
  allow: boolean;
  phase: Phase;
  remainingMs: number;
  reason?: string;
};

export type Status = {
  sessionId: string;
  active: boolean;
  phase: Phase;
  remainingMs: number;
  deadlineMs?: number;
  wrapUpAt?: number;
  revision?: number;
  assignment?: Assignment;
};

export type StateStore = {
  load(sessionId: string): PersistedState | undefined;
  save(state: PersistedState): void;
};
