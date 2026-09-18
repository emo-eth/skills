import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface AdvisorWhen {
  files?: string[];
  paths?: string[];
  message_matches?: string;
}

export type ParseWhenResult =
  | { ok: true; when?: AdvisorWhen }
  | { ok: false; error: string };

export type WhenMatchResult =
  | { matches: true }
  | { matches: false; reason: string };

export interface WhenEvaluationContext {
  cwd: string;
  lastUserMessage?: string;
  currentTurnPaths?: string[];
  loadedWatchdogDirs?: string[];
  fileExists?: (filePath: string) => boolean;
}

const ALLOWED_WHEN_KEYS: Record<string, true> = {
  files: true,
  paths: true,
  message_matches: true,
};

export function parseAdvisorWhen(raw: unknown): ParseWhenResult {
  if (raw === undefined || raw === null) {
    return { ok: true, when: undefined };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "when must be a mapping" };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_WHEN_KEYS[key]) {
      return { ok: false, error: `unknown key in when: "${key}"` };
    }
  }

  let files: string[] | undefined;
  if (record.files !== undefined) {
    if (typeof record.files === "string") {
      files = [record.files.trim()];
    } else if (Array.isArray(record.files)) {
      if (!record.files.every((item) => typeof item === "string")) {
        return { ok: false, error: "when.files must be strings" };
      }
      files = (record.files as string[]).map((s) => s.trim()).filter(Boolean);
    } else {
      return { ok: false, error: "when.files must be a string or list of strings" };
    }
  }

  let paths: string[] | undefined;
  if (record.paths !== undefined) {
    if (typeof record.paths === "string") {
      paths = [record.paths.trim()];
    } else if (Array.isArray(record.paths)) {
      if (!record.paths.every((item) => typeof item === "string")) {
        return { ok: false, error: "when.paths must be strings" };
      }
      paths = (record.paths as string[]).map((s) => s.trim()).filter(Boolean);
    } else {
      return { ok: false, error: "when.paths must be a string or list of strings" };
    }
  }

  let message_matches: string | undefined;
  if (record.message_matches !== undefined) {
    if (typeof record.message_matches !== "string") {
      return { ok: false, error: "when.message_matches must be a string" };
    }
    message_matches = record.message_matches;
  }

  const when: AdvisorWhen = {};
  if (files !== undefined) when.files = files;
  if (paths !== undefined) when.paths = paths;
  if (message_matches !== undefined) when.message_matches = message_matches;
  return { ok: true, when };
}

export function normalizePosixPath(raw: string): string {
  let p = raw.replace(/\\/g, "/").trim();
  if (p.startsWith("./")) {
    p = p.slice(2);
  }
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

export function globToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  let regex = "^";
  let i = 0;
  while (i < normalized.length) {
    if (normalized.startsWith("**/", i)) {
      regex += "(?:.+/)?";
      i += 3;
    } else if (normalized.startsWith("/**", i) && i + 3 === normalized.length) {
      regex += "(?:/.*)?";
      i += 3;
    } else if (normalized.startsWith("**", i)) {
      regex += ".*";
      i += 2;
    } else if (normalized[i] === "*") {
      regex += "[^/]*";
      i += 1;
    } else if (normalized[i] === "?") {
      regex += "[^/]";
      i += 1;
    } else if ("./+^$()[]{}|\\".includes(normalized[i])) {
      regex += "\\" + normalized[i];
      i += 1;
    } else {
      regex += normalized[i];
      i += 1;
    }
  }
  regex += "$";
  return new RegExp(regex);
}

const EXTENSION_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]*[A-Za-z][A-Za-z0-9_.-]*$/;
const DOTFILE_RE = /^\.[A-Za-z0-9_-]+$/;
const NUMBERS_RE = /^[0-9]+(\.[0-9]+)*$/;

export function extractPathTokens(text: string): string[] {
  if (!text) return [];
  const tokens = new Set<string>();
  const matches = text.match(/[A-Za-z0-9_.~/\\-]+/g) ?? [];
  for (const match of matches) {
    let raw = match.replace(/\\/g, "/");
    raw = raw.replace(/^["'(`<\s]+/, "").replace(/[.,:;!?'")>`\s]+$/, "");
    const candidate = normalizePosixPath(raw);
    if (!candidate || candidate === "." || candidate === ".." || candidate === "/") continue;
    if (candidate.startsWith("http://") || candidate.startsWith("https://")) continue;
    if (NUMBERS_RE.test(candidate)) continue;
    const hasSlash = candidate.includes("/");
    const hasExtension = EXTENSION_RE.test(candidate);
    const isDotfile = DOTFILE_RE.test(candidate);
    if (hasSlash || hasExtension || isDotfile) {
      tokens.add(candidate);
    }
  }
  return [...tokens].sort();
}

export function getAncestorDirs(startDir: string): string[] {
  const ancestors: string[] = [];
  let current = path.resolve(startDir);
  const home = path.resolve(os.homedir());
  while (true) {
    ancestors.push(current);
    let hasGit = false;
    try {
      hasGit = fs.existsSync(path.join(current, ".git"));
    } catch {
    }
    if (hasGit || current === home) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return ancestors;
}

export function matchAdvisorWhen(
  when: AdvisorWhen | undefined,
  context: WhenEvaluationContext,
): WhenMatchResult {
  if (!when) return { matches: true };
  const hasFiles = when.files !== undefined;
  const hasPaths = when.paths !== undefined;
  const hasMessage = when.message_matches !== undefined;
  if (!hasFiles && !hasPaths && !hasMessage) {
    return { matches: true };
  }

  const fileExists =
    context.fileExists ??
    ((p: string) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });

  if (hasFiles) {
    const files = when.files ?? [];
    if (files.length === 0) {
      return { matches: false, reason: "when.files: no files configured" };
    }
    const candidateDirs = new Set<string>();
    candidateDirs.add(path.resolve(context.cwd));
    for (const dir of getAncestorDirs(context.cwd)) {
      candidateDirs.add(path.resolve(dir));
    }
    if (context.loadedWatchdogDirs) {
      for (const dir of context.loadedWatchdogDirs) {
        candidateDirs.add(path.resolve(dir));
      }
    }

    let matched = false;
    for (const file of files) {
      if (path.isAbsolute(file)) {
        if (fileExists(file)) {
          matched = true;
          break;
        }
      } else {
        for (const dir of candidateDirs) {
          const fullPath = path.resolve(dir, file);
          if (fileExists(fullPath)) {
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
    }
    if (!matched) {
      return { matches: false, reason: `when.files: none of [${files.join(", ")}] exist` };
    }
  }

  if (hasPaths) {
    const paths = when.paths ?? [];
    if (paths.length === 0) {
      return { matches: false, reason: "when.paths: no paths configured" };
    }
    const turnPaths = (context.currentTurnPaths ?? []).map(normalizePosixPath);
    let matched = false;
    for (const pattern of paths) {
      const regex = globToRegex(pattern);
      if (turnPaths.some((tp) => regex.test(tp))) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      return { matches: false, reason: `when.paths: no paths matched [${paths.join(", ")}]` };
    }
  }

  if (hasMessage) {
    let regex: RegExp;
    try {
      regex = new RegExp(when.message_matches ?? "");
    } catch (error) {
      return {
        matches: false,
        reason: `when.message_matches: invalid regex (${error instanceof Error ? error.message : String(error)})`,
      };
    }
    const userMessage = context.lastUserMessage ?? "";
    if (!regex.test(userMessage)) {
      return {
        matches: false,
        reason: `when.message_matches: user message did not match /${when.message_matches}/`,
      };
    }
  }

  return { matches: true };
}

export function formatWhen(when: AdvisorWhen | undefined): string {
  if (!when) return "always";
  const parts: string[] = [];
  if (when.files && when.files.length > 0) {
    parts.push(`files: ${when.files.join(", ")}`);
  }
  if (when.paths && when.paths.length > 0) {
    parts.push(`paths: ${when.paths.join(", ")}`);
  }
  if (when.message_matches !== undefined) {
    parts.push(`message_matches: /${when.message_matches}/`);
  }
  return parts.length > 0 ? parts.join("; ") : "always";
}
