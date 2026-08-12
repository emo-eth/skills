// Thin wrapper around the installed `linear` CLI for the prioritize tool.
//
// Authentication is handled by the `linear` CLI's existing api-key auth, so
// this module never reads credentials or talks to the API directly — it shells
// out to `linear api` (read) and `linear issue update` (write).

import { spawnSync } from "node:child_process";
import type { Ticket } from "./prioritize-core.ts";

const ACTIVE_STATE_TYPES = new Set(["triage", "backlog", "unstarted", "started"]);

type LinearNode = {
  id: string;
  identifier?: string;
  title?: string;
  url?: string;
  priority?: number | null;
  priorityLabel?: string | null;
  state?: { name?: string; type?: string } | null;
  parent?: { id?: string; identifier?: string } | null;
  team?: { key?: string } | null;
};

function runLinear(args: string[], input?: string): string {
  const result = spawnSync("linear", args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    throw new Error(
      stderr || `linear ${args[0] ?? ""} exited with status ${result.status}`,
    );
  }
  return result.stdout;
}

/**
 * Walk `data.data.viewer.assignedIssues.nodes` using runtime narrowing so the
 * shape is proven at each step rather than asserted for a single access.
 */
function getAssignedNodes(payload: unknown): LinearNode[] {
  if (payload === null || typeof payload !== "object" || !("data" in payload)) {
    return [];
  }
  const data = payload.data;
  if (
    data === null ||
    typeof data !== "object" ||
    !("viewer" in data)
  ) {
    return [];
  }
  const viewer = data.viewer;
  if (
    viewer === null ||
    typeof viewer !== "object" ||
    !("assignedIssues" in viewer)
  ) {
    return [];
  }
  const assignedIssues = viewer.assignedIssues;
  if (
    assignedIssues === null ||
    typeof assignedIssues !== "object" ||
    !("nodes" in assignedIssues)
  ) {
    return [];
  }
  const nodes = assignedIssues.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes as LinearNode[];
}

/** Only issues that are still actionable ("assigned to me, not completed"). */
function isActionable(node: LinearNode): boolean {
  const type = node.state?.type;
  return type === undefined || ACTIVE_STATE_TYPES.has(type);
}

function toTicket(node: LinearNode): Ticket {
  const id = node.identifier ?? node.id;
  if (!id.trim()) throw new Error("A Linear issue is missing an identifier.");
  return {
    id,
    title: node.title ?? "Untitled issue",
    ...(node.state?.name ? { state: node.state.name } : {}),
    ...(node.priority !== undefined && node.priority !== null
      ? { priority: node.priority }
      : {}),
    ...(node.url ? { url: node.url } : {}),
  };
}

/**
 * Fetch the authenticated viewer's assigned issues that are not completed or
 * canceled. Uses `linear api --paginate` so all pages are returned.
 */
export async function fetchAssignedNotCompleted(
  options: { team?: string } = {},
): Promise<Ticket[]> {
  const query = [
    "query {",
    "  viewer {",
    "    assignedIssues(first: 100) {",
    "      nodes {",
    "        id",
    "        identifier",
    "        title",
    "        url",
    "        priority",
    "        priorityLabel",
    "        state { name type }",
    "        parent { id identifier }",
    "        team { key }",
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");

  const raw = runLinear(["api", "--paginate", query]);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse linear api output: ${message}`);
  }
  const nodes = getAssignedNodes(data);
  if (nodes.length === 0) {
    throw new Error("Linear returned no assigned issues.");
  }

  const filterTeam = options.team;
  return nodes
    .filter((node) => isActionable(node))
    .filter((node) => !filterTeam || node.team?.key === filterTeam)
    .map(toTicket);
}

/**
 * Set an issue's priority (Linear value 1..4, descending; 1 = Urgent).
 * `issueId` is the team identifier, e.g. "NAT-44".
 */
export async function setPriority(
  issueId: string,
  priority: number,
): Promise<void> {
  if (!Number.isInteger(priority) || priority < 1 || priority > 4) {
    throw new Error(`Linear priority must be 1..4, got: ${priority}`);
  }
  runLinear(["issue", "update", issueId, "--priority", String(priority)]);
}

/**
 * Permanently delete issues. `--confirm` skips the CLI's internal prompt —
 * the caller is responsible for gating this behind an explicit user confirmation.
 */
export async function deleteIssues(issueIds: string[]): Promise<void> {
  if (issueIds.length === 0) return;
  runLinear(["issue", "delete", "--bulk", ...issueIds, "--confirm"]);
}
