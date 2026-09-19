// Thin wrapper around the installed `linear` CLI for the prioritize tool.
//
// Authentication is handled by the `linear` CLI's existing api-key auth, so
// this module never reads credentials or talks to the API directly — it shells
// out to `linear api` / `linear issue query` (read) and `linear issue update` (write).

import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ticket } from "./prioritize-core.ts";
import {
  DEFAULT_RANK_FIELD_NAME,
  isRankFieldName,
  pickRankStorage,
  readRankFromDescription,
  ticketRank,
  writeRankIntoDescription,
  type RankField,
  type RankStorage,
} from "./linear-ranks.ts";

const ACTIVE_STATE_TYPES = new Set(["triage", "backlog", "unstarted", "started"]);

export type LinearProject = {
  id?: string;
  name?: string;
  slugId?: string;
};

type LinearCustomField = {
  id?: string;
  name?: string;
  type?: string;
  value?: unknown;
};

type LinearNode = {
  id: string;
  identifier?: string;
  title?: string;
  url?: string;
  description?: string | null;
  priority?: number | null;
  priorityLabel?: string | null;
  state?: { name?: string; type?: string } | null;
  parent?: { id?: string; identifier?: string } | null;
  team?: { key?: string } | null;
  project?: LinearProject | null;
  customFields?: LinearCustomField[] | null;
};

export function matchesProject(
  project: LinearProject | string | null | undefined,
  target: string,
): boolean {
  if (!project) return false;
  const normalizedTarget = target.trim().toLowerCase();
  if (!normalizedTarget) return false;

  if (typeof project === "string") {
    return project.trim().toLowerCase() === normalizedTarget;
  }
  if (project.name && project.name.trim().toLowerCase() === normalizedTarget) {
    return true;
  }
  if (project.id && project.id.trim().toLowerCase() === normalizedTarget) {
    return true;
  }
  if (project.slugId && project.slugId.trim().toLowerCase() === normalizedTarget) {
    return true;
  }
  if (project.name) {
    const slugified = project.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slugified === normalizedTarget) {
      return true;
    }
  }
  return false;
}
export function listProjects(): LinearProject[] {
  try {
    const raw = runLinear(["project", "list", "--all-teams", "--json"]);
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && "nodes" in parsed) {
      const nodes = parsed.nodes;
      if (Array.isArray(nodes)) {
        return nodes as LinearProject[];
      }
    }
    return [];
  } catch {
    return [];
  }
}

export function resolveProjectTarget(target: string): string {
  const projects = listProjects();
  const found = projects.find((p) => matchesProject(p, target));
  if (found?.id) {
    return found.id;
  }
  return target;
}

function getIssueNodes(payload: unknown): LinearNode[] {
  if (payload === null || typeof payload !== "object") {
    return [];
  }
  if ("nodes" in payload) {
    const nodes = payload.nodes;
    if (Array.isArray(nodes)) {
      return nodes as LinearNode[];
    }
  }
  if ("data" in payload) {
    const data = payload.data;
    if (data !== null && typeof data === "object") {
      if ("project" in data) {
        const project = data.project;
        if (project !== null && typeof project === "object" && "issues" in project) {
          const issues = project.issues;
          if (issues !== null && typeof issues === "object" && "nodes" in issues) {
            const nodes = issues.nodes;
            if (Array.isArray(nodes)) {
              return nodes as LinearNode[];
            }
          }
        }
      }
      if ("issues" in data) {
        const issues = data.issues;
        if (issues !== null && typeof issues === "object" && "nodes" in issues) {
          const nodes = issues.nodes;
          if (Array.isArray(nodes)) {
            return nodes as LinearNode[];
          }
        }
      }
    }
  }
  return [];
}

/**
 * Fetch all open issues in a project across all assignees.
 * Uses `linear issue query` with active state filters.
 */
export async function fetchProjectIssues(options: {
  project: string;
  team?: string;
}): Promise<Ticket[]> {
  const resolvedTarget = resolveProjectTarget(options.project);
  const args = ["issue", "query"];
  if (options.team) {
    args.push("--team", options.team);
  } else {
    args.push("--all-teams");
  }
  args.push(
    "--project",
    resolvedTarget,
    "--all-assignees",
    "-s",
    "triage",
    "-s",
    "backlog",
    "-s",
    "unstarted",
    "-s",
    "started",
    "--limit",
    "0",
    "--json",
  );

  const raw = runLinear(args);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse linear issue query output: ${message}`);
  }

  const nodes = getIssueNodes(data);
  const filterTeam = options.team;
  const tickets = nodes
    .filter((node) => isActionable(node))
    .filter((node) => !filterTeam || node.team?.key === filterTeam)
    .map(toTicket);
  return hydrateIssueBodies(tickets);
}

/**
 * Fetch open issues across several projects and merge them into one pile.
 * Tickets that appear in more than one project are kept once (first seen).
 */
export async function fetchProjectsIssues(options: {
  projects: string[];
  team?: string;
}): Promise<Ticket[]> {
  const seen = new Set<string>();
  const tickets: Ticket[] = [];
  for (const project of options.projects) {
    const batch = await fetchProjectIssues({ project, team: options.team });
    for (const ticket of batch) {
      if (seen.has(ticket.id)) continue;
      seen.add(ticket.id);
      tickets.push(ticket);
    }
  }
  return tickets;
}

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

function parseLinearJson(raw: string, what: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse ${what}: ${message}`);
  }
}

/**
 * Walk `data.data.viewer.assignedIssues.nodes` using runtime narrowing so the
 * shape is proven at each step rather than asserted for a single access.
 */
function getAssignedNodes(payload: unknown): LinearNode[] {
  if (payload === null || typeof payload !== "object") {
    return [];
  }
  const root = payload as { data?: unknown };
  const data = root.data;
  if (data === null || typeof data !== "object") {
    return [];
  }
  const viewer = (data as { viewer?: unknown }).viewer;
  if (viewer === null || typeof viewer !== "object") {
    return [];
  }
  const assignedIssues = (viewer as { assignedIssues?: unknown }).assignedIssues;
  if (assignedIssues === null || typeof assignedIssues !== "object") {
    return [];
  }
  const nodes = (assignedIssues as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes as LinearNode[];
}
function missingAssignedIssuesShape(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object") return true;
  const data = (payload as { data?: unknown }).data;
  if (data === null || typeof data !== "object") return true;
  const viewer = (data as { viewer?: unknown }).viewer;
  if (viewer === null || typeof viewer !== "object") return true;
  const assignedIssues = (viewer as { assignedIssues?: unknown }).assignedIssues;
  if (assignedIssues === null || typeof assignedIssues !== "object") return true;
  const nodes = (assignedIssues as { nodes?: unknown }).nodes;
  return !Array.isArray(nodes);
}

/** Only issues that are still actionable ("assigned to me, not completed"). */
function isActionable(node: LinearNode): boolean {
  const type = node.state?.type;
  return type === undefined || ACTIVE_STATE_TYPES.has(type);
}

function customFieldsFromNode(node: LinearNode): LinearCustomField[] | undefined {
  if (!Array.isArray(node.customFields)) return undefined;
  return node.customFields;
}

function toTicket(node: LinearNode): Ticket {
  const id = node.identifier ?? node.id;
  if (!id.trim()) throw new Error("A Linear issue is missing an identifier.");
  const description = typeof node.description === "string" ? node.description : "";
  const customFields = customFieldsFromNode(node);
  const relativeRank =
    ticketRank({
      id,
      title: node.title ?? "Untitled issue",
      description,
      ...(customFields ? { customFields } : {}),
    });
  return {
    id,
    title: node.title ?? "Untitled issue",
    uuid: node.id,
    description,
    ...(relativeRank !== undefined ? { relativeRank } : {}),
    ...(customFields ? { customFields } : {}),
    ...(node.state?.name ? { state: node.state.name } : {}),
    ...(node.priority !== undefined && node.priority !== null
      ? { priority: node.priority }
      : {}),
    ...(node.url ? { url: node.url } : {}),
    ...(node.project ? { project: node.project } : {}),
  };
}

/**
 * `linear issue query --json` does not include descriptions. Fill them (and
 * any rank comments) from a GraphQL follow-up keyed by Linear UUID.
 */
export async function hydrateIssueBodies(tickets: Ticket[]): Promise<Ticket[]> {
  const missing = tickets.filter((ticket) => {
    const description = typeof ticket.description === "string" ? ticket.description : "";
    const uuid = typeof ticket.uuid === "string" ? ticket.uuid : "";
    return description.length === 0 && uuid.length > 0;
  });
  if (missing.length === 0) return tickets;

  const ids = missing
    .map((ticket) => String(ticket.uuid))
    .filter((id) => id.length > 0);
  const query = [
    "query IssueRankBodies($ids: [ID!]) {",
    "  issues(first: 250, filter: { id: { in: $ids } }) {",
    "    nodes { id identifier description }",
    "  }",
    "}",
  ].join("\n");

  let data: unknown;
  try {
    const raw = runLinear(["api", "--variables-json", JSON.stringify({ ids }), query]);
    data = parseLinearJson(raw, "linear issue body query");
  } catch {
    return tickets;
  }

  const nodes = getIssueNodes(data);
  if (nodes.length === 0) return tickets;
  const byId = new Map<string, LinearNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
    if (node.identifier) byId.set(node.identifier, node);
  }

  return tickets.map((ticket) => {
    const node = byId.get(String(ticket.uuid ?? "")) ?? byId.get(ticket.id);
    if (!node || typeof node.description !== "string") return ticket;
    const description = node.description;
    const relativeRank = readRankFromDescription(description) ?? ticketRank(ticket);
    return {
      ...ticket,
      description,
      ...(relativeRank !== undefined ? { relativeRank } : {}),
    };
  });
}

/**
 * Fetch the authenticated viewer's assigned issues that are not completed or
 * canceled. Uses `linear api --paginate` so all pages are returned.
 */
export async function fetchAssignedNotCompleted(
  options: { team?: string; project?: string } = {},
): Promise<Ticket[]> {
  const query = [
    "query {",
    "  viewer {",
    "    assignedIssues(first: 100) {",
    "      nodes {",
    "        id",
    "        identifier",
    "        title",
    "        description",
    "        url",
    "        priority",
    "        priorityLabel",
    "        state { name type }",
    "        parent { id identifier }",
    "        team { key }",
    "        project { id name slugId }",
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
  if (missingAssignedIssuesShape(data)) {
    throw new Error("Could not parse linear api output: missing viewer.assignedIssues.");
  }
  const nodes = getAssignedNodes(data);

  const filterTeam = options.team;
  const filterProject = options.project;
  return nodes
    .filter((node) => isActionable(node))
    .filter((node) => !filterTeam || node.team?.key === filterTeam)
    .filter((node) => !filterProject || matchesProject(node.project, filterProject))
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

export async function setIssueDescription(issueId: string, description: string): Promise<void> {
  const path = join(tmpdir(), `linear-rank-${process.pid}-${Date.now()}-${issueId.replace(/[^A-Za-z0-9_-]/g, "_")}.md`);
  writeFileSync(path, description, "utf8");
  try {
    runLinear(["issue", "update", issueId, "--description-file", path]);
  } finally {
    rmSync(path, { force: true });
  }
}

function nodesFromUnknown(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && "nodes" in value) {
    const nodes = (value as { nodes?: unknown }).nodes;
    if (Array.isArray(nodes)) return nodes;
  }
  return [];
}

function asRankField(value: unknown): RankField | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { id?: unknown; name?: unknown; type?: unknown };
  if (typeof record.id !== "string" || typeof record.name !== "string") return undefined;
  if (record.type !== undefined && String(record.type).toLowerCase() !== "number") {
    return undefined;
  }
  return { id: record.id, name: record.name };
}

/**
 * Ask Linear for issue custom number fields. Workspaces without that API
 * (the current public schema) return an empty list.
 */
export async function listNumberIssueFields(): Promise<RankField[]> {
  const query = [
    "query RankNumberFields {",
    "  issueCustomFields {",
    "    nodes { id name type }",
    "  }",
    "}",
  ].join("\n");
  try {
    const raw = runLinear(["api", query]);
    const parsed = parseLinearJson(raw, "linear custom field list");
    if (!parsed || typeof parsed !== "object") return [];
    const root = parsed as { data?: { issueCustomFields?: unknown }; issueCustomFields?: unknown };
    const nodes = nodesFromUnknown(root.data?.issueCustomFields ?? root.issueCustomFields);
    return nodes.map(asRankField).filter((field): field is RankField => field !== undefined);
  } catch {
    return [];
  }
}

export async function createNumberIssueField(name = DEFAULT_RANK_FIELD_NAME): Promise<RankField | undefined> {
  const mutation = [
    "mutation CreateRankNumberField($name: String!) {",
    "  issueCustomFieldCreate(input: { name: $name, type: number }) {",
    "    success",
    "    issueCustomField { id name type }",
    "  }",
    "}",
  ].join("\n");
  try {
    const raw = runLinear(["api", "--variables-json", JSON.stringify({ name }), mutation]);
    const parsed = parseLinearJson(raw, "linear custom field create");
    if (!parsed || typeof parsed !== "object") return undefined;
    const payload = (parsed as { data?: { issueCustomFieldCreate?: { issueCustomField?: unknown } } })
      .data?.issueCustomFieldCreate?.issueCustomField;
    return asRankField(payload);
  } catch {
    return undefined;
  }
}

export async function resolveRankStorage(): Promise<RankStorage> {
  const existing = await listNumberIssueFields();
  const available = pickRankStorage(existing);
  if (available.kind === "field") return available;
  const created = await createNumberIssueField();
  if (created && isRankFieldName(created.name)) {
    return { kind: "field", field: created };
  }
  return { kind: "comment" };
}

export async function setCustomFieldNumber(
  issueId: string,
  fieldId: string,
  value: number,
): Promise<void> {
  const mutation = [
    "mutation SetRankNumberField($issueId: String!, $fieldId: String!, $value: Float!) {",
    "  issueCustomFieldValueUpsert(input: { issueId: $issueId, fieldId: $fieldId, value: $value }) {",
    "    success",
    "  }",
    "}",
  ].join("\n");
  runLinear([
    "api",
    "--variables-json",
    JSON.stringify({ issueId, fieldId, value }),
    mutation,
  ]);
}

export async function writeRelativeRank(options: {
  issueId: string;
  weight: number;
  storage: RankStorage;
  currentDescription?: string;
}): Promise<{ description?: string; relativeRank: number }> {
  if (options.storage.kind === "field") {
    await setCustomFieldNumber(options.issueId, options.storage.field.id, options.weight);
    return { relativeRank: options.weight, description: options.currentDescription };
  }
  const description = writeRankIntoDescription(options.currentDescription, options.weight);
  await setIssueDescription(options.issueId, description);
  return { relativeRank: options.weight, description };
}

/**
 * Permanently delete issues. `--confirm` skips the CLI's internal prompt —
 * the caller is responsible for gating this behind an explicit user confirmation.
 */
export async function deleteIssues(issueIds: string[]): Promise<void> {
  if (issueIds.length === 0) return;
  runLinear(["issue", "delete", "--bulk", ...issueIds, "--confirm"]);
}
