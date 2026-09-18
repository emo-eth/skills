import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

export const DEFAULT_LINEAR_TEAM = "EMO";

export const LINEAR_PROJECTS = [
  "Creatordex",
  "Saddle",
  "BMO / Springfield",
  "Personal / Ops",
  "Japan Trip 2026",
] as const;

export type LinearProject = (typeof LINEAR_PROJECTS)[number];

export const LINEAR_REVIEW_BUCKETS = [
  "Review bucket: 01 Personal and life",
  "Review bucket: 02 Local AI and hardware",
  "Review bucket: 03 Mobile input and Shortcuts",
  "Review bucket: 04 Hermes runtime and reliability",
  "Review bucket: 05 Wiki, memory, and documentation",
  "Review bucket: 06 Music, gaming, and creative tools",
  "Review bucket: 07 Research, evaluations, and adoption",
  "Review bucket: 08 BMO products and control surfaces",
  "Review bucket: 09 Smithers, harnesses, and agent workflows",
  "Review bucket: 10 Protocols, security, and effect gates",
] as const;

export type LinearReviewBucket = (typeof LINEAR_REVIEW_BUCKETS)[number];

export const LINEAR_ISSUE_TYPES = ["Bug", "Feature", "Improvement"] as const;

export type LinearIssueType = (typeof LINEAR_ISSUE_TYPES)[number];

export const LINEAR_PRIORITIES = {
  Urgent: 1,
  High: 2,
  Medium: 3,
  Low: 4,
  None: 0,
} as const;

export type LinearPriority = 0 | 1 | 2 | 3 | 4;

export const PRIORITY_LABELS: Record<LinearPriority, string> = {
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
  0: "None",
};

export type GitMetadata = {
  repo: string;
  worktree: string;
  branch: string;
};

export type GitRunner = (args: string[], cwd: string) => Promise<string | undefined>;

export type AmbientContext = {
  cwd?: string;
  git?: GitMetadata;
  sessionId?: string;
  sessionFile?: string;
  turn?: number;
  model?: string;
};

export type ParsedCommandArgs = {
  raw: string;
  title?: string;
  explicitTitle?: string;
  description?: string;
  explicitDescription?: string;
  project?: string;
  reviewBucket?: string;
  type?: LinearIssueType;
  priority?: LinearPriority;
  team?: string;
  labels: string[];
};

export type LinearIssueInput = {
  title: string;
  description?: string;
  team?: string;
  project?: string;
  priority?: LinearPriority;
  labels?: string[];
  state?: string;
  assignee?: string;
};

export type ClassifiedIssue = {
  team: string;
  title: string;
  description: string;
  project?: LinearProject | string;
  reviewBucket?: LinearReviewBucket;
  type: LinearIssueType;
  priority: LinearPriority;
  labels: string[];
};

export type LinearExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type LinearRunner = (
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<LinearExecutionResult>;

export type CreatedLinearIssue = {
  id?: string;
  url?: string;
  title: string;
  rawOutput: string;
};

export type ClassifierPrompt = {
  system: string;
  user: string;
};

export type ClassifierAgent = (prompt: ClassifierPrompt) => Promise<string>;

export type ClassifyOptions = {
  classifier?: ClassifierAgent;
  modelRegistry?: unknown;
  model?: unknown;
};

export function priorityLabel(priority: LinearPriority): string {
  return PRIORITY_LABELS[priority] ?? "Medium";
}

export function normalizeProject(value: string | undefined): LinearProject | string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  for (const project of LINEAR_PROJECTS) {
    if (project.toLowerCase() === lower) return project;
  }
  if (lower.includes("creatordex")) return "Creatordex";
  if (lower.includes("saddle")) return "Saddle";
  if (lower.includes("bmo") || lower.includes("springfield")) return "BMO / Springfield";
  if (lower.includes("personal") || lower.includes("ops")) return "Personal / Ops";
  if (lower.includes("japan") || lower.includes("trip")) return "Japan Trip 2026";
  return trimmed;
}

export function normalizeReviewBucket(value: string | undefined): LinearReviewBucket | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  for (const bucket of LINEAR_REVIEW_BUCKETS) {
    if (bucket.toLowerCase() === lower) return bucket;
  }
  if (/^0?1\b/.test(lower) || lower.includes("personal and life") || lower.includes("personal")) {
    return "Review bucket: 01 Personal and life";
  }
  if (/^0?2\b/.test(lower) || lower.includes("local ai") || lower.includes("hardware")) {
    return "Review bucket: 02 Local AI and hardware";
  }
  if (/^0?3\b/.test(lower) || lower.includes("mobile") || lower.includes("shortcuts")) {
    return "Review bucket: 03 Mobile input and Shortcuts";
  }
  if (/^0?4\b/.test(lower) || lower.includes("hermes") || lower.includes("reliability")) {
    return "Review bucket: 04 Hermes runtime and reliability";
  }
  if (/^0?5\b/.test(lower) || lower.includes("wiki") || lower.includes("memory") || lower.includes("documentation") || lower.includes("docs")) {
    return "Review bucket: 05 Wiki, memory, and documentation";
  }
  if (/^0?6\b/.test(lower) || lower.includes("music") || lower.includes("gaming") || lower.includes("creative")) {
    return "Review bucket: 06 Music, gaming, and creative tools";
  }
  if (/^0?7\b/.test(lower) || lower.includes("research") || lower.includes("evaluations") || lower.includes("adoption")) {
    return "Review bucket: 07 Research, evaluations, and adoption";
  }
  if (/^0?8\b/.test(lower) || lower.includes("bmo products") || lower.includes("control surfaces")) {
    return "Review bucket: 08 BMO products and control surfaces";
  }
  if (/^0?9\b/.test(lower) || lower.includes("smithers") || lower.includes("harness") || lower.includes("agent workflows") || lower.includes("harnesses") || lower.includes("workflow")) {
    return "Review bucket: 09 Smithers, harnesses, and agent workflows";
  }
  if (/^10\b/.test(lower) || lower.includes("protocols") || lower.includes("security") || lower.includes("effect gates")) {
    return "Review bucket: 10 Protocols, security, and effect gates";
  }
  return undefined;
}

export function normalizeIssueType(value: string | undefined): LinearIssueType | undefined {
  if (!value) return undefined;
  const lower = value.trim().toLowerCase();
  if (lower === "bug") return "Bug";
  if (lower === "feature") return "Feature";
  if (lower === "improvement") return "Improvement";
  return undefined;
}

export function normalizePriority(value: string | number | undefined): LinearPriority | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") {
    if (value >= 0 && value <= 4) return value as LinearPriority;
    return undefined;
  }
  const lower = value.trim().toLowerCase();
  if (lower === "1" || lower === "urgent" || lower === "p0" || lower === "blocker") return 1;
  if (lower === "2" || lower === "high" || lower === "p1") return 2;
  if (lower === "3" || lower === "medium" || lower === "p2" || lower === "normal") return 3;
  if (lower === "4" || lower === "low" || lower === "p3" || lower === "p4" || lower === "minor") return 4;
  if (lower === "0" || lower === "none") return 0;
  return undefined;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "\n") {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      tokens.push("\n");
    } else if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

export function parseCommandArgs(rawInput: string): ParsedCommandArgs {
  const raw = typeof rawInput === "string" ? rawInput.trim() : "";
  if (!raw) {
    return { raw: "", labels: [] };
  }

  const tokens = tokenize(raw);
  const remainingTokens: string[] = [];
  let team: string | undefined;
  let project: string | undefined;
  let reviewBucket: string | undefined;
  let type: LinearIssueType | undefined;
  let priority: LinearPriority | undefined;
  let explicitTitle: string | undefined;
  let explicitDescription: string | undefined;
  const labels: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith("--team=")) {
      team = token.slice(7).trim();
    } else if (token === "--team" && index + 1 < tokens.length) {
      index += 1;
      team = tokens[index];
    } else if (token.startsWith("--project=")) {
      project = token.slice(10).trim();
    } else if ((token === "--project" || token === "-p") && index + 1 < tokens.length && !/^[0-4]$/.test(tokens[index + 1])) {
      index += 1;
      project = tokens[index];
    } else if (token.startsWith("--bucket=") || token.startsWith("--review-bucket=")) {
      reviewBucket = token.slice(token.indexOf("=") + 1).trim();
    } else if ((token === "--bucket" || token === "--review-bucket") && index + 1 < tokens.length) {
      index += 1;
      reviewBucket = tokens[index];
    } else if (token.startsWith("--type=")) {
      type = normalizeIssueType(token.slice(7));
    } else if (token === "--type" && index + 1 < tokens.length) {
      index += 1;
      type = normalizeIssueType(tokens[index]);
    } else if (token.startsWith("--priority=")) {
      priority = normalizePriority(token.slice(11));
    } else if ((token === "--priority" || token === "-p") && index + 1 < tokens.length) {
      index += 1;
      priority = normalizePriority(tokens[index]);
    } else if (token.startsWith("--title=")) {
      explicitTitle = token.slice(8).trim();
    } else if ((token === "--title" || token === "-t") && index + 1 < tokens.length) {
      index += 1;
      explicitTitle = tokens[index];
    } else if (token.startsWith("--description=") || token.startsWith("--desc=")) {
      explicitDescription = token.slice(token.indexOf("=") + 1).trim();
    } else if ((token === "--description" || token === "--desc" || token === "-d") && index + 1 < tokens.length) {
      index += 1;
      explicitDescription = tokens[index];
    } else if (token.startsWith("--label=")) {
      const labelVal = token.slice(8).trim();
      if (labelVal) labels.push(labelVal);
    } else if ((token === "--label" || token === "-l") && index + 1 < tokens.length) {
      index += 1;
      labels.push(tokens[index]);
    } else {
      remainingTokens.push(token);
    }
  }

  let remainder = "";
  for (const token of remainingTokens) {
    if (token === "\n") {
      remainder += "\n";
    } else {
      if (remainder.length > 0 && !remainder.endsWith("\n")) {
        remainder += " ";
      }
      remainder += token;
    }
  }
  remainder = remainder.trim();

  let title = explicitTitle;
  let description = explicitDescription;
  if (!title && remainder) {
    const lines = remainder.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    title = lines[0];
    if (!description && lines.length > 1) {
      description = lines.slice(1).join("\n");
    }
  }

  return {
    raw,
    ...(team ? { team } : {}),
    ...(project ? { project: normalizeProject(project) } : {}),
    ...(reviewBucket ? { reviewBucket: normalizeReviewBucket(reviewBucket) } : {}),
    ...(type ? { type } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(title ? { title } : {}),
    ...(explicitTitle ? { explicitTitle } : {}),
    ...(description ? { description } : {}),
    ...(explicitDescription ? { explicitDescription } : {}),
    labels,
  };
}

function matchKeywordProject(text: string): LinearProject | undefined {
  const lower = text.toLowerCase();
  if (lower.includes("creatordex")) return "Creatordex";
  if (lower.includes("saddle")) return "Saddle";
  if (lower.includes("bmo") || lower.includes("springfield")) return "BMO / Springfield";
  if (lower.includes("japan") || lower.includes("tokyo") || lower.includes("kyoto") || lower.includes("trip 2026")) {
    return "Japan Trip 2026";
  }
  if (lower.includes("personal") || lower.includes("ops") || lower.includes("apartment") || lower.includes("groceries")) {
    return "Personal / Ops";
  }
  return undefined;
}

function matchKeywordReviewBucket(text: string): LinearReviewBucket | undefined {
  const lower = text.toLowerCase();
  if (/\b(protocol|protocols|security|effect gate|effect gates|auth|sandbox)\b/.test(lower)) {
    return "Review bucket: 10 Protocols, security, and effect gates";
  }
  if (/\b(smithers|harness|harnesses|subagent|workflow|skills|plugin|plugins|omp|pi)\b/.test(lower)) {
    return "Review bucket: 09 Smithers, harnesses, and agent workflows";
  }
  if (/\b(bmo products|control surface|control surfaces|dashboard|portal)\b/.test(lower)) {
    return "Review bucket: 08 BMO products and control surfaces";
  }
  if (/\b(research|eval|evals|evaluation|evaluations|adoption|benchmark)\b/.test(lower)) {
    return "Review bucket: 07 Research, evaluations, and adoption";
  }
  if (/\b(music|gaming|creative|audio|game|games)\b/.test(lower)) {
    return "Review bucket: 06 Music, gaming, and creative tools";
  }
  if (/\b(wiki|memory|documentation|docs|notes|mnemopi)\b/.test(lower)) {
    return "Review bucket: 05 Wiki, memory, and documentation";
  }
  if (/\b(hermes|daemon|process reliability|service runtime)\b/.test(lower)) {
    return "Review bucket: 04 Hermes runtime and reliability";
  }
  if (/\b(mobile|shortcuts|siri|ios|iphone|ipad)\b/.test(lower)) {
    return "Review bucket: 03 Mobile input and Shortcuts";
  }
  if (/\b(local ai|hardware|gpu|ollama|apple silicon|metal|m1|m2|m3|ram)\b/.test(lower)) {
    return "Review bucket: 02 Local AI and hardware";
  }
  if (/\b(life|habits|routine|health|workout|groceries|home|personal)\b/.test(lower)) {
    return "Review bucket: 01 Personal and life";
  }
  return undefined;
}

function matchKeywordType(text: string): LinearIssueType {
  const lower = text.toLowerCase();
  if (/\b(bug|crash|error|fail|failed|failure|broken|exception|fix|fixes|regression|flaky|fault|panic)\b/.test(lower)) {
    return "Bug";
  }
  if (/\b(feature|add|new|support|implement|build|create|introduce)\b/.test(lower)) {
    return "Feature";
  }
  return "Improvement";
}

function matchKeywordPriority(text: string): LinearPriority {
  const lower = text.toLowerCase();
  if (/\b(urgent|p0|blocker|critical|outage|emergency|asap)\b/.test(lower)) return 1;
  if (/\b(high priority|p1|important|soon)\b/.test(lower)) return 2;
  if (/\b(low priority|p3|p4|minor|trivial|someday|nice to have)\b/.test(lower)) return 4;
  return 3;
}

export function buildClassifierSystemPrompt(): string {
  return `You are an expert Linear issue triage assistant for the EMO team.
Given raw user thoughts and ambient project/git/session context, analyze and route the issue into the team's taxonomy.

Taxonomy:
- Team: "${DEFAULT_LINEAR_TEAM}"
- Projects:
  - "Creatordex": Creatordex search, discovery, indexing, and data pipelines
  - "Saddle": Agent-work coordination, intent preservation, demonstrating outcomes
  - "BMO / Springfield": Migrated actionable BMO and Springfield work
  - "Personal / Ops": Migrated actionable personal and operational work
  - "Japan Trip 2026": Logistics, transit bookings, activities, and prep for Sep 20 - Oct 5 trip
  - null if it does not fit any project
- Review Buckets:
  - "Review bucket: 01 Personal and life"
  - "Review bucket: 02 Local AI and hardware"
  - "Review bucket: 03 Mobile input and Shortcuts"
  - "Review bucket: 04 Hermes runtime and reliability"
  - "Review bucket: 05 Wiki, memory, and documentation"
  - "Review bucket: 06 Music, gaming, and creative tools"
  - "Review bucket: 07 Research, evaluations, and adoption"
  - "Review bucket: 08 BMO products and control surfaces"
  - "Review bucket: 09 Smithers, harnesses, and agent workflows"
  - "Review bucket: 10 Protocols, security, and effect gates"
- Issue Types:
  - "Bug": Defect, crash, broken behavior, regression, error
  - "Feature": New capability, major enhancement, integration
  - "Improvement": Refactoring, polish, optimization, cleanup, tuning
- Priorities:
  - 1: Urgent (blockers, critical outages, emergency fixes)
  - 2: High (important, next up)
  - 3: Medium (normal backlog item, standard work)
  - 4: Low (nice-to-have, minor polish, trivial)

Output JSON only in this exact shape:
{
  "title": "Concise imperative title (max 80 chars)",
  "description": "Clear Markdown description synthesizing the request and context",
  "project": "Creatordex" | "Saddle" | "BMO / Springfield" | "Personal / Ops" | "Japan Trip 2026" | null,
  "reviewBucket": "Review bucket: ...",
  "type": "Bug" | "Feature" | "Improvement",
  "priority": 1 | 2 | 3 | 4,
  "team": "EMO"
}`;
}

export function buildClassifierUserPrompt(input: string, ambient: AmbientContext = {}): string {
  const parts: string[] = [`User request:\n${input}`];
  const ambientDetails: string[] = [];
  if (ambient.cwd) ambientDetails.push(`- Current working directory: ${ambient.cwd}`);
  if (ambient.git?.repo) ambientDetails.push(`- Repository: ${ambient.git.repo}`);
  if (ambient.git?.branch) ambientDetails.push(`- Branch: ${ambient.git.branch}`);
  if (ambient.turn !== undefined) ambientDetails.push(`- Turn: ${ambient.turn}`);
  if (ambient.model) ambientDetails.push(`- Model: ${ambient.model}`);
  if (ambient.sessionId) ambientDetails.push(`- Session ID: ${ambient.sessionId}`);
  if (ambientDetails.length > 0) {
    parts.push(`Ambient context:\n${ambientDetails.join("\n")}`);
  }
  return parts.join("\n\n");
}

function extractJson(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const target = codeBlockMatch ? codeBlockMatch[1] : trimmed;
  const jsonMatch = target.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return undefined;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return undefined;
}

type ModelRegistry = {
  complete?: (
    model: unknown,
    prompt: { systemPrompt: string; messages: Array<{ role: string; content: string }> },
  ) => Promise<{ text?: string }>;
  getModel?: (name: string) => unknown;
};

async function runDefaultClassifier(
  prompt: ClassifierPrompt,
  options: { modelRegistry?: unknown; model?: unknown } = {},
): Promise<string> {
  if (process.env.LINEAR_CLASSIFIER_MOCK) {
    return process.env.LINEAR_CLASSIFIER_MOCK;
  }

  const registry = options.modelRegistry;
  if (registry && typeof registry === "object" && "complete" in registry && typeof registry.complete === "function") {
    try {
      const typedRegistry = registry as ModelRegistry;
      const modelToUse = options.model ?? typedRegistry.getModel?.("smol");
      const result = await typedRegistry.complete!(modelToUse, {
        systemPrompt: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      });
      if (result.text?.trim()) return result.text;
    } catch {}
  }

  const { promise, resolve } = Promise.withResolvers<string>();
  execFile(
    "omp",
    ["-p", prompt.user, "--system", prompt.system, "--no-session", "--no-tools", "--model", "smol"],
    { encoding: "utf8", timeout: 3000 },
    (error, stdout) => {
      if (error || !stdout?.trim()) {
        resolve("");
      } else {
        resolve(stdout.trim());
      }
    },
  );
  return promise;
}

export async function classifyLinearIssue(
  input: ParsedCommandArgs | string,
  ambient: AmbientContext = {},
  options: ClassifyOptions = {},
): Promise<ClassifiedIssue> {
  const parsed = typeof input === "string" ? parseCommandArgs(input) : input;
  const rawThought = parsed.title ? `${parsed.title}${parsed.description ? `\n${parsed.description}` : ""}` : parsed.raw;

  let routed: Record<string, unknown> | undefined;
  const classifier = options.classifier ?? ((p) => runDefaultClassifier(p, options));
  try {
    const systemPrompt = buildClassifierSystemPrompt();
    const userPrompt = buildClassifierUserPrompt(rawThought || "New issue", ambient);
    const output = await classifier({ system: systemPrompt, user: userPrompt });
    if (output) {
      routed = extractJson(output);
    }
  } catch {}

  const routedTitle = routed && typeof routed.title === "string" ? routed.title.trim() : undefined;
  const routedDesc = routed && typeof routed.description === "string" ? routed.description.trim() : undefined;
  const routedProject = routed && typeof routed.project === "string" ? normalizeProject(routed.project) : undefined;
  const routedBucket = routed && typeof routed.reviewBucket === "string" ? normalizeReviewBucket(routed.reviewBucket) : undefined;
  const routedType = routed && typeof routed.type === "string" ? normalizeIssueType(routed.type) : undefined;

  let routedPriority: LinearPriority | undefined;
  if (routed && "priority" in routed && (typeof routed.priority === "number" || typeof routed.priority === "string")) {
    routedPriority = normalizePriority(routed.priority);
  }
  const routedTeam = routed && typeof routed.team === "string" ? routed.team.trim() : undefined;

  const team = parsed.team ?? routedTeam ?? DEFAULT_LINEAR_TEAM;
  const title = parsed.explicitTitle ?? routedTitle ?? parsed.title?.trim() ?? "Untitled issue";

  const project = parsed.project
    ?? routedProject
    ?? matchKeywordProject([title, parsed.description ?? "", ambient.git?.repo ?? "", ambient.cwd ?? ""].join(" "))
    ?? (ambient.git?.repo?.toLowerCase().includes("creatordex") ? "Creatordex" : undefined);

  let reviewBucket = (parsed.reviewBucket as LinearReviewBucket | undefined) ?? routedBucket;
  if (!reviewBucket) {
    reviewBucket = matchKeywordReviewBucket([title, parsed.description ?? "", ambient.git?.repo ?? "", ambient.cwd ?? ""].join(" "));
  }
  if (!reviewBucket) {
    if (project === "Creatordex") reviewBucket = "Review bucket: 08 BMO products and control surfaces";
    else if (project === "Personal / Ops" || project === "Japan Trip 2026") reviewBucket = "Review bucket: 01 Personal and life";
    else if (project === "Saddle") reviewBucket = "Review bucket: 09 Smithers, harnesses, and agent workflows";
    else reviewBucket = "Review bucket: 09 Smithers, harnesses, and agent workflows";
  }

  const type = parsed.type
    ?? routedType
    ?? matchKeywordType(title + " " + (parsed.description ?? ""));

  const priority = parsed.priority
    ?? routedPriority
    ?? matchKeywordPriority(title + " " + (parsed.description ?? ""));

  const labelsSet = new Set<string>();
  if (reviewBucket) labelsSet.add(reviewBucket);
  labelsSet.add(type);
  for (const label of parsed.labels) {
    if (label.trim()) labelsSet.add(label.trim());
  }
  const labels = Array.from(labelsSet);

  const bodyParts: string[] = [];
  if (parsed.explicitDescription) {
    bodyParts.push(parsed.explicitDescription.trim());
  } else if (routedDesc) {
    bodyParts.push(routedDesc);
  } else if (parsed.description?.trim()) {
    bodyParts.push(parsed.description.trim());
  } else if (title !== "Untitled issue") {
    bodyParts.push(title);
  }

  const contextEntries: string[] = [];
  if (ambient.git?.repo) contextEntries.push(`- **Repository:** ${ambient.git.repo}`);
  if (ambient.git?.branch) contextEntries.push(`- **Branch:** ${ambient.git.branch}`);
  if (ambient.cwd) contextEntries.push(`- **Directory:** ${ambient.cwd}`);
  if (ambient.turn !== undefined && ambient.turn !== null) contextEntries.push(`- **Turn:** ${ambient.turn}`);
  if (ambient.model) contextEntries.push(`- **Model:** ${ambient.model}`);
  if (ambient.sessionId) contextEntries.push(`- **Session:** ${ambient.sessionId}`);

  if (contextEntries.length > 0) {
    bodyParts.push("\n---\n### Ambient Context\n" + contextEntries.join("\n"));
  }

  const description = bodyParts.join("\n\n").trim();

  return {
    team,
    title,
    description,
    ...(project ? { project } : {}),
    reviewBucket,
    type,
    priority,
    labels,
  };
}

export function buildLinearCliArgs(input: LinearIssueInput): string[] {
  const args: string[] = ["issue", "create", "--no-interactive"];
  const team = input.team?.trim() || DEFAULT_LINEAR_TEAM;
  args.push("--team", team);
  args.push("-t", input.title.trim());

  if (input.description?.trim()) {
    args.push("-d", input.description.trim());
  }
  if (input.project?.trim()) {
    args.push("--project", input.project.trim());
  }
  if (input.priority && input.priority > 0) {
    args.push("-p", String(input.priority));
  }
  if (input.state?.trim()) {
    args.push("-s", input.state.trim());
  }
  if (input.assignee?.trim()) {
    args.push("-a", input.assignee.trim());
  }
  if (input.labels) {
    for (const label of input.labels) {
      if (label.trim()) {
        args.push("-l", label.trim());
      }
    }
  }
  return args;
}

export function resolveLinearBinary(
  customPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (customPath) return customPath;
  if (env.LINEAR_BIN_PATH) return env.LINEAR_BIN_PATH;
  if (existsSync("/opt/homebrew/bin/linear")) return "/opt/homebrew/bin/linear";
  return "linear";
}

function parseCreatedIssueOutput(
  stdout: string,
  target: string[] | LinearIssueInput,
): CreatedLinearIssue {
  const idMatch = stdout.match(/\b([A-Z]+-\d+)\b/);
  const urlMatch = stdout.match(/https?:\/\/[^\s)]+/);
  let title = "Untitled issue";
  if (Array.isArray(target)) {
    const titleIndex = target.indexOf("-t");
    if (titleIndex !== -1 && titleIndex + 1 < target.length) {
      title = target[titleIndex + 1];
    }
  } else {
    title = target.title;
  }
  return {
    id: idMatch ? idMatch[1] : undefined,
    url: urlMatch ? urlMatch[0] : undefined,
    title,
    rawOutput: stdout,
  };
}

function defaultLinearRunner(
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<LinearExecutionResult> {
  const { promise, resolve } = Promise.withResolvers<LinearExecutionResult>();
  execFile(
    cmd,
    args,
    { cwd: options.cwd, env: options.env, encoding: "utf8" },
    (error, stdout, stderr) => {
      if (error) {
        let exitCode = 1;
        if (typeof error === "object" && "code" in error && typeof error.code === "number") {
          exitCode = error.code === 0 ? 1 : error.code;
        }
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ? stderr : error.message,
          exitCode,
        });
        return;
      }
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        exitCode: 0,
      });
    },
  );
  return promise;
}

export async function executeLinearCreate(
  target: string[] | LinearIssueInput,
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    runner?: LinearRunner;
    binaryPath?: string;
  } = {},
): Promise<CreatedLinearIssue> {
  const cliArgs = Array.isArray(target) ? target : buildLinearCliArgs(target);
  const binary = resolveLinearBinary(options.binaryPath, options.env);
  const runner = options.runner ?? defaultLinearRunner;
  const result = await runner(binary, cliArgs, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
  });
  if (result.exitCode !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || `Linear CLI exited with code ${result.exitCode}`;
    throw new Error(message);
  }
  return parseCreatedIssueOutput(result.stdout, target);
}

function gitValue(args: string[], cwd: string): Promise<string | undefined> {
  const { promise, resolve } = Promise.withResolvers<string | undefined>();
  execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout) => {
    if (error) {
      resolve(undefined);
      return;
    }
    const trimmed = stdout.trim();
    resolve(trimmed || undefined);
  });
  return promise;
}

export async function collectGitMetadata(
  cwd: string,
  runGit: GitRunner = gitValue,
): Promise<GitMetadata> {
  const worktree = await runGit(["rev-parse", "--show-toplevel"], cwd);
  const remote = await runGit(["remote", "get-url", "origin"], cwd);
  const branch = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
  const detachedCommit = branch ? undefined : await runGit(["rev-parse", "--short", "HEAD"], cwd);
  return {
    repo: remote || worktree || "unknown",
    worktree: worktree || cwd,
    branch: branch || (detachedCommit ? `detached:${detachedCommit}` : "unknown"),
  };
}
