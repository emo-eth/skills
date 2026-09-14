import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SELF_PLUGIN_ID,
  updatePlugins,
  type ExecResult,
  type GithubSource,
  type Runner,
} from "../src/core.ts";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

type PluginSource = GithubSource | { kind: "local" };

type PluginRecord = {
  pluginId: string;
  source: PluginSource;
  enabled: boolean;
};

function ok(stdout: string): ExecResult {
  return { status: 0, stdout, stderr: "" };
}

function source(overrides: Partial<GithubSource> = {}): GithubSource {
  return {
    kind: "github",
    owner: "emo-eth",
    repo: "skills",
    subdir: "plugins/demo",
    resolved_commit: SHA_A,
    managed_path: "/managed/demo",
    ...overrides,
  };
}

function updaterSource(): GithubSource {
  return {
    kind: "github",
    owner: "emo-eth",
    repo: "skills",
    subdir: "plugins/plugin-updater",
    resolved_commit: SHA_A,
    managed_path: "/managed/plugin-updater",
  };
}

function hardRestartSource(): GithubSource {
  return {
    kind: "github",
    owner: "emo-eth",
    repo: "skills",
    subdir: "plugins/hard-update-restart",
    resolved_commit: SHA_A,
    managed_path: "/managed/hard-update-restart",
  };
}

function pluginIdFromInstallSpec(spec: string): string | undefined {
  if (spec === "emo-eth/skills/plugins/demo") return "demo";
  if (spec === "emo-eth/skills/plugins/plugin-updater") return SELF_PLUGIN_ID;
  if (spec === "emo-eth/skills/plugins/hard-update-restart") return "hard-update-restart";
  if (spec === "emo-eth/skills/plugins/disabled-demo") return "disabled-demo";
  return undefined;
}

class PluginRegistry {
  readonly plugins = new Map<string, PluginRecord>();
  installCount = 0;
  private installWaiters: Array<() => void> = [];
  private startedPluginIds: string[] = [];
  private startedWaiters: Array<(pluginId: string) => void> = [];
  private barrierObservedWaiters: Array<() => void> = [];

  constructor(entries: PluginRecord[]) {
    for (const entry of entries) {
      this.plugins.set(entry.pluginId, {
        pluginId: entry.pluginId,
        source: { ...entry.source },
        enabled: entry.enabled,
      });
    }
  }

  getSha(pluginId: string): string | undefined {
    const pluginSource = this.plugins.get(pluginId)?.source;
    return pluginSource?.kind === "github" ? pluginSource.resolved_commit : undefined;
  }

  isEnabled(pluginId: string): boolean | undefined {
    return this.plugins.get(pluginId)?.enabled;
  }

  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  listJson(): string {
    const plugins = [...this.plugins.values()].map((entry) => ({
      plugin_id: entry.pluginId,
      enabled: entry.enabled,
      source: entry.source,
    }));
    return JSON.stringify({ id: "cli:plugin", result: { plugins } });
  }

  releaseNextInstall(): void {
    const release = this.installWaiters.shift();
    if (!release) {
      throw new Error("no install waiting on barrier");
    }
    release();
  }

  waitForInstallStarted(): Promise<string> {
    const pending = this.startedPluginIds.shift();
    if (pending) {
      return Promise.resolve(pending);
    }
    return new Promise((resolve) => {
      this.startedWaiters.push(resolve);
    });
  }

  async releaseWhenStarted(): Promise<string> {
    const pluginId = await this.waitForInstallStarted();
    this.releaseNextInstall();
    return pluginId;
  }

  async awaitBatch(batch: Promise<void>): Promise<void> {
    if (this.installWaiters.length > 0) {
      throw new Error(
        `${this.installWaiters.length} install(s) still waiting on barrier`,
      );
    }
    const surpriseBarrier = new Promise<never>((_, reject) => {
      this.barrierObservedWaiters.push(() => {
        reject(
          new Error(
            "install reached barrier before batch completed; await releaseWhenStarted first",
          ),
        );
      });
    });
    await Promise.race([batch, surpriseBarrier]);
  }

  private notifyInstallStarted(pluginId: string): void {
    const waiter = this.startedWaiters.shift();
    if (waiter) {
      waiter(pluginId);
      return;
    }
    this.startedPluginIds.push(pluginId);
  }

  private notifyInstallBarrier(): void {
    const waiter = this.barrierObservedWaiters.shift();
    if (waiter) {
      waiter();
    }
  }

  createRunner(): Runner {
    return (executable, args) => {
      const key = [executable, ...args].join(" ");

      if (key === "herdr plugin list --json") {
        return Promise.resolve(ok(this.listJson()));
      }

      if (args[0] === "plugin" && args[1] === "install") {
        const spec = args[2];
        const pluginId = pluginIdFromInstallSpec(spec);
        if (!pluginId) {
          return Promise.reject(new Error(`unexpected install spec: ${spec}`));
        }
        this.installCount += 1;
        this.notifyInstallStarted(pluginId);
        const { promise, resolve } = Promise.withResolvers<ExecResult>();
        this.installWaiters.push(() => {
          const record = this.plugins.get(pluginId);
          if (record?.source.kind === "github") {
            record.source.resolved_commit = SHA_B;
          }
          resolve(ok(""));
        });
        this.notifyInstallBarrier();
        return promise;
      }

      if (args[0] === "plugin" && args[1] === "disable") {
        const pluginId = args[2];
        const record = this.plugins.get(pluginId);
        if (record) {
          record.enabled = false;
        }
        return Promise.resolve(ok(""));
      }

      if (args[0] === "ls-remote" && args[1] === "--symref") {
        return Promise.resolve(
          ok(`ref:\trefs/heads/main\tHEAD\n${SHA_B}\tHEAD\n${SHA_A}\trefs/heads/main\n`),
        );
      }

      if (args[0] === "-C" && args.includes("fetch")) {
        return Promise.resolve(ok(""));
      }

      if (args[0] === "-C" && args.includes("diff") && args.includes("--shortstat")) {
        return Promise.resolve(ok("1 file changed, 1 insertion(+)\n"));
      }

      if (args[0] === "-C" && args.includes("show")) {
        const remote = args[args.length - 1]?.startsWith("FETCH_HEAD:");
        return Promise.resolve(ok(remote ? 'version = "0.1.1"\n' : 'version = "0.1.0"\n'));
      }

      return Promise.reject(new Error(`unexpected command: ${key}`));
    };
  }
}

test("updatePlugins refuses unclassifiable plugins before any install", async () => {
  const registry = new PluginRegistry([
    {
      pluginId: "broken",
      enabled: true,
      source: source({ subdir: "plugins/broken", managed_path: "/managed/broken", resolved_commit: undefined }),
    },
    { pluginId: "demo", enabled: true, source: source() },
  ]);

  await assert.rejects(
    () => updatePlugins(registry.createRunner(), "herdr", () => {}),
    /Refusing to update plugins: broken could not be classified/,
  );
  assert.equal(registry.installCount, 0);
  assert.equal(registry.getSha("demo"), SHA_A);
  assert.equal(registry.getSha("broken"), undefined);
});

test("updatePlugins finishes installs before returning", async () => {
  const registry = new PluginRegistry([
    { pluginId: SELF_PLUGIN_ID, enabled: true, source: updaterSource() },
    { pluginId: "hard-update-restart", enabled: true, source: hardRestartSource() },
    { pluginId: "demo", enabled: true, source: source() },
  ]);
  const runner = registry.createRunner();

  const batch = updatePlugins(runner, "herdr", () => {});
  assert.equal(registry.installCount, 0);
  assert.equal(registry.getSha("demo"), SHA_A);
  assert.equal(registry.getSha(SELF_PLUGIN_ID), SHA_A);

  await registry.releaseWhenStarted();
  await registry.releaseWhenStarted();

  await registry.releaseWhenStarted();
  await registry.awaitBatch(batch);

  assert.equal(registry.installCount, 3);
  assert.equal(registry.getSha("demo"), SHA_B);
  assert.equal(registry.getSha("hard-update-restart"), SHA_B);
  assert.equal(registry.getSha(SELF_PLUGIN_ID), SHA_B);
  assert.equal(registry.isEnabled(SELF_PLUGIN_ID), true);
});

test("updatePlugins updates behind plugins and leaves pinned, local, and current untouched", async () => {
  const registry = new PluginRegistry([
    {
      pluginId: "current",
      enabled: true,
      source: source({ resolved_commit: SHA_B, managed_path: "/managed/current" }),
    },
    {
      pluginId: "pinned",
      enabled: true,
      source: source({
        requested_ref: SHA_A,
        managed_path: "/managed/pinned",
      }),
    },
    {
      pluginId: "disabled-demo",
      enabled: false,
      source: source({
        subdir: "plugins/disabled-demo",
        managed_path: "/managed/disabled-demo",
      }),
    },
    { pluginId: "demo", enabled: true, source: source() },
    { pluginId: "local-only", enabled: true, source: { kind: "local" } },
  ]);
  const runner = registry.createRunner();

  const batch = updatePlugins(runner, "herdr", () => {});
  await registry.releaseWhenStarted();
  await registry.releaseWhenStarted();
  await registry.awaitBatch(batch);

  assert.equal(registry.getSha("demo"), SHA_B);
  assert.equal(registry.getSha("disabled-demo"), SHA_B);
  assert.equal(registry.isEnabled("disabled-demo"), false);
  assert.equal(registry.getSha("current"), SHA_B);
  assert.equal(registry.getSha("pinned"), SHA_A);
  assert.equal(registry.installCount, 2);
  assert.equal(registry.has("local-only"), true);
  assert.equal(registry.getSha("local-only"), undefined);
});
