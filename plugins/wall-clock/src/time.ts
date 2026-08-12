import type { DeadlineInput } from "./types.ts";

const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/i;
const CLOCK_TIME = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;

export function parseDurationMs(value: string): number {
  const match = DURATION.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: ${value}`);

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "m" ? 60_000 : 3_600_000;
  const durationMs = Math.round(amount * multiplier);
  if (!Number.isFinite(durationMs) || durationMs < 1) throw new Error(`Duration must be positive: ${value}`);
  return durationMs;
}

export function parseLocalDeadlineMs(value: string, now = new Date()): number {
  const match = CLOCK_TIME.exec(value.trim());
  if (!match) throw new Error(`Invalid local time: ${value}`);

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();

  if (minute > 59) throw new Error(`Invalid minute: ${value}`);
  if (meridiem) {
    if (hour < 1 || hour > 12) throw new Error(`Invalid hour: ${value}`);
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    throw new Error(`Invalid hour: ${value}`);
  }

  const deadline = new Date(now);
  deadline.setHours(hour, minute, 0, 0);
  if (deadline.getTime() <= now.getTime()) deadline.setDate(deadline.getDate() + 1);
  return deadline.getTime();
}

export function parseDeadlineSpec(value: string, nowMs = Date.now()): DeadlineInput {
  const normalized = value.trim();
  if (DURATION.test(normalized)) {
    return { durationMs: parseDurationMs(normalized) };
  }
  return { deadlineMs: parseLocalDeadlineMs(normalized, new Date(nowMs)) };
}

export function phaseAt(nowMs: number, hardDeadline: number, wrapUpAt: number, complete = false): "active" | "wrap-up" | "expired" | "complete" {
  if (complete) return "complete";
  if (nowMs >= hardDeadline) return "expired";
  if (nowMs >= wrapUpAt) return "wrap-up";
  return "active";
}

export function formatDurationMs(ms: number): string {
  const wholeMilliseconds = Math.max(0, Math.floor(ms));
  if (wholeMilliseconds === 0) return "0s";
  if (wholeMilliseconds < 1_000) return `${wholeMilliseconds}ms`;
  const seconds = Math.floor(wholeMilliseconds / 1_000);
  const remainingMilliseconds = wholeMilliseconds % 1_000;
  if (seconds < 60) return remainingMilliseconds ? `${seconds}s ${remainingMilliseconds}ms` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
