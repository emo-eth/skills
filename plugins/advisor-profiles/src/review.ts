import type { AdvisorConfig } from "./config.ts";

export const DEFAULT_MAX_TRANSCRIPT_CHARS = 48_000;

export const ADVISOR_FOLLOWUP_MARKER = "[advisor-profile]";

export const REVIEW_SEVERITIES = ["nit", "concern", "blocker"] as const;

export type AdvisorSeverity = (typeof REVIEW_SEVERITIES)[number];

export type Verdict =
  | { kind: "pass" }
  | { kind: "note"; severity: AdvisorSeverity; note: string };

export type VerdictResult = Verdict | { kind: "error"; message: string };

export type AdvisorOutcome =
  | { kind: "pass" }
  | { kind: "note"; severity: AdvisorSeverity; note: string; suppressedDuplicate: boolean }
  | { kind: "no_model"; reason: string }
  | { kind: "error"; message: string };

export type ReviewModel = { provider: string; id: string };

export type ResolvedReviewModel =
  | { kind: "ok"; model: ReviewModel }
  | { kind: "no_model"; reason: string };

export type TranscriptMessage = {
  role?: string;
  content?: unknown;
  toolName?: string;
  isError?: boolean;
};

export type ReviewFollowUp = {
  advisor: AdvisorConfig;
  severity: AdvisorSeverity;
  note: string;
  message: string;
};

export type ReviewResult = {
  followUp: ReviewFollowUp | undefined;
};

export type AdvisorReviewInput = {
  advisors: AdvisorConfig[];
  sharedInstructions: string | undefined;
  transcript: TranscriptMessage[];
  dedupe: Set<string>;
  maxTranscriptChars?: number;
  resolveModel: (advisor: AdvisorConfig) => ResolvedReviewModel;
  complete: (model: ReviewModel, system: string, user: string) => Promise<string>;
  record: (advisor: AdvisorConfig, outcome: AdvisorOutcome) => void;
};

export function parseModelSelector(spec: string): { provider: string; id: string } | undefined {
  const trimmed = spec.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return undefined;
  const provider = trimmed.slice(0, slash);
  let id = trimmed.slice(slash + 1);
  const levelSuffix = id.match(/:[A-Za-z0-9_-]+$/);
  if (levelSuffix) id = id.slice(0, -levelSuffix[0].length);
  if (!id) return undefined;
  return { provider, id };
}

export function normalizeNote(note: string): string {
  return note.trim().replace(/\s+/g, " ").toLowerCase();
}

export function serializeTranscript(messages: readonly TranscriptMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === "toolResult") {
      const flag = message.isError ? " [error]" : "";
      parts.push(`### toolResult: ${message.toolName ?? "?"}${flag}\n${textOfContent(message.content)}`);
    } else {
      parts.push(`### ${message.role ?? "unknown"}\n${textOfContent(message.content)}`);
    }
  }
  return parts.join("\n\n");
}

export function boundTranscript(serialized: string, maxChars: number): string {
  if (serialized.length <= maxChars) return serialized;
  const marker = "\n\u2026 [transcript truncated] \u2026\n";
  const headLength = Math.floor(maxChars * 0.4);
  const tailLength = Math.max(0, maxChars - headLength - marker.length);
  return `${serialized.slice(0, headLength)}${marker}${serialized.slice(-tailLength)}`;
}

export function buildReviewPrompt(input: {
  advisorName: string;
  sharedInstructions: string | undefined;
  advisorInstructions: string | undefined;
  tools: string[] | undefined;
  transcript: string;
}): { system: string; user: string } {
  const lines: string[] = [
    `You are the advisor "${input.advisorName}", reviewing the main agent's just-completed turn.`,
    "Return exactly one JSON object and nothing else:",
    '{"pass": true} when the turn satisfies you, or',
    '{"severity": "nit" | "concern" | "blocker", "note": "<one concise, actionable note>"} otherwise.',
    'Severity meanings: "nit" is minor polish, "concern" should be addressed, "blocker" must be fixed before continuing.',
    "Constraints: base every note only on the transcript below; emit at most one note; no style commentary;",
    "name the specific code, behavior, or clause the note refers to.",
  ];
  if (input.sharedInstructions?.trim()) {
    lines.push("", "Shared advisor baseline:", input.sharedInstructions.trim());
  }
  if (input.advisorInstructions?.trim()) {
    lines.push("", "Your specialization:", input.advisorInstructions.trim());
  }
  if (input.tools && input.tools.length > 0) {
    lines.push(
      "",
      "Host limitation: this host gives advisors no tool loop, so the requested tools",
      `(${input.tools.join(", ")}) are not available to you. Review from the transcript text alone.`,
    );
  }
  const system = lines.join("\n");
  const user = `Transcript of the completed turn:\n\n${input.transcript}`;
  return { system, user };
}

export function parseVerdict(text: string): VerdictResult {
  const object = extractJsonObject(text);
  if (object === undefined) return { kind: "error", message: "reviewer output was not parseable JSON" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(object);
  } catch {
    return { kind: "error", message: "reviewer output was not parseable JSON" };
  }
  if (!isRecord(parsed)) return { kind: "error", message: "reviewer output was not a JSON object" };
  if (parsed.pass === true) return { kind: "pass" };
  const severity = parsed.severity;
  const note = typeof parsed.note === "string" ? parsed.note.trim() : "";
  if (severity === "nit" || severity === "concern" || severity === "blocker") {
    if (!note) return { kind: "error", message: "reviewer returned a severity without a note" };
    return { kind: "note", severity, note };
  }
  return { kind: "error", message: "reviewer output had no valid pass or severity verdict" };
}

export function buildFollowUpMessage(advisorName: string, severity: AdvisorSeverity, note: string): string {
  return (
    `${ADVISOR_FOLLOWUP_MARKER} ${advisorName} advisor review (${severity}): ${note}\n` +
    "Address this finding with concrete changes or evidence before continuing."
  );
}

export async function runAdvisorReviews(input: AdvisorReviewInput): Promise<ReviewResult> {
  const maxChars = input.maxTranscriptChars ?? DEFAULT_MAX_TRANSCRIPT_CHARS;
  const serialized = boundTranscript(serializeTranscript(input.transcript), maxChars);

  const outcomes: AdvisorOutcome[] = [];
  for (const advisor of input.advisors) {
    const outcome = await reviewAdvisor(advisor, serialized, input);
    outcomes.push(outcome);
    input.record(advisor, outcome);
  }

  let bestIndex = -1;
  let bestSeverity = 0;
  const severityRank: Record<AdvisorSeverity, number> = { nit: 0, concern: 1, blocker: 2 };
  for (let index = 0; index < outcomes.length; index++) {
    const outcome = outcomes[index];
    if (outcome.kind !== "note" || outcome.suppressedDuplicate) continue;
    const rank = severityRank[outcome.severity];
    if (rank > bestSeverity) {
      bestSeverity = rank;
      bestIndex = index;
    }
  }
  if (bestIndex < 0 || bestSeverity === 0) return { followUp: undefined };

  const outcome = outcomes[bestIndex] as Extract<AdvisorOutcome, { kind: "note" }>;
  const advisor = input.advisors[bestIndex];
  return {
    followUp: {
      advisor,
      severity: outcome.severity,
      note: outcome.note,
      message: buildFollowUpMessage(advisor.name, outcome.severity, outcome.note),
    },
  };
}

async function reviewAdvisor(
  advisor: AdvisorConfig,
  serialized: string,
  input: AdvisorReviewInput,
): Promise<AdvisorOutcome> {
  let resolved: ResolvedReviewModel;
  try {
    resolved = input.resolveModel(advisor);
  } catch (error) {
    return { kind: "no_model", reason: errorMessage(error) };
  }
  if (resolved.kind === "no_model") return resolved;

  const prompt = buildReviewPrompt({
    advisorName: advisor.name,
    sharedInstructions: input.sharedInstructions,
    advisorInstructions: advisor.instructions,
    tools: advisor.tools,
    transcript: serialized,
  });

  let text: string;
  try {
    text = await input.complete(resolved.model, prompt.system, prompt.user);
  } catch (error) {
    return { kind: "error", message: errorMessage(error) };
  }

  const verdict = parseVerdict(text);
  if (verdict.kind === "error") return verdict;
  if (verdict.kind === "pass") return { kind: "pass" };

  const normalized = normalizeNote(verdict.note);
  if (input.dedupe.has(normalized)) {
    return { kind: "note", severity: verdict.severity, note: verdict.note, suppressedDuplicate: true };
  }
  input.dedupe.add(normalized);
  return { kind: "note", severity: verdict.severity, note: verdict.note, suppressedDuplicate: false };
}

function extractJsonObject(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const candidate = scanJsonObject(trimmed);
    if (candidate !== undefined) return candidate;
  }
  const start = trimmed.indexOf("{");
  if (start < 0) return undefined;
  return scanJsonObject(trimmed.slice(start));
}

function scanJsonObject(text: string): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(0, index + 1);
    }
  }
  return undefined;
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
    } else if (part.type === "toolCall" && typeof part.name === "string") {
      parts.push(`(tool call: ${part.name})`);
    } else if (part.type === "thinking" && typeof part.text === "string") {
      parts.push(`(thinking: ${part.text})`);
    }
  }
  return parts.join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
