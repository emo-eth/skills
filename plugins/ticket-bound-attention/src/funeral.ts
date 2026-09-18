import { extractSection, goalPath, parseGoalTicket } from "./goal.ts";
import type { CaptureInput, PluginDeps } from "./capture.ts";

const GATE_HEADINGS = ["Done", "Acceptance", "Validation"] as const;

export type FuneralResult = {
  action: "buried" | "refused";
  workspace_id?: string;
  path?: string;
  ticket?: string;
  reasons: string[];
};

export async function funeral(input: CaptureInput, deps: PluginDeps): Promise<FuneralResult> {
  const workspaceId = input.workspaceId ?? input.env?.HERDR_WORKSPACE_ID;
  const workspace = workspaceId ? await deps.getWorkspace(workspaceId) : undefined;
  const path = input.path ?? workspace?.worktree?.checkout_path;
  if (!path) {
    return { action: "refused", workspace_id: workspaceId, reasons: ["no checkout path"] };
  }
  const goal = await deps.readFile(goalPath(path));
  const ticket = workspace?.tokens?.ticket ?? (goal ? parseGoalTicket(goal)?.identifier : undefined);
  const porcelain = await deps.gitPorcelain(path);
  const linearState = ticket ? (await deps.viewIssue(ticket)).state : undefined;
  const reasons = funeralReasons({ linearState, porcelain, goal });
  if (reasons.length > 0) {
    return { action: "refused", workspace_id: workspaceId, path, ticket, reasons };
  }
  if (!workspaceId) {
    return { action: "refused", path, ticket, reasons: ["no workspace id"] };
  }
  await deps.removeWorktree(workspaceId);
  return { action: "buried", workspace_id: workspaceId, path, ticket, reasons: [] };
}

export function funeralReasons(options: {
  linearState?: string;
  porcelain: string;
  goal?: string;
}): string[] {
  const reasons: string[] = [];
  if (!options.linearState) reasons.push("no Linear ticket");
  else if (!isDone(options.linearState)) reasons.push(`Linear is ${options.linearState}, not Done`);
  if (options.porcelain.trim()) reasons.push("worktree is dirty");
  reasons.push(...gateReasons(options.goal));
  return reasons;
}

function isDone(state: string): boolean {
  return /^done$/i.test(state.trim());
}

function gateReasons(goal: string | undefined): string[] {
  if (!goal) return [];
  const present = GATE_HEADINGS.filter((heading) => extractSection(goal, heading) !== undefined);
  if (present.length === 0) return [];
  const reasons: string[] = [];
  for (const heading of GATE_HEADINGS) {
    const body = extractSection(goal, heading);
    if (!body) reasons.push(`GOAL.md missing ## ${heading}`);
    else if (!/operator[- ]approved/i.test(body)) reasons.push(`## ${heading} is not operator-approved`);
  }
  return reasons;
}
