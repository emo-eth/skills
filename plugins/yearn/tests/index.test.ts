import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import test from "node:test";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  installYearnExtension,
  type ExtensionApi,
  type ExtensionContext,
  yearnLogPath,
} from "../src/index.ts";

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
      getSessionName: () => "yearn test",
    },
    ui: {
      notify: (message, level) => notifications.push(`${level}:${message}`),
    },
  };
}

test("yearn records a wish with host and session metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "yearn-test-"));
  const path = join(root, "yearnings.ndjson");
  const previousPath = process.env.YEARNINGS_PATH;
  process.env.YEARNINGS_PATH = path;

  try {
    const api = new FakeApi();
    const notifications: string[] = [];
    installYearnExtension(api, "omp");
    assert.ok(api.command);

    await api.command.handler("  i want a yearn command in omp  ", context(notifications));

    const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(record.schema, "yearn.v1");
    assert.match(String(record.id), /^[0-9a-f-]{36}$/);
    assert.match(String(record.recordedAt), /^20\d\d-\d\d-\d\dT/);
    assert.equal(record.wish, "i want a yearn command in omp");
    assert.equal(record.host, "omp");
    assert.equal(record.cwd, "/workspace/demo/src");
    assert.equal(record.sessionId, "session-123");
    assert.equal(record.sessionName, "yearn test");
    assert.equal(record.model, "test-model");
    assert.match(notifications[0] ?? "", /^info:Yearn recorded in /);
  } finally {
    if (previousPath === undefined) delete process.env.YEARNINGS_PATH;
    else process.env.YEARNINGS_PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("yearn rejects an empty wish without creating a record", async () => {
  const root = mkdtempSync(join(tmpdir(), "yearn-empty-test-"));
  const path = join(root, "yearnings.ndjson");
  const previousPath = process.env.YEARNINGS_PATH;
  process.env.YEARNINGS_PATH = path;

  try {
    const api = new FakeApi();
    const notifications: string[] = [];
    installYearnExtension(api, "pi");
    assert.ok(api.command);

    await api.command.handler(" \t", context(notifications));

    assert.equal(existsSync(path), false);
    assert.deepEqual(notifications, ["error:Usage: /yearn <want or wish>"]);
  } finally {
    if (previousPath === undefined) delete process.env.YEARNINGS_PATH;
    else process.env.YEARNINGS_PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("yearn uses the default global path when no override is set", () => {
  const previousPath = process.env.YEARNINGS_PATH;
  delete process.env.YEARNINGS_PATH;
  try {
    assert.equal(yearnLogPath(), join(homedir(), ".yearn", "yearnings.ndjson"));
  } finally {
    if (previousPath !== undefined) process.env.YEARNINGS_PATH = previousPath;
  }
});
