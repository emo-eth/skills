import { extname } from "node:path";

export type StripResult = {
  content: string;
  removed: number;
  supported: boolean;
};

type Family = "c" | "hash" | "html" | "sql" | "lua" | "haskell";

const FAMILY_BY_EXTENSION = new Map<string, Family>([
  [".c", "c"], [".h", "c"], [".cc", "c"], [".cpp", "c"], [".cxx", "c"], [".hpp", "c"],
  [".m", "c"], [".mm", "c"], [".cs", "c"], [".java", "c"], [".kt", "c"], [".kts", "c"],
  [".js", "c"], [".jsx", "c"], [".mjs", "c"], [".cjs", "c"], [".ts", "c"], [".tsx", "c"],
  [".css", "c"], [".scss", "c"], [".sass", "c"], [".less", "c"], [".go", "c"], [".rs", "c"],
  [".swift", "c"], [".scala", "c"], [".dart", "c"], [".php", "c"], [".proto", "c"], [".sol", "c"],
  [".py", "hash"], [".pyi", "hash"], [".rb", "hash"], [".sh", "hash"], [".bash", "hash"],
  [".zsh", "hash"], [".fish", "hash"], [".pl", "hash"], [".pm", "hash"], [".r", "hash"],
  [".yaml", "hash"], [".yml", "hash"], [".toml", "hash"], [".ps1", "hash"],
  [".html", "html"], [".htm", "html"], [".xml", "html"], [".svg", "html"], [".vue", "html"], [".svelte", "html"],
  [".sql", "sql"], [".lua", "lua"], [".hs", "haskell"], [".lhs", "haskell"],
]);

const SPECIAL_NAMES = new Map<string, Family>([
  ["Dockerfile", "hash"], ["Makefile", "hash"], ["Rakefile", "hash"], ["Gemfile", "hash"],
]);

export function stripCodeComments(content: string, path: string): StripResult {
  const family = familyFor(path);
  if (!family) return { content, removed: 0, supported: false };
  if (family === "hash") return stripHashComments(content, path);
  if (family === "html") return stripHtmlComments(content);
  if (family === "sql") return stripDelimited(content, path, "--", "/*", "*/", false);
  if (family === "lua") return stripLuaComments(content, path);
  if (family === "haskell") return stripDelimited(content, path, "--", "{-", "-}", false);
  return stripDelimited(content, path, "//", "/*", "*/", true);
}

function familyFor(path: string): Family | undefined {
  const name = path.replaceAll("\\", "/").split("/").at(-1) ?? path;
  return SPECIAL_NAMES.get(name) ?? FAMILY_BY_EXTENSION.get(extname(name).toLowerCase());
}

function stripHashComments(content: string, path: string): StripResult {
  const lines = content.split(/(?<=\n)/u);
  let removed = 0;
  const output = lines.map((line, index) => {
    const newline = line.endsWith("\n") ? "\n" : "";
    const body = newline ? line.slice(0, -1) : line;
    const position = hashCommentStart(body);
    if (position < 0) return line;
    const raw = body.slice(position);
    if (isDirective(raw, path, index)) return line;
    removed += 1;
    return `${body.slice(0, position).trimEnd()}${newline}`;
  }).join("");
  return { content: output, removed, supported: true };
}

function hashCommentStart(line: string): number {
  let quote: string | undefined;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === "#") return index;
  }
  return -1;
}

function stripHtmlComments(content: string): StripResult {
  let output = "";
  let cursor = 0;
  let removed = 0;
  while (cursor < content.length) {
    const start = content.indexOf("<!--", cursor);
    if (start < 0) {
      output += content.slice(cursor);
      break;
    }
    const end = content.indexOf("-->", start + 4);
    if (end < 0) {
      output += content.slice(cursor);
      break;
    }
    const raw = content.slice(start, end + 3);
    if (isDirective(raw, "markup", 0)) output += content.slice(cursor, end + 3);
    else {
      output += content.slice(cursor, start) + blankComment(raw);
      removed += 1;
    }
    cursor = end + 3;
  }
  return { content: output, removed, supported: true };
}

function stripLuaComments(content: string, path: string): StripResult {
  return stripDelimited(content, path, "--", "--[[", "]]", false);
}

function stripDelimited(
  content: string,
  path: string,
  lineOpen: string,
  blockOpen: string,
  blockClose: string,
  regexAware: boolean,
): StripResult {
  let output = "";
  let index = 0;
  let removed = 0;
  let quote: string | undefined;
  let escaped = false;
  let regex = false;
  let regexClass = false;
  let previousSignificant = "";
  while (index < content.length) {
    const char = content[index]!;
    if (quote) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = undefined;
      index += 1;
      continue;
    }
    if (regex) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "[") regexClass = true;
      else if (char === "]") regexClass = false;
      else if (char === "/" && !regexClass) regex = false;
      index += 1;
      continue;
    }
    if (content.startsWith(lineOpen, index) && !(index > 0 && content[index - 1] === ":")) {
      const end = content.indexOf("\n", index);
      const stop = end < 0 ? content.length : end;
      const raw = content.slice(index, stop);
      if (isDirective(raw, path, lineNumberAt(content, index))) output += raw;
      else {
        output = output.trimEnd();
        removed += 1;
      }
      index = stop;
      continue;
    }
    if (content.startsWith(blockOpen, index)) {
      const close = content.indexOf(blockClose, index + blockOpen.length);
      if (close < 0) {
        output += char;
        index += 1;
        continue;
      }
      const stop = close + blockClose.length;
      const raw = content.slice(index, stop);
      if (isDirective(raw, path, lineNumberAt(content, index))) output += raw;
      else {
        output += blankComment(raw);
        removed += 1;
      }
      index = stop;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      output += char;
      index += 1;
      continue;
    }
    if (regexAware && char === "/" && regexCanStart(previousSignificant)) {
      regex = true;
      output += char;
      index += 1;
      continue;
    }
    output += char;
    if (!/\s/u.test(char)) previousSignificant = char;
    index += 1;
  }
  return { content: trimLineEnds(output), removed, supported: true };
}

function regexCanStart(previous: string): boolean {
  return previous === "" || "=([{!?:;,>".includes(previous);
}

function blankComment(raw: string): string {
  const newlines = raw.match(/\n/g)?.length ?? 0;
  return newlines === 0 ? " " : "\n".repeat(newlines);
}

function trimLineEnds(content: string): string {
  return content.split("\n").map(line => line.trimEnd()).join("\n");
}

function lineNumberAt(content: string, index: number): number {
  let line = 0;
  for (let cursor = 0; cursor < index; cursor += 1) if (content[cursor] === "\n") line += 1;
  return line;
}

function isDirective(raw: string, path: string, zeroBasedLine: number): boolean {
  const value = raw.trim();
  if (zeroBasedLine === 0 && value.startsWith("#!")) return true;
  if (zeroBasedLine <= 1 && /^#.*(?:coding\s*[:=]|-\*-\s*coding\s*:)/iu.test(value)) return true;
  if (/^#\s*(?:type\s*:|noqa\b|nosec\b|pyright\b|mypy\b|ruff\b|pylint\b|fmt\s*:|pragma\b|isort\b|flake8\b|shellcheck\b|vim\b|region\b|endregion\b)/iu.test(value)) return true;
  if (/^\/\/\/\s*<(?:reference|amd-module|amd-dependency)\b/iu.test(value)) return true;
  if (/^\/\/[#@]\s*(?:sourceMappingURL|sourceURL)=/u.test(value)) return true;
  if (/^\/\/\s*(?:#\s*(?:region|endregion)\b|@ts-(?:ignore|expect-error|nocheck|check)\b|eslint-|biome-ignore\b|deno-lint\b|swiftlint\b|nolint\b|noinspection\b|clang-format\b|prettier-ignore\b|c8\s+ignore\b|istanbul\s+ignore\b)/iu.test(value)) return true;
  if (/^\/\/\s*(?:go:|\+build\b|line\b|swift-tools-version\s*:)/iu.test(value)) return true;
  if (/^\/\*\s*(?:@jsx\b|@jsxFrag\b|@jsxImportSource\b|@flow\b|#__PURE__|@__PURE__|eslint\b|prettier-ignore\b|istanbul\s+ignore\b)/iu.test(value)) return true;
  if (/^<!--\s*\[(?:if|endif)\b/iu.test(value)) return true;
  if (/^<!--\s*(?:svelte:|vue:|markdownlint\b|stylelint\b|prettier-ignore\b)/iu.test(value)) return true;
  if (path.toLowerCase().endsWith(".sql") && /^--\s*(?:liquibase|changeset|rollback|flyway:)/iu.test(value)) return true;
  return false;
}
