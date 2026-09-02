import {
  agentLabel,
  identityFor,
  identityKey,
  orderedAgents,
  rankOf,
  worktreeKey,
  worktreeRankOf,
} from "../shared/identity.ts";
import { isUrgentStatus, type AgentSnapshot, type FocusOrderState } from "../shared/types.ts";

const RESET = "\u001b[0m";
const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const REVERSE = "\u001b[7m";

export type ManagerSection = "agents" | "worktrees";

export type ManagerSelection = {
  section: ManagerSection;
  key?: string;
};

export type ManagerOffsets = Record<ManagerSection, number>;

export type ManagerWorktreeRow = {
  identity: { kind: "worktree"; value: string };
  label: string;
  agent?: AgentSnapshot;
};

const CHROME_LINES = 8;

export function managerViewport(height: number): number {
  return Math.max(1, height - CHROME_LINES);
}

export function renderManager(
  state: FocusOrderState,
  agents: AgentSnapshot[],
  worktrees: ManagerWorktreeRow[],
  selection: ManagerSelection,
  status: string,
  helpOpen: boolean,
  offsets: ManagerOffsets,
  height: number,
): string {
  const safeHeight = Math.max(CHROME_LINES, height);
  if (helpOpen) return renderHelp(state, safeHeight);

  const activeAgents = selection.section === "agents";
  const rankedAgents = orderedAgents(state, agents);
  const ordered = activeAgents ? rankedAgents : worktrees;
  const keys = activeAgents
    ? rankedAgents.map((agent) => identityKey(identityFor(agent)))
    : worktrees.map((row) => worktreeKey(row.identity));
  const selectedIndex = selection.key === undefined ? 0 : Math.max(0, keys.indexOf(selection.key));
  const widths = activeAgents ? agentColumnWidths(rankedAgents) : undefined;
  const worktreeWidths = activeAgents ? undefined : worktreeColumnWidths(worktrees);
  const lines = activeAgents
    ? rankedAgents.map((agent) => renderAgentRow(state, agent, widths!))
    : worktrees.map((row) => renderWorktreeRow(state, row, worktreeWidths!));
  const list = visibleRows(lines, selectedIndex, offsets[selection.section], managerViewport(safeHeight));
  const title = activeAgents ? "Agents" : "Worktrees";
  const description = activeAgents
    ? "Rank individual panes. - means no explicit agent rank."
    : "Rank checkouts. Unranked agents inherit this rank; agent ranks win.";
  const legend = activeAgents
    ? "Status: idle = waiting for input; working = active; blocked = needs help; done = finished; unknown = unavailable. Guard acts on idle, blocked, and done."
    : "Each row is one checkout. The current agent is shown at right.";
  const columns = activeAgents
    ? renderAgentColumns(widths!)
    : renderWorktreeColumns(worktreeWidths!);
  const tabs = activeAgents
    ? `${REVERSE} 1 Agents ${RESET}   2 Worktrees`
    : `1 Agents   ${REVERSE} 2 Worktrees ${RESET}`;
  const rows = [
    `Guard: ${state.enabled ? `${GREEN}ON${RESET}` : `${RED}OFF${RESET}`}   Mode: ${state.mode === "focus" ? "Focus" : "Modal"}`,
    tabs,
    `${BOLD}${title}${RESET}`,
    `${DIM}${description}${RESET}`,
    `${DIM}${legend}${RESET}`,
    `${DIM}${columns}${RESET}`,
    ...(ordered.length === 0 ? [`${DIM}  No ${activeAgents ? "agent panes" : "worktrees"} reported by Herdr.${RESET}`] : list),
    `${DIM}${status}${RESET}`,
    `${DIM}up/down or j/k select  |  1/2 switch  |  m mode  |  e guard  |  ? help  |  q close${RESET}`,
  ];
  return `${rows.slice(0, safeHeight).join("\n")}\n`;
}

function renderHelp(state: FocusOrderState, height: number): string {
  const lines = [
    `${BOLD}Focus Order - Help${RESET}`,
    `Guard is ${state.enabled ? "ON" : "OFF"}.`,
    "  ON enforces the highest-ranked urgent agent; OFF only records your ranks.",
    "  Urgent means idle, blocked, or done. Snoozed agents are skipped.",
    "",
    `Mode is ${state.mode === "focus" ? "Focus" : "Modal"}.`,
    "  Focus moves Herdr focus to the highest-ranked urgent agent.",
    "  Modal opens an Attention required popup while an urgent agent exists.",
    "",
    "Priority model:",
    "  An explicit agent rank wins over every worktree rank.",
    "  An unranked agent inherits the rank of its worktree (checkout).",
    "",
    "Keys:",
    "  Up/down or j/k  select an item",
    "  1 / 2           switch between Agents and Worktrees",
    "  u / d           move the selected rank up or down",
    "  r               rank the selected item at the end",
    "  x               remove the selected item's rank",
    "  s               snooze the selected agent until it is working",
    "  f               focus the selected agent now; rank is unchanged",
    "  m               switch Focus and Modal mode",
    "  e               enable or disable the guard",
    "  l               reload agents and worktrees",
    "  ?               return to the list",
    "  q               close this manager",
    "",
    `${DIM}Press ? to return to the list.${RESET}`,
  ];
  return `${lines.slice(0, height).join("\n")}\n`;
}

function visibleRows(
  lines: string[],
  selectedIndex: number,
  requestedOffset: number,
  viewport: number,
): string[] {
  const bodyRows = Math.max(1, viewport - 2);
  const maxOffset = Math.max(0, lines.length - bodyRows);
  let offset = Math.max(0, Math.min(requestedOffset, maxOffset));
  if (selectedIndex < offset) offset = selectedIndex;
  if (selectedIndex >= offset + bodyRows) offset = selectedIndex - bodyRows + 1;
  const end = Math.min(lines.length, offset + bodyRows);
  const visible = lines.slice(offset, end).map((line, index) => (
    markRow(line, offset + index === selectedIndex)
  ));
  while (visible.length < bodyRows) visible.push("");
  return [
    offset > 0 ? `${DIM}  ^ ${offset} more above${RESET}` : "",
    ...visible,
    end < lines.length ? `${DIM}  v ${lines.length - end} more below${RESET}` : "",
  ];
}

function markRow(line: string, selected: boolean): string {
  return selected ? `${REVERSE}> ${line}${RESET}` : `  ${line}`;
}

type AgentColumnWidths = {
  agent: number;
  project: number;
  worktree: number;
  tab: number;
  pane: number;
};

function agentColumnWidths(agents: AgentSnapshot[]): AgentColumnWidths {
  const width = (values: string[], minimum: number, maximum: number): number => (
    Math.min(maximum, Math.max(minimum, ...values.map((value) => value.length)))
  );
  return {
    agent: width(agents.map(agentLabel), 5, 14),
    project: width(agents.map(agentProject), 7, 18),
    worktree: width(agents.map(agentWorktree), 8, 22),
    tab: 20,
    pane: 8,
  };
}

function renderAgentColumns(widths: AgentColumnWidths): string {
  return `  Rank  ${"Status".padEnd(11, " ")} ${"Agent".padEnd(widths.agent, " ")} | ${"Project".padEnd(widths.project, " ")} | ${"Worktree".padEnd(widths.worktree, " ")} | ${"Tab".padEnd(widths.tab, " ")} | Pane`;
}

function renderAgentRow(
  state: FocusOrderState,
  agent: AgentSnapshot,
  widths: AgentColumnWidths,
): string {
  const rank = rankOf(state, agent);
  const worktreeRank = worktreeRankOf(state, agent);
  const effectiveRank = rank === undefined
    ? worktreeRank === undefined ? "-" : `wt:${worktreeRank}`
    : String(rank);
  const status = agent.agent_status;
  const project = clip(agentProject(agent), widths.project);
  const worktree = clip(agentWorktree(agent), widths.worktree);
  const tab = clip(agent.title ?? agent.terminal_title ?? shortId(agent.tab_id), widths.tab);
  const pane = clip(shortId(agent.pane_id), widths.pane);
  return `${effectiveRank.padStart(4, " ")}  ${status.padEnd(11, " ")} ${clip(agentLabel(agent), widths.agent).padEnd(widths.agent, " ")} | ${project.padEnd(widths.project, " ")} | ${worktree.padEnd(widths.worktree, " ")} | ${tab.padEnd(widths.tab, " ")} | pane ${pane}`;
}

function agentProject(agent: AgentSnapshot): string {
  return agent.worktree_label ?? agent.workspace_label ?? agent.workspace_id;
}

function agentWorktree(agent: AgentSnapshot): string {
  return basename(agent.worktree_path ?? agent.worktree_id ?? agent.workspace_label ?? agent.workspace_id);
}

type WorktreeColumnWidths = {
  worktree: number;
  project: number;
  current: number;
};

function worktreeColumnWidths(rows: ManagerWorktreeRow[]): WorktreeColumnWidths {
  const width = (values: string[], minimum: number, maximum: number): number => (
    Math.min(maximum, Math.max(minimum, ...values.map((value) => value.length)))
  );
  return {
    worktree: width(rows.map(worktreeDisplayName), 8, 22),
    project: width(rows.map((row) => row.agent ? agentProject(row.agent) : "-"), 7, 18),
    current: width(rows.map((row) => row.agent ? agentLabel(row.agent) : "-"), 7, 16),
  };
}

function renderWorktreeColumns(widths: WorktreeColumnWidths): string {
  return `  Rank  ${"Worktree".padEnd(widths.worktree, " ")} | ${"Project".padEnd(widths.project, " ")} | Current agent`;
}

function renderWorktreeRow(
  state: FocusOrderState,
  row: ManagerWorktreeRow,
  widths: WorktreeColumnWidths,
): string {
  const rank = state.ordered_worktrees.findIndex(
    (stored) => worktreeKey(stored.identity) === worktreeKey(row.identity),
  );
  const worktree = clip(worktreeDisplayName(row), widths.worktree);
  const project = clip(row.agent ? agentProject(row.agent) : "-", widths.project);
  const current = row.agent ? `${agentLabel(row.agent)} [${row.agent.agent_status}]` : "-";
  return `${(rank === -1 ? "-" : String(rank + 1)).padStart(4, " ")}  ${worktree.padEnd(widths.worktree, " ")} | ${project.padEnd(widths.project, " ")} | ${clip(current, widths.current)}`;
}

function worktreeDisplayName(row: ManagerWorktreeRow): string {
  const identity = row.identity.value;
  if (isPathLike(identity)) return basename(identity);
  if (row.label && !isPathLike(row.label)) return row.label;
  return basename(row.label || identity);
}

function isPathLike(value: string): boolean {
  return value.includes("/") || value.includes("\\") || value.startsWith("workspace:");
}

function worktreeName(agent: AgentSnapshot): string {
  const label = agent.worktree_label;
  const path = agent.worktree_path ?? agent.worktree_id;
  if (label && label !== agent.workspace_label) return label;
  if (path) return basename(path);
  return label ?? agent.workspace_label ?? agent.workspace_id;
}

function basename(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? value;
}

function shortId(value: string): string {
  const suffix = value.match(/(?:^|:)([a-z]+\d+)$/i)?.[1];
  return suffix ?? value;
}

function clip(value: string, width: number): string {
  if (value.length <= width) return value;
  return `${value.slice(0, Math.max(1, width - 3))}...`;
}
