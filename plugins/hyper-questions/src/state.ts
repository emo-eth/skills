import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  Answer,
  FormattedAnswer,
  Question,
  QuestionnaireState,
} from "./types.ts";

export const STATE_VERSION = 1;
export const DEFAULT_STATE_FILE = ".hyper-questions-state.json";

/**
 * Computes a deterministic SHA-256 fingerprint for a set of questions.
 * This guarantees that saved state is only resumed against the exact same
 * question definition.
 */
export function computeFingerprint(questions: Question[]): string {
  const normalized = questions.map((q) => ({
    id: q.id.trim(),
    prompt: q.prompt.trim(),
    type: q.type ?? (q.options && q.options.length > 0 ? "select" : "input"),
    options: (q.options ?? []).map((opt) => ({
      value: (opt.value ?? opt.label).trim(),
      label: opt.label.trim(),
      description: opt.description?.trim() ?? "",
    })),
    allowOther: q.allowOther !== false,
    multi: q.multi === true,
  }));

  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/**
 * Reads and validates a previously saved questionnaire state.
 * Returns undefined if the file doesn't exist, is corrupt, or if the
 * fingerprint does not match the expected questions.
 */
export async function readState(
  stateFile: string,
  expectedFingerprint?: string,
): Promise<QuestionnaireState | undefined> {
  try {
    const raw = await readFile(stateFile, "utf8");
    const data = JSON.parse(raw) as Partial<QuestionnaireState>;

    if (
      typeof data !== "object" ||
      data === null ||
      data.version !== STATE_VERSION ||
      typeof data.fingerprint !== "string" ||
      typeof data.answers !== "object" ||
      data.answers === null
    ) {
      return undefined;
    }

    if (expectedFingerprint && data.fingerprint !== expectedFingerprint) {
      return undefined;
    }

    return {
      version: data.version,
      fingerprint: data.fingerprint,
      title: typeof data.title === "string" ? data.title : undefined,
      stateFile,
      answers: data.answers as Record<string, Answer>,
      completed: data.completed === true,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
    };
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}

/**
 * Atomically writes state to disk by writing to a temporary file in the
 * same directory and then renaming it. This ensures no half-written or
 * corrupted state file can ever exist if the host crashes or exits.
 */
export async function writeStateAtomic(
  stateFile: string,
  state: QuestionnaireState,
): Promise<void> {
  const dir = dirname(stateFile);
  await mkdir(dir, { recursive: true });

  const tempFile = `${stateFile}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  const content = JSON.stringify(state, null, 2);

  await writeFile(tempFile, content, "utf8");
  await rename(tempFile, stateFile);
}

/**
 * Safely removes a state file if it exists.
 */
export async function removeState(stateFile: string): Promise<void> {
  try {
    await rm(stateFile, { force: true });
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Builds formatted answers and a clean Markdown presentation of questionnaire results.
 */
export function formatAnswersSummary(
  title: string | undefined,
  questions: Question[],
  answers: Record<string, Answer>,
  completed: boolean,
  stateFile: string,
): { markdown: string; orderedAnswers: FormattedAnswer[] } {
  const orderedAnswers: FormattedAnswer[] = [];
  const lines: string[] = [];

  const heading = title ? `## ${title}` : "## Questionnaire Results";
  lines.push(heading);
  lines.push("");

  const statusText = completed
    ? "**Status:** Completed"
    : `**Status:** Paused / In-progress (saved to \`${stateFile}\`)`;
  lines.push(statusText);
  lines.push("");

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const ans = answers[q.id];
    const headerPrefix = q.header ? `[${q.header}] ` : "";

    if (!ans) {
      lines.push(`### ${i + 1}. ${headerPrefix}${q.prompt}`);
      lines.push("*Not answered yet*");
      lines.push("");
      continue;
    }

    let displayVal: string;
    if (typeof ans.value === "boolean") {
      displayVal = ans.value ? "Yes" : "No";
    } else if (Array.isArray(ans.value)) {
      displayVal = ans.value.join(", ");
    } else if (ans.label && typeof ans.label === "string" && ans.label !== ans.value) {
      displayVal = `${ans.label} (${ans.value})`;
    } else {
      displayVal = String(ans.value);
    }
    if (ans.custom) {
      displayVal += " *(custom input)*";
    }

    orderedAnswers.push({
      id: q.id,
      header: q.header,
      question: q.prompt,
      answer: ans.value,
      custom: ans.custom,
    });

    lines.push(`### ${i + 1}. ${headerPrefix}${q.prompt}`);
    lines.push(`- **Answer:** ${displayVal}`);
    lines.push("");
  }

  return {
    markdown: lines.join("\n").trim(),
    orderedAnswers,
  };
}
