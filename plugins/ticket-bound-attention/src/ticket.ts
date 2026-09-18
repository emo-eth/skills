export const TICKET_ID = /\b([A-Z]{2,10}-\d+)\b/;
export const LINEAR_ISSUE_URL =
  /https:\/\/linear\.app\/[^\s)"']+\/issue\/([A-Z]{2,10}-\d+)[^\s)"']*/i;

export type TicketRef = {
  identifier: string;
  url: string;
  title?: string;
};

export function isTicketNumberName(name: string): boolean {
  return /^[A-Z]{2,10}-\d+$/i.test(name.trim());
}

export function humanTitle(name: string): string {
  const text = name.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!text) return name.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function ticketRefFromText(text: string): TicketRef | undefined {
  const urlMatch = text.match(LINEAR_ISSUE_URL);
  if (urlMatch?.[1] && urlMatch[0]) {
    return {
      identifier: urlMatch[1].toUpperCase(),
      url: urlMatch[0].replace(/[.,]+$/, ""),
    };
  }
  const id = text.match(TICKET_ID)?.[1];
  if (!id) return undefined;
  return { identifier: id.toUpperCase(), url: linearUrl(id.toUpperCase()) };
}

export function linearUrl(identifier: string): string {
  return `https://linear.app/emo-eth/issue/${identifier}`;
}

export function parseCreatedIssue(output: string): TicketRef {
  const trimmed = output.trim();
  if (!trimmed) throw new Error("linear issue create printed nothing");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const fromJson = ticketFromUnknown(JSON.parse(trimmed));
      if (fromJson) return fromJson;
    } catch {
      // fall through to text
    }
  }
  const parsed = ticketRefFromText(trimmed);
  if (parsed) return parsed;
  throw new Error(`linear issue create returned no identifier:\n${trimmed}`);
}

function ticketFromUnknown(value: unknown): TicketRef | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = ticketFromUnknown(item);
      if (found) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const identifierRaw = record.identifier ?? record.id;
  const identifier = typeof identifierRaw === "string"
    ? identifierRaw.match(TICKET_ID)?.[1]
    : undefined;
  const url = typeof record.url === "string" ? record.url : undefined;
  const title = typeof record.title === "string" ? record.title : undefined;
  if (identifier && url) {
    return { identifier: identifier.toUpperCase(), url, ...(title ? { title } : {}) };
  }
  if (identifier) {
    return {
      identifier: identifier.toUpperCase(),
      url: linearUrl(identifier.toUpperCase()),
      ...(title ? { title } : {}),
    };
  }
  if (url) {
    const fromUrl = ticketRefFromText(url);
    if (fromUrl) return { ...fromUrl, ...(title ? { title } : {}) };
  }
  for (const nested of Object.values(record)) {
    const found = ticketFromUnknown(nested);
    if (found) return found;
  }
  return undefined;
}
