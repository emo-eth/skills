import type { AssignedIssue, PluginDeps } from "./capture.ts";
import { desk, type DeskChair } from "./desk.ts";

/** Linear priorities written by tools/prioritize-linear-tickets.ts (1 Urgent .. 4 Low). */
export const SIT_PRIORITIES = new Set([1, 2]);
export const HIDE_PRIORITIES = new Set([3, 4]);

export type RankRow = {
  ticket?: string;
  title?: string;
  workspace_id?: string;
  label?: string;
  priority?: number;
  reason: string;
};

export type RankProposal = {
  ranker: "tools/prioritize-linear-tickets.ts";
  applied: false;
  sit: RankRow[];
  hide: RankRow[];
  ask: RankRow[];
  could_sit: RankRow[];
};

export function proposeDesk(chairs: DeskChair[], issues: AssignedIssue[]): RankProposal {
  const byId = new Map(issues.map((issue) => [issue.identifier, issue]));
  const seated = new Set(
    chairs.map((chair) => chair.ticket).filter((ticket): ticket is string => Boolean(ticket)),
  );
  const sit: RankRow[] = [];
  const hide: RankRow[] = [];
  const ask: RankRow[] = [];
  for (const chair of chairs) {
    const row = chairRow(chair, chair.ticket ? byId.get(chair.ticket) : undefined);
    if (row.bucket === "sit") sit.push(row.proposal);
    else if (row.bucket === "hide") hide.push(row.proposal);
    else ask.push(row.proposal);
  }
  const could_sit: RankRow[] = [];
  for (const issue of issues) {
    if (issue.parent) continue;
    if (!SIT_PRIORITIES.has(issue.priority ?? 0)) continue;
    if (seated.has(issue.identifier)) continue;
    could_sit.push({
      ticket: issue.identifier,
      title: issue.title,
      priority: issue.priority,
      reason: `${priorityLabel(issue.priority)} ranked now, no chair`,
    });
  }
  return {
    ranker: "tools/prioritize-linear-tickets.ts",
    applied: false,
    sit,
    hide,
    ask,
    could_sit,
  };
}

export async function rank(deps: PluginDeps): Promise<RankProposal> {
  const report = await desk(deps);
  const issues = await deps.listAssignedIssues();
  return proposeDesk(report.chairs, issues);
}

export function parseAssignedIssues(payload: unknown): AssignedIssue[] {
  const nodes = assignedNodes(payload);
  const issues: AssignedIssue[] = [];
  for (const node of nodes) {
    if (!isActionable(node.stateType)) continue;
    const identifier = stringValue(node.identifier) ?? stringValue(node.id);
    if (!identifier) continue;
    const priority = typeof node.priority === "number" ? node.priority : undefined;
    issues.push({
      identifier,
      title: stringValue(node.title) ?? identifier,
      state: stringValue(node.stateName),
      ...(priority !== undefined && priority > 0 ? { priority } : {}),
      url: stringValue(node.url),
      parent: stringValue(node.parent),
    });
  }
  return issues;
}

function chairRow(
  chair: DeskChair,
  issue: AssignedIssue | undefined,
): { bucket: "sit" | "hide" | "ask"; proposal: RankRow } {
  const proposal: RankRow = {
    ticket: chair.ticket,
    title: issue?.title,
    workspace_id: chair.workspace_id,
    label: chair.label,
    priority: issue?.priority,
    reason: "",
  };
  if (!chair.ticket) {
    proposal.reason = "no ticket";
    return { bucket: "ask", proposal };
  }
  const priority = issue?.priority;
  if (!priority) {
    proposal.reason = "unranked; run tools/prioritize-linear-tickets.ts";
    return { bucket: "ask", proposal };
  }
  if (SIT_PRIORITIES.has(priority)) {
    proposal.reason = `${priorityLabel(priority)}; keep seated pending confirm`;
    return { bucket: "sit", proposal };
  }
  if (HIDE_PRIORITIES.has(priority)) {
    proposal.reason = `${priorityLabel(priority)}; hide pending confirm`;
    return { bucket: "hide", proposal };
  }
  proposal.reason = "unranked; run tools/prioritize-linear-tickets.ts";
  return { bucket: "ask", proposal };
}

function priorityLabel(priority: number | undefined): string {
  if (priority === 1) return "priority 1 Urgent";
  if (priority === 2) return "priority 2 High";
  if (priority === 3) return "priority 3 Medium";
  if (priority === 4) return "priority 4 Low";
  return "no priority";
}

function isActionable(type: string | undefined): boolean {
  return type === undefined || type === "triage" || type === "backlog" || type === "unstarted" || type === "started";
}

function assignedNodes(payload: unknown): Array<{
  id?: unknown;
  identifier?: unknown;
  title?: unknown;
  url?: unknown;
  priority?: unknown;
  stateType?: string;
  stateName?: string;
  parent?: unknown;
}> {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  const viewer = asRecord(data?.viewer);
  const assigned = asRecord(viewer?.assignedIssues);
  const nodes = assigned?.nodes;
  if (!Array.isArray(nodes)) return [];
  const rows: Array<{
    id?: unknown;
    identifier?: unknown;
    title?: unknown;
    url?: unknown;
    priority?: unknown;
    stateType?: string;
    stateName?: string;
    parent?: unknown;
  }> = [];
  for (const node of nodes) {
    const record = asRecord(node);
    if (!record) continue;
    const state = asRecord(record.state);
    const parent = asRecord(record.parent);
    rows.push({
      id: record.id,
      identifier: record.identifier,
      title: record.title,
      url: record.url,
      priority: record.priority,
      stateType: stringValue(state?.type),
      stateName: stringValue(state?.name),
      parent: parent?.identifier ?? parent?.id,
    });
  }
  return rows;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
