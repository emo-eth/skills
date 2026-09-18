import { join } from "node:path";

import { linearUrl, ticketRefFromText, type TicketRef } from "./ticket.ts";

export const TICKET_FILE = ".herdr-ticket";

export const STANDING =
  "Standing: you already know this ticket. Update Linear only when Intention, Vibe, Done-when, or Map change. Ping command center `w2D:p1`. Never raw-remove this worktree; use the funeral action.";

export type MapInfo = {
  path: string;
  label?: string;
  workspaceId?: string;
};

export function ticketFilePath(tree: string): string {
  return join(tree, TICKET_FILE);
}

export function goalPath(tree: string): string {
  return join(tree, "GOAL.md");
}

export function parseTicketFile(text: string): TicketRef | undefined {
  return ticketRefFromText(text);
}

export function formatTicketFile(ref: TicketRef): string {
  return `${ref.identifier}\n${ref.url}\n`;
}

export function parseGoalTicket(text: string): TicketRef | undefined {
  const preamble = text.split(/^## /m)[0] ?? text;
  const lines = preamble.split(/\r?\n/);
  for (const line of lines) {
    if (/^Linear(?: parent)?:\s*/i.test(line)) {
      const parsed = ticketRefFromText(line);
      if (parsed) return parsed;
    }
  }
  const linked = preamble.match(/\[([A-Z]{2,10}-\d+)\]\((https:\/\/linear\.app\/[^)\s]+)\)/i);
  if (linked?.[1] && linked[2]) {
    return { identifier: linked[1].toUpperCase(), url: linked[2] };
  }
  return undefined;
}

export function extractSection(markdown: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^## ${escaped}\\s*$`, "im"));
  if (!match || match.index === undefined) return undefined;
  const after = markdown.indexOf("\n", match.index);
  const bodyStart = after === -1 ? markdown.length : after + 1;
  const rest = markdown.slice(bodyStart);
  const next = rest.search(/^## /m);
  const body = (next === -1 ? rest : rest.slice(0, next)).trim();
  return body || undefined;
}

export function mapLines(map: MapInfo): string[] {
  const lines: string[] = [];
  if (map.workspaceId) {
    lines.push(`- Herdr: ${map.label ?? map.workspaceId} (${map.workspaceId})`);
  }
  lines.push(`- Worktree: \`${map.path}\``);
  return lines;
}

export function ticketFace(options: {
  intention?: string;
  vibe?: string;
  doneWhen?: string;
  map: MapInfo;
}): string {
  return [
    "## Intention",
    "",
    options.intention?.trim() || "Work captured from a Herdr worktree.",
    "",
    "## Vibe",
    "",
    options.vibe?.trim() || "The ticket is a face, not a diary. Hidden is not gone.",
    "",
    "## Done-when",
    "",
    options.doneWhen?.trim() || "The work named here is finished.",
    "",
    "## Map",
    "",
    ...mapLines(options.map),
    "",
  ].join("\n");
}

export function upsertGoal(
  existing: string | undefined,
  ref: TicketRef,
  map: MapInfo,
  face?: { intention?: string; vibe?: string; doneWhen?: string },
): string {
  const bindLine = `Linear: [${ref.identifier}](${ref.url || linearUrl(ref.identifier)})`;
  if (!existing?.trim()) {
    const title = ref.title ?? map.label ?? "seated work";
    return [
      `# Goal: ${title}`,
      "",
      bindLine,
      "",
      STANDING,
      "",
      ticketFace({ ...face, map }).trimEnd(),
      "",
    ].join("\n");
  }
  const text = upsertBindLine(existing.replace(/\r\n/g, "\n"), bindLine);
  return upsertMapSection(text, map);
}

function upsertBindLine(markdown: string, bindLine: string): string {
  const lines = markdown.split("\n");
  const kept: string[] = [];
  let seen = false;
  for (const line of lines) {
    if (/^Linear(?: parent)?:\s*/i.test(line)) {
      if (!seen) {
        kept.push(bindLine);
        seen = true;
      }
      continue;
    }
    kept.push(line);
  }
  if (seen) return kept.join("\n");
  if (kept[0]?.startsWith("# ")) {
    let i = 1;
    while (i < kept.length && kept[i]?.trim() === "") i += 1;
    kept.splice(1, i - 1, "", bindLine);
    return kept.join("\n");
  }
  return `${bindLine}\n\n${markdown}`;
}

function upsertMapSection(markdown: string, map: MapInfo): string {
  const desired = mapLines(map);
  const herdrLine = desired.find((line) => line.startsWith("- Herdr:"));
  const worktreeLine = desired.find((line) => line.startsWith("- Worktree:"))!;
  const match = markdown.match(/^## Map\s*$/m);
  if (!match || match.index === undefined) {
    return `${markdown.replace(/\s*$/, "\n\n")}## Map\n\n${desired.join("\n")}\n`;
  }
  const start = match.index;
  const afterHeading = markdown.indexOf("\n", start);
  const bodyStart = afterHeading === -1 ? markdown.length : afterHeading + 1;
  const rest = markdown.slice(bodyStart);
  const nextHeading = rest.search(/^## /m);
  const body = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  const tail = nextHeading === -1 ? "" : rest.slice(nextHeading);
  const lines = body.split("\n");
  let sawHerdr = false;
  let sawWorktree = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^[-*]\s*Herdr:/i.test(line) && herdrLine) {
      out.push(herdrLine);
      sawHerdr = true;
    } else if (/^[-*]\s*(?:Worktree|Path):/i.test(line)) {
      out.push(worktreeLine);
      sawWorktree = true;
    } else {
      out.push(line);
    }
  }
  const missing: string[] = [];
  if (herdrLine && !sawHerdr) missing.push(herdrLine);
  if (!sawWorktree) missing.push(worktreeLine);
  if (missing.length > 0) {
    let idx = 0;
    while (idx < out.length && out[idx]?.trim() === "") idx += 1;
    out.splice(idx, 0, ...missing);
  }
  const headingLine = markdown.slice(start, bodyStart);
  let newBody = out.join("\n");
  if (!newBody.endsWith("\n") && tail) newBody += "\n";
  return `${markdown.slice(0, start)}${headingLine}${newBody}${tail}`;
}
