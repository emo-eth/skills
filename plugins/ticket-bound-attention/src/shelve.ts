import { goalPath, parseGoalTicket, sittingPath } from "./goal.ts";
import type { CaptureInput, PluginDeps } from "./capture.ts";

export type ShelveResult = {
  action: "shelved";
  workspace_id: string;
  label: string;
  ticket?: string;
  path?: string;
  sitting: boolean;
  dirty: boolean;
  working: string[];
};

export async function shelve(input: CaptureInput, deps: PluginDeps): Promise<ShelveResult> {
  const workspaceId = input.workspaceId ?? input.env?.HERDR_WORKSPACE_ID;
  if (!workspaceId) throw new Error("shelve needs --workspace");
  const workspace = await deps.getWorkspace(workspaceId);
  if (!workspace) throw new Error(`workspace ${workspaceId} not found`);
  const path = input.path ?? workspace.worktree?.checkout_path;
  const dirty = path ? Boolean((await deps.gitPorcelain(path)).trim()) : false;
  const working = (await deps.listAgents())
    .filter((agent) => agent.workspace_id === workspaceId && agent.agent_status === "working")
    .map((agent) => agent.agent ?? agent.pane_id);
  const goal = path ? await deps.readFile(goalPath(path)) : undefined;
  const ticket = workspace.tokens?.ticket ?? (goal ? parseGoalTicket(goal)?.identifier : undefined);
  let sitting = false;
  if (path && (dirty || working.length > 0)) {
    const note = sittingNote({
      existing: await deps.readFile(sittingPath(path)),
      label: workspace.label,
      workspaceId,
      ticket,
      dirty,
      working,
    });
    await deps.writeFile(sittingPath(path), note);
    sitting = true;
  }
  await deps.closeWorkspace(workspaceId);
  return {
    action: "shelved",
    workspace_id: workspaceId,
    label: workspace.label,
    ticket,
    path,
    sitting,
    dirty,
    working,
  };
}

function sittingNote(options: {
  existing: string | undefined;
  label: string;
  workspaceId: string;
  ticket?: string;
  dirty: boolean;
  working: string[];
}): string {
  const block = [
    `## ${new Date().toISOString()}`,
    "",
    `- Chair: ${options.label} (${options.workspaceId})`,
    `- Ticket: ${options.ticket ?? "none"}`,
    `- Dirty: ${options.dirty ? "yes" : "no"}`,
    `- Working: ${options.working.join(", ") || "none"}`,
    "",
  ].join("\n");
  if (!options.existing?.trim()) {
    return ["# Sitting", "", "In-flight note so hiding this chair is not amnesia.", "", block].join("\n");
  }
  return `${options.existing.replace(/\s*$/, "\n\n")}${block}`;
}
