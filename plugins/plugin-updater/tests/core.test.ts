import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyOutcome,
  collectOutcomes,
  formatReport,
  minHerdrHint,
  parseLsRemote,
  parseManifestVersion,
  parsePluginList,
  reinstallArgs,
  resolveTrackedRef,
  sortForUpdate,
  type CheckOutcome,
  type ExecResult,
  type GithubSource,
  type Runner,
} from "../src/core.ts";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SHA_C = "cccccccccccccccccccccccccccccccccccccccc";

function ok(stdout: string): ExecResult {
  return { status: 0, stdout, stderr: "" };
}

function failed(stderr: string): ExecResult {
  return { status: 1, stdout: "", stderr };
}

function pluginListJson(entries: object[]): string {
  return JSON.stringify({ id: "cli:plugin", result: { plugins: entries } });
}

function source(overrides: Partial<GithubSource> = {}): GithubSource {
  return {
    kind: "github",
    owner: "octo",
    repo: "demo-plugin",
    resolved_commit: SHA_A,
    managed_path: "/managed/demo",
    ...overrides,
  };
}

type Route = { command: string[]; result: ExecResult };

function routingRunner(routes: Route[]): { runner: Runner; calls: string[] } {
  const calls: string[] = [];
  const runner: Runner = (executable, args) => {
    const key = [executable, ...args].join(" ");
    calls.push(key);
    const route = routes.find((candidate) => candidate.command.join(" ") === key);
    if (!route) {
      return Promise.reject(new Error(`unexpected command: ${key}`));
    }
    return Promise.resolve(route.result);
  };
  return { runner, calls };
}

test("parsePluginList extracts GitHub plugins and counts local plugins", () => {
  const raw = pluginListJson([
    { plugin_id: "demo", source: source() },
    { plugin_id: "dev", source: { kind: "local" } },
    { plugin_id: "dev2", source: { kind: "local" } },
  ]);
  const parsed = parsePluginList(raw);
  assert.equal(parsed.github.length, 1);
  assert.equal(parsed.localCount, 2);
  assert.equal(parsed.github[0].pluginId, "demo");
  assert.equal(parsed.github[0].source.owner, "octo");
  assert.equal(parsed.github[0].source.subdir, undefined);
  assert.equal(parsed.github[0].source.requested_ref, undefined);
});

test("parsePluginList rejects invalid payloads", () => {
  assert.throws(() => parsePluginList("not json"), /invalid plugin-list JSON/);
  assert.throws(() => parsePluginList("{}"), /invalid plugin-list response/);
  assert.throws(
    () => parsePluginList(pluginListJson([{ source: { kind: "local" } }])),
    /without an id/,
  );
  assert.throws(
    () => parsePluginList(pluginListJson([{ plugin_id: "x" }])),
    /no source/,
  );
  assert.throws(
    () =>
      parsePluginList(
        pluginListJson([{ plugin_id: "x", source: { kind: "github", owner: "o" } }]),
      ),
    /incomplete GitHub source/,
  );
});

test("parseLsRemote reads the default branch, HEAD sha, and refs", () => {
  const refs = parseLsRemote(
    `ref:\trefs/heads/main\tHEAD\n` +
      `${SHA_B}\tHEAD\n` +
      `${SHA_A}\trefs/heads/main\n` +
      `${SHA_B}\trefs/heads/release\n` +
      `${SHA_C}\trefs/tags/v1\n`,
  );
  assert.equal(refs.defaultBranch, "main");
  assert.equal(refs.headSha, SHA_B);
  assert.equal(refs.refs.length, 3);
});

test("parseLsRemote tolerates a remote without a symref HEAD", () => {
  const refs = parseLsRemote(`${SHA_B}\tHEAD\n${SHA_A}\trefs/heads/main\n`);
  assert.equal(refs.defaultBranch, null);
  assert.equal(refs.headSha, SHA_B);
});

test("resolveTrackedRef defaults to the remote default branch", () => {
  const tracked = resolveTrackedRef(undefined, {
    defaultBranch: "main",
    headSha: SHA_B,
    refs: [],
  });
  assert.deepEqual(tracked, { kind: "branch", name: "main", sha: SHA_B });
});

test("resolveTrackedRef follows a requested branch", () => {
  const tracked = resolveTrackedRef("release", {
    defaultBranch: "main",
    headSha: SHA_B,
    refs: [{ sha: SHA_A, name: "refs/heads/release" }],
  });
  assert.deepEqual(tracked, { kind: "branch", name: "release", sha: SHA_A });
});

test("resolveTrackedRef pins tags, commit shas, and unknown refs", () => {
  const tagRemote = {
    defaultBranch: "main",
    headSha: SHA_B,
    refs: [{ sha: SHA_C, name: "refs/tags/v1" }],
  };
  assert.deepEqual(resolveTrackedRef("v1", tagRemote), {
    kind: "pinned",
    name: "v1",
    sha: SHA_C,
    reason: "installed at a tag",
  });
  assert.deepEqual(resolveTrackedRef(SHA_A, tagRemote), {
    kind: "pinned",
    name: SHA_A,
    sha: SHA_A,
    reason: "installed at a commit",
  });
  assert.deepEqual(resolveTrackedRef("missing", tagRemote), {
    kind: "pinned",
    name: "missing",
    sha: null,
    reason: "ref not found on remote",
  });
});

test("classifyOutcome compares the tracked branch head with the install", () => {
  const branch = { kind: "branch" as const, name: "main", sha: SHA_B };
  assert.equal(classifyOutcome(source(), branch).classification, "behind");
  assert.equal(
    classifyOutcome(source({ resolved_commit: SHA_B }), branch).classification,
    "current",
  );
  assert.equal(
    classifyOutcome(source({ resolved_commit: undefined }), branch).classification,
    "error",
  );
});

test("classifyOutcome reports a moved pin target", () => {
  const tag = { kind: "pinned" as const, name: "v1", sha: SHA_C, reason: "installed at a tag" };
  const moved = classifyOutcome(source(), tag);
  assert.equal(moved.classification, "pinned");
  assert.match(moved.detail ?? "", /pin target moved/);
  const same = classifyOutcome(source({ resolved_commit: SHA_C }), tag);
  assert.equal(same.classification, "pinned");
  assert.doesNotMatch(same.detail ?? "", /moved/);
});

test("parseManifestVersion reads only the top-level version", () => {
  assert.equal(parseManifestVersion('id = "x"\nversion = "1.2.3"\n'), "1.2.3");
  assert.equal(
    parseManifestVersion('version = "1.0.0"\n[[actions]]\nversion = "9.9.9"\n'),
    "1.0.0",
  );
  assert.equal(parseManifestVersion('[[actions]]\nversion = "9.9.9"\n'), undefined);
  assert.equal(parseManifestVersion(""), undefined);
});

test("reinstallArgs builds the reinstall command and preserves requested refs", () => {
  const root = { pluginId: "demo", source: source(), classification: "behind" } as CheckOutcome;
  assert.deepEqual(reinstallArgs(root), [
    "plugin",
    "install",
    "octo/demo-plugin",
    "--yes",
  ]);
  const pinned = {
    pluginId: "demo",
    source: source({ subdir: "packages/demo", requested_ref: "release" }),
    classification: "behind",
  } as CheckOutcome;
  assert.deepEqual(reinstallArgs(pinned), [
    "plugin",
    "install",
    "octo/demo-plugin/packages/demo",
    "--ref",
    "release",
    "--yes",
  ]);
});

test("sortForUpdate keeps the updater itself last", () => {
  const outcomes = [
    { pluginId: "plugin-updater", classification: "behind" },
    { pluginId: "other", classification: "behind" },
  ] as CheckOutcome[];
  assert.deepEqual(
    sortForUpdate(outcomes).map((outcome) => outcome.pluginId),
    ["other", "plugin-updater"],
  );
});

test("minHerdrHint flags minimum-version refusals only", () => {
  assert.match(
    minHerdrHint("install failed: plugin min_herdr_version 0.9.0 exceeds this binary") ?? "",
    /newer Herdr binary/,
  );
  assert.equal(minHerdrHint("fatal: repository not found"), null);
});

test("formatReport lists outcomes and the local exclusion count", () => {
  const outcomes = [
    {
      pluginId: "demo",
      source: source(),
      trackedRef: { kind: "branch", name: "main", sha: SHA_B },
      remoteSha: SHA_B,
      classification: "behind",
      preview: { installedVersion: "1.0.0", remoteVersion: "1.1.0" },
    },
    {
      pluginId: "stale",
      source: source({ owner: "octo", repo: "other", requested_ref: "v1" }),
      trackedRef: { kind: "pinned", name: "v1", sha: SHA_C, reason: "installed at a tag" },
      classification: "pinned",
      detail: "pinned: installed at a tag",
    },
    {
      pluginId: "frozen",
      source: source({ owner: "octo", repo: "frozen", requested_ref: SHA_C }),
      trackedRef: {
        kind: "pinned",
        name: SHA_C,
        sha: SHA_C,
        reason: "installed at a commit",
      },
      classification: "pinned",
      detail: "pinned: installed at a commit",
    },
  ] as CheckOutcome[];
  const report = formatReport(outcomes, 2);
  assert.match(report, /behind\s+demo/);
  assert.match(report, /1\.0\.0 -> 1\.1\.0/);
  assert.match(report, /pinned\s+stale\s+v1/);
  assert.match(report, /pinned\s+frozen\s+@ccccccc/);
  assert.match(report, /1 behind, 0 current, 2 pinned, 0 error; 2 local plugins excluded/);
});

test("collectOutcomes classifies behind plugins and collects previews", async () => {
  const { runner, calls } = routingRunner([
    {
      command: ["herdr", "plugin", "list", "--json"],
      result: ok(pluginListJson([{ plugin_id: "demo", source: source() }])),
    },
    {
      command: ["git", "ls-remote", "--symref", "https://github.com/octo/demo-plugin"],
      result: ok(
        `ref:\trefs/heads/main\tHEAD\n${SHA_B}\tHEAD\n${SHA_A}\trefs/heads/main\n`,
      ),
    },
    {
      command: ["git", "-C", "/managed/demo", "fetch", "--quiet", "origin", "main"],
      result: ok(""),
    },
    {
      command: [
        "git",
        "-C",
        "/managed/demo",
        "diff",
        "--shortstat",
        `${SHA_A}..FETCH_HEAD`,
      ],
      result: ok(" 3 files changed, 4 insertions(+)\n"),
    },
    {
      command: ["git", "-C", "/managed/demo", "show", `${SHA_A}:herdr-plugin.toml`],
      result: ok('version = "1.0.0"\n[[actions]]\nversion = "ignored"\n'),
    },
    {
      command: ["git", "-C", "/managed/demo", "show", "FETCH_HEAD:herdr-plugin.toml"],
      result: ok('version = "1.1.0"\n'),
    },
  ]);
  const { outcomes, localCount } = await collectOutcomes(runner, "herdr");
  assert.equal(localCount, 0);
  assert.equal(outcomes.length, 1);
  const outcome = outcomes[0];
  assert.equal(outcome.classification, "behind");
  assert.equal(outcome.remoteSha, SHA_B);
  assert.deepEqual(outcome.preview, {
    installedVersion: "1.0.0",
    remoteVersion: "1.1.0",
    changedFiles: "3 files changed, 4 insertions(+)",
  });
  // The version inside the [[actions]] table must not win.
  assert.equal(outcome.preview?.remoteVersion, "1.1.0");
  assert.ok(calls.includes("git -C /managed/demo diff --shortstat " + `${SHA_A}..FETCH_HEAD`));
});

test("collectOutcomes reports current plugins without fetching", async () => {
  const { runner, calls } = routingRunner([
    {
      command: ["herdr", "plugin", "list", "--json"],
      result: ok(
        pluginListJson([{ plugin_id: "demo", source: source({ resolved_commit: SHA_B }) }]),
      ),
    },
    {
      command: ["git", "ls-remote", "--symref", "https://github.com/octo/demo-plugin"],
      result: ok(`ref:\trefs/heads/main\tHEAD\n${SHA_B}\tHEAD\n`),
    },
  ]);
  const { outcomes } = await collectOutcomes(runner, "herdr");
  assert.equal(outcomes[0].classification, "current");
  assert.equal(
    calls.filter((call) => call.includes(" fetch ")).length,
    0,
    "current plugins must not be fetched",
  );
});

test("collectOutcomes scopes subdir previews to the plugin directory", async () => {
  const { runner } = routingRunner([
    {
      command: ["herdr", "plugin", "list", "--json"],
      result: ok(
        pluginListJson([
          { plugin_id: "demo", source: source({ subdir: "packages/demo" }) },
        ]),
      ),
    },
    {
      command: ["git", "ls-remote", "--symref", "https://github.com/octo/demo-plugin"],
      result: ok(`ref:\trefs/heads/main\tHEAD\n${SHA_B}\tHEAD\n`),
    },
    {
      command: ["git", "-C", "/managed/demo", "fetch", "--quiet", "origin", "main"],
      result: ok(""),
    },
    {
      command: [
        "git",
        "-C",
        "/managed/demo",
        "diff",
        "--shortstat",
        `${SHA_A}..FETCH_HEAD`,
        "--",
        "packages/demo",
      ],
      result: ok(" 2 files changed\n"),
    },
    {
      command: [
        "git",
        "-C",
        "/managed/demo",
        "show",
        `${SHA_A}:packages/demo/herdr-plugin.toml`,
      ],
      result: ok('version = "2.0.0"\n'),
    },
    {
      command: [
        "git",
        "-C",
        "/managed/demo",
        "show",
        "FETCH_HEAD:packages/demo/herdr-plugin.toml",
      ],
      result: ok('version = "2.1.0"\n'),
    },
  ]);
  const { outcomes } = await collectOutcomes(runner, "herdr");
  assert.equal(outcomes[0].classification, "behind");
  assert.deepEqual(outcomes[0].preview, {
    installedVersion: "2.0.0",
    remoteVersion: "2.1.0",
    changedFiles: "2 files changed",
  });
});

test("collectOutcomes records ls-remote failures without aborting the check", async () => {
  const { runner } = routingRunner([
    {
      command: ["herdr", "plugin", "list", "--json"],
      result: ok(
        pluginListJson([
          { plugin_id: "broken", source: source({ repo: "gone" }) },
          {
            plugin_id: "fine",
            source: source({ repo: "fine", resolved_commit: SHA_B, managed_path: "/m2" }),
          },
        ]),
      ),
    },
    {
      command: ["git", "ls-remote", "--symref", "https://github.com/octo/gone"],
      result: failed("fatal: repository not found\n"),
    },
    {
      command: ["git", "ls-remote", "--symref", "https://github.com/octo/fine"],
      result: ok(`ref:\trefs/heads/main\tHEAD\n${SHA_B}\tHEAD\n`),
    },
  ]);
  const { outcomes } = await collectOutcomes(runner, "herdr");
  const broken = outcomes.find((outcome) => outcome.pluginId === "broken");
  assert.equal(broken?.classification, "error");
  assert.match(broken?.detail ?? "", /repository not found/);
  assert.equal(
    outcomes.find((outcome) => outcome.pluginId === "fine")?.classification,
    "current",
  );
});

test("collectOutcomes excludes local plugins entirely", async () => {
  const { runner } = routingRunner([
    {
      command: ["herdr", "plugin", "list", "--json"],
      result: ok(
        pluginListJson([
          { plugin_id: "dev", source: { kind: "local" } },
        ]),
      ),
    },
  ]);
  const { outcomes, localCount } = await collectOutcomes(runner, "herdr");
  assert.equal(outcomes.length, 0);
  assert.equal(localCount, 1);
});

test("collectOutcomes throws when the plugin list fails", async () => {
  const { runner } = routingRunner([
    { command: ["herdr", "plugin", "list", "--json"], result: failed("socket closed\n") },
  ]);
  await assert.rejects(collectOutcomes(runner, "herdr"), /socket closed/);
});
