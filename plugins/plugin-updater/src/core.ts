import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";

export const SELF_PLUGIN_ID = "plugin-updater";

export type GithubSource = {
  kind: "github";
  owner: string;
  repo: string;
  subdir?: string;
  requested_ref?: string;
  resolved_commit?: string;
  managed_path?: string;
};

export type GithubPlugin = {
  pluginId: string;
  source: GithubSource;
};

export type RemoteRef = { sha: string; name: string };

export type RemoteRefs = {
  defaultBranch: string | null;
  headSha: string | null;
  refs: RemoteRef[];
};

export type TrackedRef =
  | { kind: "branch"; name: string; sha: string }
  | { kind: "pinned"; name: string; sha: string | null; reason: string };

export type UpdatePreview = {
  installedVersion?: string;
  remoteVersion?: string;
  changedFiles?: string;
};

export type Classification = "current" | "behind" | "pinned" | "error";

export type CheckOutcome = {
  pluginId: string;
  source: GithubSource;
  trackedRef?: TrackedRef;
  remoteSha?: string;
  classification: Classification;
  detail?: string;
  preview?: UpdatePreview;
};

export type ExecResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type Runner = (
  executable: string,
  args: string[],
  options?: { cwd?: string },
) => Promise<ExecResult>;

export function resolveHerdrBinary(
  injectedPath = process.env.HERDR_BIN_PATH,
): string {
  if (injectedPath) {
    try {
      accessSync(injectedPath, constants.X_OK);
      return injectedPath;
    } catch {
      // A server can outlive the development binary that launched it.
    }
  }
  return "herdr";
}

export function runCommand(
  executable: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
): Promise<ExecResult> {
  const { promise, resolve } = Promise.withResolvers<ExecResult>();
  const child = spawn(executable, args, {
    cwd: options?.cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), options?.timeoutMs ?? 30_000);
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.once("error", (error: Error) => {
    clearTimeout(timer);
    resolve({ status: null, stdout, stderr, error: error.message });
  });
  child.once("close", (code: number | null) => {
    clearTimeout(timer);
    resolve({ status: code, stdout, stderr });
  });
  return promise;
}

export function githubUrl(source: GithubSource): string {
  return `https://github.com/${source.owner}/${source.repo}`;
}

export function installSpec(source: GithubSource): string {
  const subdir = source.subdir ? `/${source.subdir}` : "";
  return `${source.owner}/${source.repo}${subdir}`;
}

export function reinstallArgs(outcome: CheckOutcome): string[] {
  const args = ["plugin", "install", installSpec(outcome.source)];
  if (outcome.source.requested_ref) {
    args.push("--ref", outcome.source.requested_ref);
  }
  args.push("--yes");
  return args;
}

export function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

type RawRecord = Record<string, unknown>;

export function parsePluginList(
  raw: string,
): { github: GithubPlugin[]; localCount: number } {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("Herdr returned invalid plugin-list JSON");
  }
  const result = (payload as RawRecord | null)?.result;
  const plugins = (result as RawRecord | null)?.plugins;
  if (!Array.isArray(plugins)) {
    throw new Error("Herdr returned an invalid plugin-list response");
  }

  const github: GithubPlugin[] = [];
  let localCount = 0;
  for (const entry of plugins) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("Herdr returned an invalid plugin record");
    }
    const record = entry as RawRecord;
    const pluginId = record.plugin_id;
    if (typeof pluginId !== "string" || pluginId.length === 0) {
      throw new Error("Herdr returned a plugin record without an id");
    }
    const source = record.source;
    if (typeof source !== "object" || source === null || Array.isArray(source)) {
      throw new Error(`Herdr returned no source for plugin ${pluginId}`);
    }
    if ((source as RawRecord).kind !== "github") {
      localCount += 1;
      continue;
    }
    const narrow = source as RawRecord;
    const owner = narrow.owner;
    const repo = narrow.repo;
    if (typeof owner !== "string" || !owner || typeof repo !== "string" || !repo) {
      throw new Error(`Herdr returned an incomplete GitHub source for plugin ${pluginId}`);
    }
    github.push({
      pluginId,
      source: {
        kind: "github",
        owner,
        repo,
        subdir: optionalString(narrow.subdir),
        requested_ref: optionalString(narrow.requested_ref),
        resolved_commit: optionalString(narrow.resolved_commit),
        managed_path: optionalString(narrow.managed_path),
      },
    });
  }
  return { github, localCount };
}

export function parseLsRemote(raw: string): RemoteRefs {
  const refs: RemoteRef[] = [];
  let defaultBranch: string | null = null;
  let headSha: string | null = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const symref = /^ref:\s*refs\/heads\/(\S+)\tHEAD$/.exec(trimmed);
    if (symref) {
      defaultBranch = symref[1];
      continue;
    }
    const pair = /^([0-9a-f]{40})\t(\S+)$/.exec(trimmed);
    if (!pair) {
      continue;
    }
    if (pair[2] === "HEAD") {
      headSha = pair[1];
      continue;
    }
    refs.push({ sha: pair[1], name: pair[2] });
  }
  return { defaultBranch, headSha, refs };
}

const COMMIT_SHA = /^[0-9a-f]{7,40}$/;

export function resolveTrackedRef(
  requestedRef: string | undefined,
  remote: RemoteRefs,
): TrackedRef {
  const requested = optionalString(requestedRef);
  if (!requested) {
    if (remote.defaultBranch && remote.headSha) {
      return { kind: "branch", name: remote.defaultBranch, sha: remote.headSha };
    }
    return {
      kind: "pinned",
      name: "HEAD",
      sha: remote.headSha,
      reason: "remote default branch is unknown",
    };
  }
  if (COMMIT_SHA.test(requested)) {
    return { kind: "pinned", name: requested, sha: requested, reason: "installed at a commit" };
  }
  const branch = remote.refs.find((ref) => ref.name === `refs/heads/${requested}`);
  if (branch) {
    return { kind: "branch", name: requested, sha: branch.sha };
  }
  const tag = remote.refs.find((ref) => ref.name === `refs/tags/${requested}`);
  if (tag) {
    return { kind: "pinned", name: requested, sha: tag.sha, reason: "installed at a tag" };
  }
  return { kind: "pinned", name: requested, sha: null, reason: "ref not found on remote" };
}

export function classifyOutcome(
  source: GithubSource,
  tracked: TrackedRef,
): { classification: Classification; detail?: string } {
  if (tracked.kind === "pinned") {
    let detail = `pinned: ${tracked.reason}`;
    if (tracked.sha && source.resolved_commit && tracked.sha !== source.resolved_commit) {
      detail += ", pin target moved";
    }
    return { classification: "pinned", detail };
  }
  if (!source.resolved_commit) {
    return { classification: "error", detail: "no installed commit recorded" };
  }
  return {
    classification: tracked.sha === source.resolved_commit ? "current" : "behind",
  };
}

export function parseManifestVersion(raw: string): string | undefined {
  for (const line of raw.split("\n")) {
    if (/^\s*\[/.test(line)) {
      break;
    }
    const match = /^\s*version\s*=\s*"([^"]+)"/.exec(line);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

export function shortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 7) : "?";
}

export function minHerdrHint(stderr: string): string | null {
  if (/min_herdr_version/i.test(stderr) || /newer (herdr )?(binary|version)/i.test(stderr)) {
    return "This plugin now requires a newer Herdr binary. Update Herdr first, then retry.";
  }
  return null;
}

const REPORT_ORDER: Record<Classification, number> = {
  behind: 0,
  current: 1,
  pinned: 2,
  error: 3,
};

export function orderOutcomes(outcomes: CheckOutcome[]): CheckOutcome[] {
  return [...outcomes].sort(
    (a, b) => REPORT_ORDER[a.classification] - REPORT_ORDER[b.classification],
  );
}

export function sortForUpdate(outcomes: CheckOutcome[]): CheckOutcome[] {
  return [...outcomes].sort((a, b) => {
    const aSelf = a.pluginId === SELF_PLUGIN_ID ? 1 : 0;
    const bSelf = b.pluginId === SELF_PLUGIN_ID ? 1 : 0;
    return aSelf - bSelf;
  });
}

function versionColumn(preview: UpdatePreview | undefined): string {
  if (!preview || (!preview.installedVersion && !preview.remoteVersion)) {
    return "";
  }
  if (
    preview.installedVersion &&
    preview.remoteVersion &&
    preview.installedVersion !== preview.remoteVersion
  ) {
    return `${preview.installedVersion} -> ${preview.remoteVersion}`;
  }
  return preview.remoteVersion ?? preview.installedVersion ?? "";
}

export function formatReport(outcomes: CheckOutcome[], localCount: number): string {
  const ordered = orderOutcomes(outcomes);
  const counts: Record<Classification, number> = {
    behind: 0,
    current: 0,
    pinned: 0,
    error: 0,
  };
  for (const outcome of ordered) {
    counts[outcome.classification] += 1;
  }

  const width = Math.max("plugin".length, ...ordered.map((o) => o.pluginId.length));
  const lines: string[] = [];
  lines.push(`Herdr plugin update check - ${new Date().toISOString()}`);
  lines.push("");
  for (const outcome of ordered) {
    const trackedName = outcome.trackedRef?.name ?? "-";
    const ref = /^[0-9a-f]{7,40}$/.test(trackedName)
      ? `@${trackedName.slice(0, 7)}`
      : trackedName;
    const installed = shortSha(outcome.source.resolved_commit);
    const remote = outcome.remoteSha ? shortSha(outcome.remoteSha) : "-";
    const commitInfo =
      outcome.classification === "behind" ? `${installed} -> ${remote}` : installed;
    const parts = [
      outcome.classification.padEnd(7),
      outcome.pluginId.padEnd(width),
      ref.padEnd(14),
      commitInfo,
    ];
    let row = parts.join("  ").trimEnd();
    const version = versionColumn(outcome.preview);
    if (version) {
      row += `  ${version}`;
    }
    if (outcome.detail) {
      row += `  (${outcome.detail})`;
    }
    lines.push(row);
  }
  lines.push("");
  const summary =
    `${counts.behind} behind, ${counts.current} current, ` +
    `${counts.pinned} pinned, ${counts.error} error`;
  lines.push(
    localCount > 0
      ? `${summary}; ${localCount} local plugin${localCount === 1 ? "" : "s"} excluded`
      : summary,
  );
  return lines.join("\n");
}

function manifestRepoPath(source: GithubSource): string {
  return source.subdir ? `${source.subdir}/herdr-plugin.toml` : "herdr-plugin.toml";
}

async function collectPreview(
  run: Runner,
  outcome: CheckOutcome,
): Promise<UpdatePreview> {
  const preview: UpdatePreview = {};
  const managed = outcome.source.managed_path;
  const tracked = outcome.trackedRef;
  if (!managed || !tracked || tracked.kind !== "branch" || !outcome.source.resolved_commit) {
    return preview;
  }

  const fetched = await run("git", ["-C", managed, "fetch", "--quiet", "origin", tracked.name]);
  if (fetched.status !== 0) {
    return preview;
  }

  const diffArgs = [
    "-C",
    managed,
    "diff",
    "--shortstat",
    `${outcome.source.resolved_commit}..FETCH_HEAD`,
  ];
  if (outcome.source.subdir) {
    diffArgs.push("--", outcome.source.subdir);
  }
  const stat = await run("git", diffArgs);
  if (stat.status === 0 && stat.stdout.trim()) {
    preview.changedFiles = stat.stdout.trim();
  }

  const manifestPath = manifestRepoPath(outcome.source);
  const installedManifest = await run("git", [
    "-C",
    managed,
    "show",
    `${outcome.source.resolved_commit}:${manifestPath}`,
  ]);
  if (installedManifest.status === 0) {
    preview.installedVersion = parseManifestVersion(installedManifest.stdout);
  }
  const remoteManifest = await run("git", [
    "-C",
    managed,
    "show",
    `FETCH_HEAD:${manifestPath}`,
  ]);
  if (remoteManifest.status === 0) {
    preview.remoteVersion = parseManifestVersion(remoteManifest.stdout);
  }
  return preview;
}

export async function collectOutcomes(
  run: Runner,
  herdrBinary: string,
): Promise<{ outcomes: CheckOutcome[]; localCount: number }> {
  const listed = await run(herdrBinary, ["plugin", "list", "--json"]);
  if (listed.status !== 0) {
    throw new Error(
      firstLine(listed.stderr) || listed.error || "failed to list Herdr plugins",
    );
  }
  const { github, localCount } = parsePluginList(listed.stdout);

  const outcomes = await Promise.all(
    github.map(async (plugin): Promise<CheckOutcome> => {
      const remoteRaw = await run("git", [
        "ls-remote",
        "--symref",
        githubUrl(plugin.source),
      ]);
      if (remoteRaw.status !== 0) {
        return {
          pluginId: plugin.pluginId,
          source: plugin.source,
          classification: "error",
          detail: `git ls-remote failed: ${
            firstLine(remoteRaw.stderr) || remoteRaw.error || "unknown error"
          }`,
        };
      }
      const remote = parseLsRemote(remoteRaw.stdout);
      const tracked = resolveTrackedRef(plugin.source.requested_ref, remote);
      const { classification, detail } = classifyOutcome(plugin.source, tracked);
      const outcome: CheckOutcome = {
        pluginId: plugin.pluginId,
        source: plugin.source,
        trackedRef: tracked,
        remoteSha: tracked.sha ?? undefined,
        classification,
        detail,
      };
      if (classification === "behind") {
        outcome.preview = await collectPreview(run, outcome);
      }
      return outcome;
    }),
  );
  return { outcomes, localCount };
}
