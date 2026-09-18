import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import test from "node:test";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  installTenetExtension,
  type ExtensionApi,
  type ExtensionContext,
  tenetLogPath,
} from "../src/index.ts";
import tenetOmpExtension from "../src/omp.ts";
import tenetPiExtension from "../src/pi.ts";

type RegisteredCommand = Parameters<ExtensionApi["registerCommand"]>[1];

class FakeApi implements ExtensionApi {
  command?: RegisteredCommand;

  registerCommand(_name: string, options: RegisteredCommand): void {
    this.command = options;
  }
}

function context(notifications: string[]): ExtensionContext {
  return {
    cwd: "/workspace/demo/src",
    model: { id: "test-model" },
    sessionManager: {
      getSessionId: () => "session-123",
      getSessionName: () => "tenet test",
    },
    ui: {
      notify: (message, level) => notifications.push(`${level}:${message}`),
    },
  };
}

test("Pi and OMP entrypoints both register the local command", () => {
  for (const extension of [tenetPiExtension, tenetOmpExtension]) {
    const api = new FakeApi();
    extension(api);
    assert.ok(api.command);
  }
});

test("tenet records a standing invariant with host and session metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "tenet-test-"));
  const path = join(root, "tenets.ndjson");
  const previousPath = process.env.TENETS_PATH;
  process.env.TENETS_PATH = path;

  try {
    const api = new FakeApi();
    const notifications: string[] = [];
    installTenetExtension(api, "omp");
    assert.ok(api.command);

    await api.command.handler("  always be able to open files in Cursor remotely  ", context(notifications));

    const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(record.schema, "tenet.v1");
    assert.match(String(record.id), /^[0-9a-f-]{36}$/);
    assert.match(String(record.recordedAt), /^20\d\d-\d\d-\d\dT/);
    assert.equal(record.tenet, "always be able to open files in Cursor remotely");
    assert.equal(record.host, "omp");
    assert.equal(record.cwd, "/workspace/demo/src");
    assert.equal(record.sessionId, "session-123");
    assert.equal(record.sessionName, "tenet test");
    assert.equal(record.model, "test-model");
    assert.match(notifications[0] ?? "", /^info:Tenet recorded in /);
  } finally {
    if (previousPath === undefined) delete process.env.TENETS_PATH;
    else process.env.TENETS_PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("tenet rejects empty input without creating a record", async () => {
  const root = mkdtempSync(join(tmpdir(), "tenet-empty-test-"));
  const path = join(root, "tenets.ndjson");
  const previousPath = process.env.TENETS_PATH;
  process.env.TENETS_PATH = path;

  try {
    const api = new FakeApi();
    const notifications: string[] = [];
    installTenetExtension(api, "pi");
    assert.ok(api.command);

    await api.command.handler(" \t", context(notifications));

    assert.equal(existsSync(path), false);
    assert.deepEqual(notifications, ["error:Usage: /tenet <standing invariant>"]);
  } finally {
    if (previousPath === undefined) delete process.env.TENETS_PATH;
    else process.env.TENETS_PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("tenet uses the default global path when no override is set", () => {
  const previousPath = process.env.TENETS_PATH;
  delete process.env.TENETS_PATH;
  try {
    assert.equal(tenetLogPath(), join(homedir(), ".tenet", "tenets.ndjson"));
  } finally {
    if (previousPath !== undefined) process.env.TENETS_PATH = previousPath;
  }
});
