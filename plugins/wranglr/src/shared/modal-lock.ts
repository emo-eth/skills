import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { stateDirectory } from "./store.ts";

const MARKER_NAME = "attention-owner.json";

export type AttentionOwner = {
  pid: number;
  started_at: number;
};

export function markerPath(): string {
  return join(stateDirectory(), MARKER_NAME);
}

export function readOwner(): AttentionOwner | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(markerPath(), "utf8"));
    if (!parsed || typeof parsed !== "object") return undefined;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.pid !== "number"
      || !Number.isInteger(record.pid)
      || record.pid <= 0
    ) {
      return undefined;
    }
    return {
      pid: record.pid,
      started_at: typeof record.started_at === "number" ? record.started_at : 0,
    };
  } catch {
    return undefined;
  }
}

export function ownerAlive(owner: AttentionOwner | undefined): boolean {
  if (!owner) return false;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function popupOpen(): boolean {
  const owner = readOwner();
  if (ownerAlive(owner)) return true;
  removeMarker();
  return false;
}

export function claimOwner(): AttentionOwner | undefined {
  const owner = { pid: process.pid, started_at: Date.now() };
  const path = markerPath();
  mkdirSync(dirname(path), { recursive: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      writeFileSync(path, `${JSON.stringify(owner)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      return owner;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = readOwner();
      if (ownerAlive(existing)) return undefined;
      removeMarker();
    }
  }
  return undefined;
}

export function releaseOwner(owner?: AttentionOwner): void {
  const current = readOwner();
  if (!current || current.pid !== process.pid) return;
  if (
    owner
    && (current.pid !== owner.pid || current.started_at !== owner.started_at)
  ) {
    return;
  }
  removeMarker();
}

function removeMarker(): void {
  try {
    unlinkSync(markerPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
