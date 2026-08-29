import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

export const MAX_AT_IMPORT_DEPTH = 5;

export interface AdvisorConfig {
  name: string;
  model?: string;
  tools?: string[];
  instructions?: string;
  enabled?: boolean;
}

export interface DiscoveredAdvisors {
  advisors: AdvisorConfig[];
  sharedInstructions: string | undefined;
}

export interface ConfigCandidate {
  path: string;
  content: string;
  level: "user" | "project";
  depth: number;
}

export interface DiscoverOptions {
  onWarning?: (message: string) => void;
}

export function slugifyAdvisorName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "advisor";
}

export function defaultAgentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir) return path.resolve(envDir);
  return path.join(os.homedir(), ".pi", "agent");
}

async function repoRootOrHome(cwd: string): Promise<string> {
  let current = path.resolve(cwd);
  const home = os.homedir();
  while (true) {
    try {
      await fs.stat(path.join(current, ".git"));
      return current;
    } catch {
    }
    if (current === home) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

export async function collectConfigCandidates(
  cwd: string,
  agentDir: string | undefined,
  filenames: readonly string[],
): Promise<ConfigCandidate[]> {
  const resolvedAgentDir = agentDir ?? defaultAgentDir();
  const root = await repoRootOrHome(cwd);
  const userPaths = new Set<string>();

  const candidates = new Set<string>();
  for (const filename of filenames) {
    const userPath = path.resolve(resolvedAgentDir, filename);
    candidates.add(userPath);
    userPaths.add(userPath);
  }

  let current = path.resolve(cwd);
  while (true) {
    for (const filename of filenames) {
      candidates.add(path.resolve(current, ".omp", filename));
      candidates.add(path.resolve(current, filename));
    }
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const items: ConfigCandidate[] = [];
  for (const candidate of candidates) {
    let content: string;
    try {
      content = await fs.readFile(candidate, "utf8");
    } catch {
      continue;
    }
    const parentDir = path.dirname(candidate);
    const baseName = path.basename(parentDir);
    const isUser = userPaths.has(candidate);
    const ownerDir = baseName === ".omp" ? path.dirname(parentDir) : parentDir;
    const ownerBaseName = path.basename(ownerDir);
    if (!isUser && ownerBaseName.startsWith(".") && baseName !== ".omp") continue;
    const relative = path.relative(cwd, ownerDir);
    const depth = relative === "" ? 0 : relative.split(path.sep).filter(Boolean).length;
    items.push({ path: candidate, content, level: isUser ? "user" : "project", depth });
  }

  items.sort((a, b) => {
    if (a.level !== b.level) return a.level === "user" ? -1 : 1;
    return b.depth - a.depth;
  });
  return items;
}

export async function discoverAdvisorConfigs(
  cwd: string,
  agentDir?: string,
  options: DiscoverOptions = {},
): Promise<DiscoveredAdvisors> {
  const warn = options.onWarning ?? ((message: string) => console.warn(`[advisor-profile] ${message}`));
  const items = await collectConfigCandidates(cwd, agentDir, ["WATCHDOG.yml", "WATCHDOG.yaml"]);
  const advisors = new Map<string, AdvisorConfig>();
  const sharedParts: string[] = [];

  for (const item of items) {
    let parsed: unknown;
    try {
      parsed = parseYaml(item.content);
    } catch (error) {
      warn(`failed to parse YAML at ${item.path}: ${String(error)}`);
      continue;
    }
    const doc = validateWatchdogDoc(parsed);
    if (!doc) {
      warn(`invalid WATCHDOG.yml schema at ${item.path}`);
      continue;
    }

    if (doc.instructions?.trim()) {
      const expanded = (await expandAtImports(doc.instructions, item.path)).trim();
      if (expanded) sharedParts.push(expanded);
    }

    for (const entry of doc.advisors) {
      const slug = slugifyAdvisorName(entry.name);
      const instructions = entry.instructions?.trim()
        ? (await expandAtImports(entry.instructions, item.path)).trim() || undefined
        : undefined;
      advisors.set(slug, {
        name: entry.name,
        model: entry.model?.trim() || undefined,
        tools: entry.tools,
        instructions,
        enabled: entry.enabled,
      });
    }
  }

  return {
    advisors: [...advisors.values()],
    sharedInstructions: sharedParts.length > 0 ? sharedParts.join("\n\n") : undefined,
  };
}

interface RawAdvisor {
  name: string;
  model?: string;
  tools?: string[];
  instructions?: string;
  enabled?: boolean;
}

interface RawWatchdogDoc {
  instructions?: string;
  advisors: RawAdvisor[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateWatchdogDoc(parsed: unknown): RawWatchdogDoc | undefined {
  if (!isRecord(parsed)) return undefined;
  if (parsed.instructions !== undefined && typeof parsed.instructions !== "string") return undefined;
  const advisors: RawAdvisor[] = [];
  if (parsed.advisors !== undefined) {
    if (!Array.isArray(parsed.advisors)) return undefined;
    for (const entry of parsed.advisors) {
      if (!isRecord(entry)) continue;
      if (typeof entry.name !== "string" || !entry.name.trim()) continue;
      if (entry.model !== undefined && typeof entry.model !== "string") continue;
      if (entry.instructions !== undefined && typeof entry.instructions !== "string") continue;
      if (entry.enabled !== undefined && typeof entry.enabled !== "boolean") continue;
      let tools: string[] | undefined;
      if (entry.tools !== undefined) {
        if (!Array.isArray(entry.tools) || entry.tools.some((tool) => typeof tool !== "string")) continue;
        tools = entry.tools as string[];
      }
      advisors.push({
        name: entry.name,
        model: entry.model as string | undefined,
        tools,
        instructions: entry.instructions as string | undefined,
        enabled: entry.enabled as boolean | undefined,
      });
    }
  }
  const doc: RawWatchdogDoc = { advisors };
  if (typeof parsed.instructions === "string" && parsed.instructions.trim()) {
    doc.instructions = parsed.instructions;
  }
  return doc;
}

export interface ExpandAtImportsOptions {
  maxDepth?: number;
  home?: string;
}

const AT_IMPORT_REGEX = /(^|[ \t])@([./~A-Za-z0-9_-][^\s]*)/g;
const TRAILING_PUNCT = /[.,;:!?)\]}"']+$/;

export async function expandAtImports(
  content: string,
  filePath: string,
  options: ExpandAtImportsOptions = {},
): Promise<string> {
  const maxDepth = options.maxDepth ?? MAX_AT_IMPORT_DEPTH;
  const home = options.home ?? os.homedir();
  const absoluteSource = path.resolve(filePath);
  const visited = new Set<string>([absoluteSource]);
  return expand(content, path.dirname(absoluteSource), 0, maxDepth, home, visited);
}

async function expand(
  content: string,
  baseDir: string,
  depth: number,
  maxDepth: number,
  home: string,
  visited: Set<string>,
): Promise<string> {
  if (depth >= maxDepth) return content;
  const segments = splitMarkdownSegments(content);
  const out: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "code") {
      out.push(segment.text);
      continue;
    }
    out.push(await expandTextSegment(segment.text, baseDir, depth, maxDepth, home, visited));
  }
  return out.join("");
}

async function expandTextSegment(
  text: string,
  baseDir: string,
  depth: number,
  maxDepth: number,
  home: string,
  visited: Set<string>,
): Promise<string> {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    lines[index] = await expandLine(lines[index], baseDir, depth, maxDepth, home, visited);
  }
  return lines.join("\n");
}

async function expandLine(
  line: string,
  baseDir: string,
  depth: number,
  maxDepth: number,
  home: string,
  visited: Set<string>,
): Promise<string> {
  if (!line.includes("@")) return line;
  const matches: Array<{ start: number; end: number; importPath: string }> = [];
  for (const match of line.matchAll(AT_IMPORT_REGEX)) {
    const matchIndex = match.index ?? 0;
    const leading = match[1];
    const rawToken = match[2];
    const atPos = matchIndex + leading.length;
    if (isInsideInlineCode(line, atPos)) continue;
    const trimmedToken = rawToken.replace(TRAILING_PUNCT, "");
    if (trimmedToken.length === 0) continue;
    matches.push({ start: atPos, end: atPos + 1 + trimmedToken.length, importPath: trimmedToken });
  }
  if (matches.length === 0) return line;

  const parts: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    parts.push(line.slice(cursor, match.start));
    const expandedContent = await resolveAndExpand(match.importPath, baseDir, depth, maxDepth, home, visited);
    parts.push(expandedContent ?? line.slice(match.start, match.end));
    cursor = match.end;
  }
  parts.push(line.slice(cursor));
  return parts.join("");
}

async function resolveAndExpand(
  importPath: string,
  baseDir: string,
  depth: number,
  maxDepth: number,
  home: string,
  visited: Set<string>,
): Promise<string | null> {
  const resolved = resolveImportPath(importPath, baseDir, home);
  if (visited.has(resolved)) return null;
  const content = await readTextFile(resolved);
  if (content === null) return null;
  visited.add(resolved);
  return expand(content, path.dirname(resolved), depth + 1, maxDepth, home, visited);
}

function resolveImportPath(importPath: string, baseDir: string, home: string): string {
  if (importPath === "~") return path.resolve(home);
  if (importPath.startsWith("~/")) return path.resolve(home, importPath.slice(2));
  if (path.isAbsolute(importPath)) return path.resolve(importPath);
  return path.resolve(baseDir, importPath);
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

interface MarkdownSegment {
  kind: "text" | "code";
  text: string;
}

function splitMarkdownSegments(content: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const lines = content.split("\n");
  let buffer: string[] = [];
  let bufferKind: MarkdownSegment["kind"] = "text";
  let fenceChar = "";
  let fenceLen = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    segments.push({ kind: bufferKind, text: buffer.join("") });
    buffer = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const isLast = index === lines.length - 1;
    const lineText = isLast ? line : `${line}\n`;
    const fence = matchFence(line);

    if (fence && bufferKind === "text") {
      flush();
      bufferKind = "code";
      buffer.push(lineText);
      fenceChar = fence.char;
      fenceLen = fence.len;
    } else if (fence && bufferKind === "code" && fence.char === fenceChar && fence.len >= fenceLen) {
      buffer.push(lineText);
      flush();
      bufferKind = "text";
      fenceChar = "";
      fenceLen = 0;
    } else {
      buffer.push(lineText);
    }

    if (isLast) flush();
  }
  return segments;
}

function matchFence(line: string): { char: string; len: number } | null {
  let index = 0;
  while (index < line.length && (line[index] === " " || line[index] === "\t")) index++;
  const char = line[index];
  if (char !== "`" && char !== "~") return null;
  let len = 0;
  while (index + len < line.length && line[index + len] === char) len++;
  if (len < 3) return null;
  return { char, len };
}

function isInsideInlineCode(line: string, position: number): boolean {
  let inSpan = false;
  let index = 0;
  while (index < position && index < line.length) {
    if (line[index] === "`") {
      while (index < line.length && line[index] === "`") index++;
      inSpan = !inSpan;
    } else {
      index++;
    }
  }
  return inSpan;
}
