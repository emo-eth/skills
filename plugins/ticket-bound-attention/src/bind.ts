import { basename } from "node:path";

export type Seat = {
  workspaceId: string;
  label: string;
  checkoutPath: string;
  repoName?: string;
  isLinkedWorktree?: boolean;
};

export type TicketRef = {
  identifier: string;
  url: string;
};

export type TicketFace = {
  intention: string;
  vibe: string;
  doneWhen: string;
  map: string;
};

const TICKET_ID = /\b([A-Z]{2,}-\d+)\b/;
const TICKET_NAME = /^(?:[A-Z]{2,}-\d+)(?:$|[-_].*)/;
const LINEAR_ISSUE_URL = /https:\/\/linear\.app\/[^\s)]+\/issue\/([A-Z]{2,}-\d+)[^\s)]*/i;
const PARENT_LINE =
  /Linear parent:\s*\[([A-Z]{2,}-\d+)\]\((https?:\/\/[^)\s]+)\)/i;
const STANDING =
  "Standing instruction: update Linear only when intention, vibe, done-when, or map actually change.";

export function isCommandCenter(seat: Seat): boolean {
  const label = seat.label.trim().toLowerCase();
  const base = basename(seat.checkoutPath).toLowerCase();
  const repo = (seat.repoName ?? "").toLowerCase();
  if (label === "standup" || base === "standup") return true;
  return repo === "scratch" && seat.isLinkedWorktree === false;
}

export function humanTitle(seat: Seat): string {
  const label = seat.label.trim();
  if (label && !TICKET_NAME.test(label)) return label;
  const base = basename(seat.checkoutPath);
  if (base && !TICKET_NAME.test(base)) return base;
  const repo = seat.repoName?.trim();
  if (repo) return repo;
  return "seated work";
}

export function defaultFace(seat: Seat, vibeHint?: string): TicketFace {
  const title = humanTitle(seat);
  return {
    intention: `Do the seated work named "${title}".`,
    vibe: vibeHint?.trim()
      || "Herdr is the desk, Linear is the archive. This chair has a ticket so it can leave the screen without being forgotten.",
    doneWhen:
      "The work's own accepted criteria are met. Until then this ticket stays open; hiding the chair is not Done.",
    map: mapMarkdown(seat),
  };
}

export function mapMarkdown(seat: Seat): string {
  return `* Herdr: ${seat.label} (${seat.workspaceId})\n* Path: \`${seat.checkoutPath}\``;
}

export function renderDescription(face: TicketFace): string {
  return [
    "## Intention",
    "",
    face.intention.trim(),
    "",
    "## Vibe",
    "",
    face.vibe.trim(),
    "",
    "## Done-when",
    "",
    face.doneWhen.trim(),
    "",
    "## Map",
    "",
    face.map.trim(),
    "",
  ].join("\n");
}

export function parseTicketFromGoal(text: string): TicketRef | undefined {
  const parent = text.match(PARENT_LINE);
  if (parent?.[1] && parent[2]) {
    return { identifier: parent[1], url: parent[2] };
  }
  const linked = text.match(/\[([A-Z]{2,}-\d+)\]\((https:\/\/linear\.app\/[^)\s]+)\)/i);
  if (linked?.[1] && linked[2]) {
    return { identifier: linked[1], url: linked[2] };
  }
  return undefined;
}

export function parseTicketFromTokens(
  tokens: Record<string, string> | null | undefined,
): TicketRef | undefined {
  if (!tokens) return undefined;
  const identifier = tokens.ticket?.trim();
  if (!identifier || !TICKET_ID.test(identifier)) return undefined;
  const url = tokens.ticket_url?.trim() || linearUrl(identifier);
  return { identifier: identifier.match(TICKET_ID)?.[1] ?? identifier, url };
}

export function linearUrl(identifier: string, titleSlug?: string): string {
  const slug = titleSlug
    ? `/${titleSlug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`
    : "";
  return `https://linear.app/emo-eth/issue/${identifier}${slug}`;
}

export function ensureGoalBind(
  existing: string | undefined,
  ref: TicketRef,
  seat: Seat,
  face: TicketFace,
): { text: string; changed: boolean } {
  const parent = `Linear parent: [${ref.identifier}](${ref.url}).`;
  if (!existing?.trim()) {
    const title = humanTitle(seat);
    const text = [
      `# Goal: ${title}`,
      "",
      parent,
      "",
      "## Objective",
      face.intention,
      "",
      "## Acceptance",
      face.doneWhen,
      "",
      STANDING,
      "",
      "## Map",
      face.map,
      "",
    ].join("\n");
    return { text, changed: true };
  }
  let text = existing;
  if (!PARENT_LINE.test(text)) {
    const lines = text.split("\n");
    const heading = lines.findIndex((line) => line.startsWith("# "));
    const at = heading >= 0 ? heading + 1 : 0;
    lines.splice(at, 0, "", parent);
    text = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  }
  if (!text.includes("update Linear only when")) {
    text = `${text.trimEnd()}\n\n${STANDING}\n`;
  }
  return { text, changed: text !== existing };
}

export function parseSections(description: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const chunks = description.split(/^## /m);
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const newline = trimmed.indexOf("\n");
    const name = (newline === -1 ? trimmed : trimmed.slice(0, newline)).trim().toLowerCase();
    const body = newline === -1 ? "" : trimmed.slice(newline + 1).trim();
    sections[name] = body;
  }
  return sections;
}

export function seatingFromMap(map: string | undefined): { label?: string; workspaceId?: string; path?: string } {
  if (!map) return {};
  const herdr = map.match(/Herdr:\s*(.+?)\s*\((\w+)\)/i);
  const path = map.match(/(?:Path|Worktree):\s*`?([^\n`]+)`?/i);
  return {
    ...(herdr?.[1] ? { label: herdr[1].trim() } : {}),
    ...(herdr?.[2] ? { workspaceId: herdr[2] } : {}),
    ...(path?.[1] ? { path: path[1].trim() } : {}),
  };
}

export function seatingChanged(description: string, seat: Seat): boolean {
  const fromMap = seatingFromMap(parseSections(description).map);
  const fromBody = seatingFromMap(description);
  const seated = {
    label: fromMap.label ?? fromBody.label,
    workspaceId: fromMap.workspaceId ?? fromBody.workspaceId,
    path: fromMap.path ?? fromBody.path,
  };
  if (!seated.path && !seated.label) return true;
  if (seated.path && seated.path !== seat.checkoutPath) return true;
  if (seated.label && seated.label !== seat.label) return true;
  if (seated.workspaceId && seated.workspaceId !== seat.workspaceId) return true;
  return false;
}

export function missingFaceSections(description: string): boolean {
  const sections = parseSections(description);
  return !sections.intention || !sections.vibe || !sections["done-when"] || !sections.map;
}

export function patchMap(description: string, seat: Seat): string {
  const sections = splitMarkdownSections(description);
  const mapped = sections.findIndex((section) => (
    /^Map\b/i.test(section.name) && /Herdr:|Path:|Worktree:/i.test(section.body)
  ));
  const fallback = sections.findIndex((section) => /^Map\b/i.test(section.name));
  const at = mapped >= 0 ? mapped : fallback;
  if (at < 0) return `${description.trimEnd()}\n\n## Map\n\n${mapMarkdown(seat)}\n`;
  sections[at] = { name: "Map", body: mapMarkdown(seat) };
  return joinMarkdownSections(sections);
}

function splitMarkdownSections(text: string): { name: string; body: string }[] {
  const chunks = text.split(/^## /m);
  const sections: { name: string; body: string }[] = [];
  chunks.forEach((chunk, index) => {
    if (index === 0) {
      if (chunk.trim()) sections.push({ name: "", body: chunk.trimEnd() });
      return;
    }
    const newline = chunk.indexOf("\n");
    const name = (newline === -1 ? chunk : chunk.slice(0, newline)).trim();
    const body = newline === -1 ? "" : chunk.slice(newline + 1).trim();
    sections.push({ name, body });
  });
  return sections;
}

function joinMarkdownSections(sections: { name: string; body: string }[]): string {
  return `${sections.map((section) => {
    if (!section.name) return section.body.trim();
    return `## ${section.name}\n\n${section.body.trim()}`;
  }).join("\n\n")}\n`;
}

export function linearWrite(existing: string | undefined, seat: Seat, face: TicketFace): {
  write: boolean;
  description: string;
  reason: "create" | "fill-face" | "map" | "unchanged";
} {
  if (!existing?.trim()) {
    return { write: true, description: renderDescription(face), reason: "create" };
  }
  if (missingFaceSections(existing)) {
    const sections = parseSections(existing);
    const filled: TicketFace = {
      intention: sections.intention || face.intention,
      vibe: sections.vibe || face.vibe,
      doneWhen: sections["done-when"] || face.doneWhen,
      map: sections.map || face.map,
    };
    const description = renderDescription(filled);
    return {
      write: description.trim() !== existing.trim(),
      description,
      reason: "fill-face",
    };
  }
  if (seatingChanged(existing, seat)) {
    return { write: true, description: patchMap(existing, seat), reason: "map" };
  }
  return { write: false, description: existing, reason: "unchanged" };
}

export function parseEventSeat(
  eventJson: string | undefined,
  env: { pluginEvent?: string; workspaceId?: string },
): Seat | undefined {
  if (!eventJson?.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(eventJson);
  } catch {
    return undefined;
  }
  void env;
  return seatFromUnknown(parsed);
}

function seatFromUnknown(value: unknown): Seat | undefined {
  if (!isRecord(value)) return undefined;
  const data = isRecord(value.data) ? value.data : value;
  const workspace = isRecord(data.workspace) ? data.workspace : undefined;
  const worktree = isRecord(data.worktree) ? data.worktree : undefined;
  const nested = workspace && isRecord(workspace.worktree) ? workspace.worktree : undefined;
  const workspaceId = stringValue(workspace?.workspace_id) ?? stringValue(worktree?.open_workspace_id);
  const label = stringValue(workspace?.label) ?? stringValue(worktree?.label);
  const checkoutPath = stringValue(nested?.checkout_path) ?? stringValue(worktree?.path);
  if (!workspaceId || !label || !checkoutPath) return undefined;
  return {
    workspaceId,
    label,
    checkoutPath,
    ...(stringValue(nested?.repo_name) ? { repoName: stringValue(nested?.repo_name) } : {}),
    ...(typeof nested?.is_linked_worktree === "boolean"
      ? { isLinkedWorktree: nested.is_linked_worktree }
      : typeof worktree?.is_linked_worktree === "boolean"
        ? { isLinkedWorktree: worktree.is_linked_worktree }
        : {}),
  };
}

export function parseCreatedIssue(output: string): TicketRef | undefined {
  const trimmed = output.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const fromJson = ticketFromUnknown(parsed);
      if (fromJson) return fromJson;
    } catch {
      // fall through to text
    }
  }
  const urlMatch = trimmed.match(LINEAR_ISSUE_URL);
  if (urlMatch?.[0] && urlMatch[1]) {
    return { identifier: urlMatch[1], url: urlMatch[0].replace(/[.,)]+$/, "") };
  }
  const id = trimmed.match(TICKET_ID)?.[1];
  if (id) return { identifier: id, url: linearUrl(id) };
  return undefined;
}

function ticketFromUnknown(value: unknown): TicketRef | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = ticketFromUnknown(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const identifier = stringValue(value.identifier) ?? stringValue(value.id)?.match(TICKET_ID)?.[1];
  const url = stringValue(value.url);
  if (identifier && url) return { identifier, url };
  if (identifier) return { identifier, url: linearUrl(identifier) };
  if (url) {
    const id = url.match(LINEAR_ISSUE_URL)?.[1];
    if (id) return { identifier: id, url };
  }
  for (const nested of Object.values(value)) {
    const found = ticketFromUnknown(nested);
    if (found) return found;
  }
  return undefined;
}

export function workspaceFromSnapshot(
  snapshot: unknown,
  workspaceId: string,
): Seat | undefined {
  const workspaces = snapshotWorkspaces(snapshot);
  const match = workspaces.find((row) => stringValue(row.workspace_id) === workspaceId);
  if (!match) return undefined;
  const worktree = isRecord(match.worktree) ? match.worktree : undefined;
  const checkoutPath = stringValue(worktree?.checkout_path);
  const label = stringValue(match.label);
  if (!checkoutPath || !label) return undefined;
  return {
    workspaceId,
    label,
    checkoutPath,
    ...(stringValue(worktree?.repo_name) ? { repoName: stringValue(worktree?.repo_name) } : {}),
    ...(typeof worktree?.is_linked_worktree === "boolean"
      ? { isLinkedWorktree: worktree.is_linked_worktree }
      : {}),
  };
}

export function tokensFromSnapshot(
  snapshot: unknown,
  workspaceId: string,
): Record<string, string> | undefined {
  const workspaces = snapshotWorkspaces(snapshot);
  const match = workspaces.find((row) => stringValue(row.workspace_id) === workspaceId);
  if (!match || !isRecord(match.tokens)) return undefined;
  const tokens: Record<string, string> = {};
  for (const [key, value] of Object.entries(match.tokens)) {
    if (typeof value === "string") tokens[key] = value;
  }
  return tokens;
}

function snapshotWorkspaces(snapshot: unknown): Record<string, unknown>[] {
  if (!isRecord(snapshot)) return [];
  const root = isRecord(snapshot.result) ? snapshot.result : snapshot;
  const nested = isRecord(root.snapshot) ? root.snapshot : root;
  const workspaces = nested.workspaces;
  if (!Array.isArray(workspaces)) return [];
  return workspaces.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
