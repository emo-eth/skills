export type Phase = "inactive" | "active" | "wrap-up" | "expired" | "complete";

export type ExpiryPolicy = "block-new" | "abort-running";

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

export type ActivationInput = DeadlineInput & {
  expiryPolicy: ExpiryPolicy;
};

export type PlanItem = {
  id: string;
  title: string;
  status: "pending" | "active" | "complete" | "blocked" | "deferred";
};

export type PlanRevision = {
  revision: number;
  recordedAt: number;
  changedPlanItemIds: string[];
  reason: string;
  actualElapsedMs: number;
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
  completedAt?: number;
};

export type Shortcut = {
  choice: string;
  tradeoff: string;
};

export type ChildReportInput = {
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

export type ChildReport = ChildReportInput & {
  actualElapsedMs: number;
  recordedAt: number;
};

export type SessionState = {
  version: 2;
  sessionId: string;
  issuedAt: number;
  hardDeadline: number;
  wrapUpAt: number;
  expiryPolicy: ExpiryPolicy;
  plan: PlanItem[];
  planRevisions: PlanRevision[];
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
  assignmentId?: string;
  actionId?: string;
  enforceable?: boolean;
};

export type ToolDecision = {
  allow: boolean;
  phase: Phase;
  remainingMs: number;
  reason?: string;
};

export type ElapsedTimeContext = {
  sessionId: string;
  assignmentId?: string;
  currentTimeMs: number;
  totalElapsedMs: number;
  latestInferenceElapsedMs: number;
  latestToolCallElapsedMs: number;
  remainingMs: number;
  phase: Phase;
  assignmentElapsedMs: number;
  expiryPolicy: ExpiryPolicy;
};

export type Status = {
  sessionId: string;
  active: boolean;
  phase: Phase;
  remainingMs: number;
  deadlineMs?: number;
  wrapUpAt?: number;
  expiryPolicy?: ExpiryPolicy;
  revision?: number;
  assignmentElapsedMs?: number;
  context?: ElapsedTimeContext;
  assignment?: Assignment;
};

export type RunningAction = {
  actionId: string;
  toolName: string;
  action: ActionClass;
  assignmentId?: string;
  startedAt: number;
  abortRequestedAt?: number;
  abortObservedAt?: number;
};

export type StateStore = {
  load(sessionId: string): PersistedState | undefined;
  save(state: PersistedState): void;
};
