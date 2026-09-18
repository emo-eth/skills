import { goalPath, parseGoalTicket, parseMapPath, parseTicketFile, ticketFilePath } from "./goal.ts";
import type { PluginDeps, WorkspaceInfo } from "./capture.ts";

export type DeskOrphan = "no-ticket" | "missing-checkout" | "map-path-missing";

export type DeskChair = {
  workspace_id: string;
  label: string;
  ticket?: string;
  path?: string;
  orphans: DeskOrphan[];
};

export type DeskReport = {
  chairs: DeskChair[];
  orphans: DeskChair[];
};

export async function desk(deps: PluginDeps): Promise<DeskReport> {
  const workspaces = await deps.listWorkspaces();
  const chairs: DeskChair[] = [];
  for (const workspace of workspaces) {
    chairs.push(await inspectChair(workspace, deps));
  }
  return { chairs, orphans: chairs.filter((chair) => chair.orphans.length > 0) };
}

async function inspectChair(workspace: WorkspaceInfo, deps: PluginDeps): Promise<DeskChair> {
  const path = workspace.worktree?.checkout_path;
  const orphans: DeskOrphan[] = [];
  if (!path) orphans.push("missing-checkout");
  const ticket = await readTicket(path, workspace, deps);
  if (!ticket) orphans.push("no-ticket");
  if (path) {
    const goal = await deps.readFile(goalPath(path));
    const mapped = goal ? parseMapPath(goal) : undefined;
    const check = mapped ?? path;
    if (check && !(await deps.pathExists(check))) orphans.push("map-path-missing");
  }
  return {
    workspace_id: workspace.workspace_id,
    label: workspace.label,
    ticket,
    path,
    orphans,
  };
}

async function readTicket(
  path: string | undefined,
  workspace: WorkspaceInfo,
  deps: PluginDeps,
): Promise<string | undefined> {
  const fromToken = workspace.tokens?.ticket?.trim();
  if (fromToken) return fromToken;
  if (!path) return undefined;
  const goal = await deps.readFile(goalPath(path));
  const fromGoal = goal ? parseGoalTicket(goal)?.identifier : undefined;
  if (fromGoal) return fromGoal;
  const ticket = await deps.readFile(ticketFilePath(path));
  return ticket ? parseTicketFile(ticket)?.identifier : undefined;
}
