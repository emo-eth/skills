// Shared interactive-prompt helpers for the Linear ticket CLIs.
//
// Both `prioritize-linear-tickets.ts` and `star-linear-tickets.ts` read
// answers the same way: a TTY offers live single-key input, a non-TTY (tests,
// pipes) consumes line-delimited scripted input lazily. Keeping this in one
// module avoids a second, drifting convention.

import { createInterface } from "node:readline/promises";

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";

export const useColor = Boolean(
  process.stdout.isTTY && process.env.NO_COLOR === undefined,
);

export function paint(value: string, color: string): string {
  return useColor ? `${color}${value}${RESET}` : value;
}

export function clearScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write("\u001b[2J\u001b[3J\u001b[H");
  }
}

// Scripted (non-TTY) answers for tests and piping. Read lazily from the stdin
// stream so a human run or --help never blocks on a stream read.
let scriptedInput: string[] | undefined;

async function readScriptedAnswers(): Promise<string[]> {
  if (scriptedInput !== undefined) return scriptedInput;
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const chunks: Buffer[] = [];
  process.stdin.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  process.stdin.on("error", reject);
  process.stdin.resume();
  scriptedInput = (await promise)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return scriptedInput;
}

export async function nextScriptedAnswer(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const answers = await readScriptedAnswers();
  return answers.shift();
}

export async function readLine(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return (await nextScriptedAnswer()) ?? "";
  }
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await reader.question(prompt);
  } finally {
    reader.close();
  }
}

export async function confirmExact(prompt: string, expected: string): Promise<boolean> {
  const answer = await readLine(prompt);
  return answer.trim() === expected;
}

/** Full-screen render helper for a single-key choice with raw-mode fallback. */
export async function rawChoice(
  prompt: string,
  normalize: (input: string) => string | "pause" | undefined,
): Promise<string | "pause"> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    const answer = (await nextScriptedAnswer()) ?? "";
    return normalize(answer) ?? "pause";
  }
  process.stdin.resume();
  process.stdin.setRawMode(true);
  return new Promise((resolve) => {
    const finish = (result: string | "pause"): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
      resolve(result);
    };
    const onData = (chunk: Buffer | string): void => {
      const input = chunk.toString();
      if (input.includes("\u0003")) return finish("pause");
      if (input.includes("\u001b[C") || input.includes("\u001bOC")) {
        return finish("right");
      }
      if (input.includes("\u001b[D") || input.includes("\u001bOD")) {
        return finish("left");
      }
      const result = normalize(input);
      if (result) finish(result);
    };
    process.stdin.on("data", onData);
  });
}