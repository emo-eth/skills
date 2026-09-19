
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  fetchAssignedNotCompleted,
  fetchProjectIssues,
  fetchProjectsIssues,
  matchesProject,
} from "./linear-client.ts";

const toolsDir = dirname(fileURLToPath(import.meta.url));
const cli = join(toolsDir, "prioritize-linear-tickets.ts");

type RunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

type RunOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdinData: string;
  timeoutMs: number;
};

async function runCli(args: string[], options: RunOptions): Promise<RunResult> {
  const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
  const controller = new AbortController();
  const abortSignal = AbortSignal.timeout(options.timeoutMs);
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      cli,
      ...args,
    ],
    {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      signal: controller.signal,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.stdin?.end(options.stdinData);
  child.on("error", (error) => {
    reject(error);
  });
  child.on("close", (code, signal) => {
    resolve({ code, signal, stdout, stderr });
  });
  const abortListener = () => controller.abort();
  abortSignal.addEventListener("abort", abortListener, { once: true });
  try {
    return await promise;
  } finally {
    abortSignal.removeEventListener("abort", abortListener);
  }
}

async function writeFakeLinear(root: string): Promise<void> {
  const binDir = join(root, "bin");
  await writeFile(
    join(binDir, "linear"),
    `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
const dbPath = process.env.LINEAR_FAKE_STATE;
const logPath = process.env.LINEAR_FAKE_LOG;
const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));

function writeDb() {
  fs.writeFileSync(dbPath, JSON.stringify(db));
}

function logLine(line) {
  fs.appendFileSync(logPath, line + "\\n");
  const count = fs.readFileSync(logPath, "utf8").split("\\n").filter(Boolean).length;
  if (process.env.LINEAR_FAIL_UPDATE_INDEX && Number(process.env.LINEAR_FAIL_UPDATE_INDEX) === count) {
    console.error("simulated linear failure");
    process.exit(1);
  }
}

function matches(p, target) {
  if (!p || !target) return false;
  const norm = target.trim().toLowerCase();
  if (typeof p === "string") return p.trim().toLowerCase() === norm;
  if (p.name && p.name.trim().toLowerCase() === norm) return true;
  if (p.id && p.id.trim().toLowerCase() === norm) return true;
  if (p.slugId && p.slugId.trim().toLowerCase() === norm) return true;
  if (p.name) {
    const slug = p.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (slug === norm) return true;
  }
  return false;
}

function toNode(t) {
  return {
    id: t.uuid ?? t.id,
    identifier: t.id,
    title: t.title,
    description: t.description ?? "",
    priority: t.priority,
    state: { name: "Todo", type: "triage" },
    team: { key: t.teamKey ?? "NAT" },
    project: t.project ?? null,
    customFields: t.customFields ?? [],
  };
}

function flagValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (args[0] === "api") {
  const query = args.filter((a) => !a.startsWith("--") && a !== "api").join(" ");
  const varsIndex = args.indexOf("--variables-json");
  const vars = varsIndex >= 0 ? JSON.parse(args[varsIndex + 1]) : {};
  if (/RankNumberFields|issueCustomFields/.test(query) && !/issueCustomFieldCreate|issueCustomFieldValueUpsert/.test(query)) {
    const fields = db.rankField ? [db.rankField] : [];
    process.stdout.write(JSON.stringify({ data: { issueCustomFields: { nodes: fields } } }));
    process.exit(0);
  }
  if (/CreateRankNumberField|issueCustomFieldCreate/.test(query)) {
    if (process.env.LINEAR_FAKE_CREATE_RANK_FIELD !== "1") {
      console.error("custom fields are not creatable");
      process.exit(1);
    }
    db.rankField = { id: "field-created", name: vars.name ?? "Relative Rank", type: "number" };
    writeDb();
    process.stdout.write(JSON.stringify({
      data: { issueCustomFieldCreate: { success: true, issueCustomField: db.rankField } },
    }));
    process.exit(0);
  }
  if (/SetRankNumberField|issueCustomFieldValueUpsert/.test(query)) {
    const ticket = db.tickets.find((t) => t.id === vars.issueId || t.uuid === vars.issueId);
    if (!ticket) {
      console.error("unknown issue");
      process.exit(1);
    }
    logLine("update " + vars.issueId + " field " + vars.fieldId + " " + vars.value);
    ticket.relativeRank = Number(vars.value);
    ticket.customFields = [{ id: vars.fieldId, name: (db.rankField && db.rankField.name) || "Relative Rank", value: Number(vars.value) }];
    writeDb();
    process.stdout.write(JSON.stringify({ data: { issueCustomFieldValueUpsert: { success: true } } }));
    process.exit(0);
  }
  if (/IssueRankBodies/.test(query)) {
    const ids = new Set(vars.ids ?? []);
    const nodes = db.tickets.filter((t) => ids.has(t.uuid ?? t.id) || ids.has(t.id)).map(toNode);
    process.stdout.write(JSON.stringify({ data: { issues: { nodes } } }));
    process.exit(0);
  }
  const payload = {
    data: {
      viewer: {
        assignedIssues: {
          nodes: db.tickets.filter((t) => t.assignedToMe !== false).map(toNode),
        },
      },
    },
  };
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

if (args[0] === "project" && args[1] === "list") {
  const projects = [];
  const seen = new Set();
  for (const t of db.tickets) {
    if (t.project && t.project.id && !seen.has(t.project.id)) {
      seen.add(t.project.id);
      projects.push(t.project);
    }
  }
  process.stdout.write(JSON.stringify({ nodes: projects }));
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "query") {
  const projectTarget = flagValue("--project");
  const teamTarget = flagValue("--team");
  const nodes = db.tickets.filter((t) => {
    if (projectTarget && !matches(t.project, projectTarget)) return false;
    if (teamTarget && (t.teamKey ?? "NAT") !== teamTarget) return false;
    return true;
  }).map(toNode);
  process.stdout.write(JSON.stringify({ nodes }));
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "update") {
  const id = args[2];
  const ticket = db.tickets.find((t) => t.id === id);
  if (!ticket) {
    console.error("unknown issue " + id);
    process.exit(1);
  }
  const priority = flagValue("--priority") ?? flagValue("-p");
  const descriptionFile = flagValue("--description-file");
  const descriptionFlag = flagValue("--description") ?? flagValue("-d");
  if (priority !== undefined) {
    logLine("update " + id + " priority " + priority);
    ticket.priority = Number(priority);
  }
  let description = descriptionFlag;
  if (descriptionFile) description = fs.readFileSync(descriptionFile, "utf8");
  if (description !== undefined) {
    const match = description.match(/<!--\\s*rank:\\s*(-?\\d+(?:\\.\\d+)?)\\s*-->/i);
    const weight = match ? Number(match[1]) : undefined;
    logLine("update " + id + " rank " + (weight ?? "comment"));
    ticket.description = description;
    if (weight !== undefined) ticket.relativeRank = weight;
  }
  writeDb();
  process.exit(0);
}

console.error("unhandled linear " + args.join(" "));
process.exit(1);
`,
    { mode: 0o755 },
  );
}

type FakeDb = {
  tickets: Array<{
    id: string;
    title: string;
    description?: string;
    priority?: number;
    relativeRank?: number;
    uuid?: string;
    teamKey?: string;
    project?: { id?: string; name?: string; slugId?: string } | null;
    assignedToMe?: boolean;
    customFields?: Array<{ id?: string; name?: string; value?: number }>;
  }>;
  rankField?: { id: string; name: string; type?: string };
};

async function createRoot(db: FakeDb): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "prioritize-regression-"));
  await mkdir(join(root, "bin"), { recursive: true });
  await writeFakeLinear(root);
  await writeFile(join(root, "db.json"), JSON.stringify(db));
  await writeFile(join(root, "log"), "");
  return root;
}

function childEnv(root: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
    LINEAR_FAKE_STATE: join(root, "db.json"),
    LINEAR_FAKE_LOG: join(root, "log"),
    NO_COLOR: "1",
    ...extra,
  };
}

async function readLog(root: string): Promise<string[]> {
  const content = await readFile(join(root, "log"), "utf8");
  return content.split("\n").filter(Boolean);
}

test("fetchAssignedNotCompleted returns an empty list when Linear has no assigned issues", async () => {
  const root = await createRoot({ tickets: [] });
  const previousPath = process.env.PATH;
  process.env.PATH = `${join(root, "bin")}:${previousPath ?? ""}`;
  process.env.LINEAR_FAKE_STATE = join(root, "db.json");
  try {
    const tickets = await fetchAssignedNotCompleted();
    assert.deepEqual(tickets, []);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    delete process.env.LINEAR_FAKE_STATE;
    await rm(root, { recursive: true, force: true });
  }
});

test("empty Linear assignment runs the bin CLI without any update calls", async () => {
  const root = await createRoot({ tickets: [] });
  try {
    const result = await runCli(["--bin", "--state", join(root, "state.json")], {
      cwd: root,
      env: childEnv(root, {}),
      stdinData: "",
      timeoutMs: 15000,
    });
    assert.equal(result.signal, null, `killed: ${result.stderr}`);
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    assert.deepEqual(await readLog(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bin apply checkpoint resumes only the failed update on rerun", async () => {
  const root = await createRoot({
    tickets: [
      { id: "NAT-1", title: "First triage ticket", priority: 0 },
      { id: "NAT-2", title: "Second triage ticket", priority: 0 },
    ],
  });
  try {
    const stateFile = join(root, "state.json");
    const first = await runCli(["--bin", "--state", stateFile], {
      cwd: root,
      env: childEnv(root, { LINEAR_FAIL_UPDATE_INDEX: "2" }),
      stdinData: "y\ny\ny\ny\nAPPLY\n",
      timeoutMs: 15000,
    });
    assert.equal(first.code, 1, `stdout: ${first.stdout} stderr: ${first.stderr}`);
    const savedState = JSON.parse(await readFile(stateFile, "utf8")) as {
      applying?: { updates: Record<string, number> };
    };
    assert.deepEqual(savedState.applying?.updates, { "NAT-2": 1 });
    await writeFile(join(root, "log"), "");

    const second = await runCli(["--bin", "--state", stateFile], {
      cwd: root,
      env: childEnv(root, {}),
      stdinData: "",
      timeoutMs: 15000,
    });
    assert.equal(second.signal, null, `killed: ${second.stderr}`);
    assert.equal(second.code, 0, `stdout: ${second.stdout} stderr: ${second.stderr}`);
    const calls = await readLog(root);
    assert.deepEqual(calls, ["update NAT-2 priority 1"]);
    await assert.rejects(readFile(stateFile, "utf8"), /ENOENT/);
    const db = JSON.parse(await readFile(join(root, "db.json"), "utf8")) as {
      tickets: Array<{ id: string; priority: number }>;
    };
    assert.deepEqual(
      db.tickets.map((ticket) => ticket.priority),
      [1, 1],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("top-k apply checkpoint resumes only the failed update on rerun", async () => {
  const root = await createRoot({
    tickets: [
      { id: "NAT-1", title: "Alpha ticket", priority: 0 },
      { id: "NAT-2", title: "Beta ticket", priority: 0 },
      { id: "NAT-3", title: "Gamma ticket", priority: 0 },
    ],
  });
  try {
    const stateFile = join(root, "state.json");
    const first = await runCli(
      ["--top", "2", "--priority", "1", "--state", stateFile],
      {
        cwd: root,
        env: childEnv(root, { LINEAR_FAIL_UPDATE_INDEX: "2" }),
        stdinData: "l\nl\nl\nAPPLY\n",
        timeoutMs: 15000,
      },
    );
    assert.equal(first.code, 1, `stdout: ${first.stdout} stderr: ${first.stderr}`);
    const savedState = JSON.parse(await readFile(stateFile, "utf8")) as {
      applying?: { updates?: Record<string, number>; ranks?: Record<string, number> };
      comparisons: Record<string, string>;
    };
    assert.ok(savedState.applying);
    const remainingWrites =
      Object.keys(savedState.applying?.ranks ?? {}).length +
      Object.keys(savedState.applying?.updates ?? {}).length;
    assert.ok(remainingWrites > 0);
    assert.ok(Object.keys(savedState.comparisons).length > 0);
    const firstLog = await readLog(root);
    assert.equal(firstLog.length, 2);
    await writeFile(join(root, "log"), "");

    const second = await runCli(
      ["--top", "2", "--priority", "1", "--state", stateFile],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "",
        timeoutMs: 15000,
      },
    );
    assert.equal(second.signal, null, `killed: ${second.stderr}`);
    assert.equal(second.code, 0, `stdout: ${second.stdout} stderr: ${second.stderr}`);
    const secondLog = await readLog(root);
    assert.ok(secondLog.length > 0);
    await assert.rejects(readFile(stateFile, "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("matchesProject matches by name, UUID, slugId, and slugified name", () => {
  const project = {
    id: "de4dacd2-f20f-4ed7-8c43-069e3e173bd4",
    name: "Creatordex",
    slugId: "6c237567bcda",
  };
  assert.equal(matchesProject(project, "Creatordex"), true);
  assert.equal(matchesProject(project, "creatordex"), true);
  assert.equal(matchesProject(project, "de4dacd2-f20f-4ed7-8c43-069e3e173bd4"), true);
  assert.equal(matchesProject(project, "DE4DACD2-F20F-4ED7-8C43-069E3E173BD4"), true);
  assert.equal(matchesProject(project, "6c237567bcda"), true);
  assert.equal(matchesProject(project, "6C237567BCDA"), true);
  assert.equal(matchesProject(project, "other-project"), false);
  assert.equal(matchesProject(null, "Creatordex"), false);
  assert.equal(matchesProject(undefined, "Creatordex"), false);

  const multiWord = { id: "p-uuid-1", name: "Japan Trip 2026", slugId: "10c28f2c7860" };
  assert.equal(matchesProject(multiWord, "japan-trip-2026"), true);
  assert.equal(matchesProject(multiWord, "Japan Trip 2026"), true);
  assert.equal(matchesProject(multiWord, "10c28f2c7860"), true);
});

test("fetchAssignedNotCompleted filters by project and combines with team", async () => {
  const root = await createRoot({
    tickets: [
      {
        id: "EMO-1",
        title: "Ticket in Creatordex",
        teamKey: "EMO",
        project: { id: "uuid-1", name: "Creatordex", slugId: "slug-1" },
      },
      {
        id: "EMO-2",
        title: "Ticket in Japan Trip",
        teamKey: "EMO",
        project: { id: "uuid-2", name: "Japan Trip 2026", slugId: "slug-2" },
      },
      {
        id: "NAT-1",
        title: "Ticket in NAT Creatordex",
        teamKey: "NAT",
        project: { id: "uuid-1", name: "Creatordex", slugId: "slug-1" },
      },
    ],
  });
  const previousPath = process.env.PATH;
  process.env.PATH = `${join(root, "bin")}:${previousPath ?? ""}`;
  process.env.LINEAR_FAKE_STATE = join(root, "db.json");
  try {
    const byName = await fetchAssignedNotCompleted({ project: "Creatordex" });
    assert.deepEqual(byName.map((t) => t.id), ["EMO-1", "NAT-1"]);

    const byUuid = await fetchAssignedNotCompleted({ project: "uuid-2" });
    assert.deepEqual(byUuid.map((t) => t.id), ["EMO-2"]);

    const bySlug = await fetchAssignedNotCompleted({ project: "slug-1" });
    assert.deepEqual(bySlug.map((t) => t.id), ["EMO-1", "NAT-1"]);

    const bySlugified = await fetchAssignedNotCompleted({ project: "japan-trip-2026" });
    assert.deepEqual(bySlugified.map((t) => t.id), ["EMO-2"]);

    const combined = await fetchAssignedNotCompleted({ team: "EMO", project: "Creatordex" });
    assert.deepEqual(combined.map((t) => t.id), ["EMO-1"]);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    delete process.env.LINEAR_FAKE_STATE;
    await rm(root, { recursive: true, force: true });
  }
});

test("prioritize-linear-tickets CLI displays --project in help", async () => {
  const root = await createRoot({ tickets: [] });
  try {
    const result = await runCli(["--help"], {
      cwd: root,
      env: childEnv(root, {}),
      stdinData: "",
      timeoutMs: 15000,
    });
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    assert.match(result.stdout, /--project\s+<target>\s+rank all open issues in this project/);
    assert.match(result.stdout, /any assignee/);
    assert.match(result.stdout, /any priority/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prioritize-linear-tickets CLI rejects --project without argument", async () => {
  const root = await createRoot({ tickets: [] });
  try {
    const result = await runCli(["--project"], {
      cwd: root,
      env: childEnv(root, {}),
      stdinData: "",
      timeoutMs: 15000,
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /--project needs a project name, UUID, or slug/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prioritize-linear-tickets CLI filters by --project and only updates that project's tickets", async () => {
  const root = await createRoot({
    tickets: [
      {
        id: "EMO-10",
        title: "Project Alpha ticket",
        priority: 0,
        teamKey: "EMO",
        project: { id: "alpha-uuid", name: "Alpha", slugId: "alpha-slug" },
      },
      {
        id: "EMO-20",
        title: "Project Beta ticket",
        priority: 0,
        teamKey: "EMO",
        project: { id: "beta-uuid", name: "Beta", slugId: "beta-slug" },
      },
    ],
  });
  try {
    const stateFile = join(root, "state.json");
    const result = await runCli(
      ["--bin", "--team", "EMO", "--project", "Alpha", "--state", stateFile],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "y\ny\nAPPLY\n",
        timeoutMs: 15000,
      },
    );
    assert.equal(result.signal, null, `killed: ${result.stderr}`);
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    const calls = await readLog(root);
    assert.deepEqual(calls, ["update EMO-10 priority 1"]);
    const db = JSON.parse(await readFile(join(root, "db.json"), "utf8")) as {
      tickets: Array<{ id: string; priority: number }>;
    };
    const alpha = db.tickets.find((t) => t.id === "EMO-10");
    const beta = db.tickets.find((t) => t.id === "EMO-20");
    assert.equal(alpha?.priority, 1);
    assert.equal(beta?.priority, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prioritize-linear-tickets CLI detects project mismatch on checkpoint resume", async () => {
  const root = await createRoot({
    tickets: [
      {
        id: "EMO-1",
        title: "Alpha ticket",
        priority: 0,
        project: { id: "alpha-uuid", name: "Alpha", slugId: "alpha-slug" },
      },
    ],
  });
  try {
    const stateFile = join(root, "state.json");
    await writeFile(
      stateFile,
      JSON.stringify({
        version: 2,
        mode: "bin",
        snapshot: "dummy",
        tiers: { "EMO-1": 0 },
        applying: {
          source: "linear",
          team: undefined,
          project: "Alpha",
          updates: { "EMO-1": 1 },
        },
        updatedAt: new Date().toISOString(),
      }),
    );
    const result = await runCli(["--bin", "--project", "Beta", "--state", stateFile], {
      cwd: root,
      env: childEnv(root, {}),
      stdinData: "",
      timeoutMs: 15000,
    });
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /saved application checkpoint used project Alpha but this run uses Beta/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fetchProjectIssues fetches all open issues in a project across all assignees", async () => {
  const root = await createRoot({
    tickets: [
      {
        id: "EMO-1",
        title: "Assigned to viewer in Creatordex",
        teamKey: "EMO",
        project: { id: "uuid-1", name: "Creatordex", slugId: "slug-1" },
        assignedToMe: true,
      },
      {
        id: "EMO-2",
        title: "Assigned to someone else in Creatordex",
        teamKey: "EMO",
        project: { id: "uuid-1", name: "Creatordex", slugId: "slug-1" },
        assignedToMe: false,
      },
      {
        id: "EMO-3",
        title: "Unassigned in Creatordex",
        teamKey: "EMO",
        project: { id: "uuid-1", name: "Creatordex", slugId: "slug-1" },
        assignedToMe: false,
      },
      {
        id: "EMO-4",
        title: "Ticket in different project",
        teamKey: "EMO",
        project: { id: "uuid-2", name: "Japan Trip 2026", slugId: "slug-2" },
        assignedToMe: true,
      },
    ],
  });
  const previousPath = process.env.PATH;
  process.env.PATH = `${join(root, "bin")}:${previousPath ?? ""}`;
  process.env.LINEAR_FAKE_STATE = join(root, "db.json");
  try {
    const assignedOnly = await fetchAssignedNotCompleted({ project: "Creatordex" });
    assert.deepEqual(assignedOnly.map((t) => t.id), ["EMO-1"]);

    const allProjectIssues = await fetchProjectIssues({ project: "Creatordex" });
    assert.deepEqual(allProjectIssues.map((t) => t.id), ["EMO-1", "EMO-2", "EMO-3"]);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    delete process.env.LINEAR_FAKE_STATE;
    await rm(root, { recursive: true, force: true });
  }
});

test("fetchProjectIssues resolves project by name, UUID, slugId, and slugified name and combines with team", async () => {
  const root = await createRoot({
    tickets: [
      {
        id: "EMO-1",
        title: "EMO Creatordex ticket",
        teamKey: "EMO",
        project: { id: "uuid-1", name: "Creatordex", slugId: "slug-1" },
      },
      {
        id: "NAT-1",
        title: "NAT Creatordex ticket",
        teamKey: "NAT",
        project: { id: "uuid-1", name: "Creatordex", slugId: "slug-1" },
      },
      {
        id: "EMO-2",
        title: "EMO Japan Trip ticket",
        teamKey: "EMO",
        project: { id: "uuid-2", name: "Japan Trip 2026", slugId: "slug-2" },
      },
    ],
  });
  const previousPath = process.env.PATH;
  process.env.PATH = `${join(root, "bin")}:${previousPath ?? ""}`;
  process.env.LINEAR_FAKE_STATE = join(root, "db.json");
  try {
    const byName = await fetchProjectIssues({ project: "Creatordex" });
    assert.deepEqual(byName.map((t) => t.id), ["EMO-1", "NAT-1"]);

    const byCaseInsensitive = await fetchProjectIssues({ project: "creatordex" });
    assert.deepEqual(byCaseInsensitive.map((t) => t.id), ["EMO-1", "NAT-1"]);

    const byUuid = await fetchProjectIssues({ project: "uuid-2" });
    assert.deepEqual(byUuid.map((t) => t.id), ["EMO-2"]);

    const bySlug = await fetchProjectIssues({ project: "slug-1" });
    assert.deepEqual(bySlug.map((t) => t.id), ["EMO-1", "NAT-1"]);

    const bySlugified = await fetchProjectIssues({ project: "japan-trip-2026" });
    assert.deepEqual(bySlugified.map((t) => t.id), ["EMO-2"]);

    const combined = await fetchProjectIssues({ team: "EMO", project: "Creatordex" });
    assert.deepEqual(combined.map((t) => t.id), ["EMO-1"]);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    delete process.env.LINEAR_FAKE_STATE;
    await rm(root, { recursive: true, force: true });
  }
});

test("prioritize-linear-tickets CLI --project ranks all open project issues across all assignees", async () => {
  const root = await createRoot({
    tickets: [
      {
        id: "EMO-10",
        title: "Assigned ticket in Alpha",
        priority: 0,
        teamKey: "EMO",
        project: { id: "alpha-uuid", name: "Alpha", slugId: "alpha-slug" },
        assignedToMe: true,
      },
      {
        id: "EMO-20",
        title: "Unassigned ticket in Alpha",
        priority: 0,
        teamKey: "EMO",
        project: { id: "alpha-uuid", name: "Alpha", slugId: "alpha-slug" },
        assignedToMe: false,
      },
      {
        id: "EMO-30",
        title: "Ticket in Beta",
        priority: 0,
        teamKey: "EMO",
        project: { id: "beta-uuid", name: "Beta", slugId: "beta-slug" },
        assignedToMe: true,
      },
    ],
  });
  try {
    const stateFile = join(root, "state.json");
    const result = await runCli(
      ["--bin", "--team", "EMO", "--project", "Alpha", "--state", stateFile],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "y\ny\ny\ny\nAPPLY\n",
        timeoutMs: 15000,
      },
    );
    assert.equal(result.signal, null, `killed: ${result.stderr}`);
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    const calls = await readLog(root);
    assert.deepEqual(calls, ["update EMO-10 priority 1", "update EMO-20 priority 1"]);
    const db = JSON.parse(await readFile(join(root, "db.json"), "utf8")) as {
      tickets: Array<{ id: string; priority: number }>;
    };
    const alpha1 = db.tickets.find((t) => t.id === "EMO-10");
    const alpha2 = db.tickets.find((t) => t.id === "EMO-20");
    const beta = db.tickets.find((t) => t.id === "EMO-30");
    assert.equal(alpha1?.priority, 1);
    assert.equal(alpha2?.priority, 1);
    assert.equal(beta?.priority, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prioritize-linear-tickets CLI --project includes already-Urgent tickets", async () => {
  const root = await createRoot({
    tickets: [
      {
        id: "EMO-1",
        title: "Urgent ticket in Creatordex",
        priority: 1,
        teamKey: "EMO",
        project: { id: "uuid-1", name: "Creatordex", slugId: "slug-1" },
        assignedToMe: false,
      },
      {
        id: "EMO-2",
        title: "High ticket in Creatordex",
        priority: 2,
        teamKey: "EMO",
        project: { id: "uuid-1", name: "Creatordex", slugId: "slug-1" },
        assignedToMe: true,
      },
      {
        id: "EMO-3",
        title: "Urgent ticket in other project",
        priority: 1,
        teamKey: "EMO",
        project: { id: "uuid-2", name: "Japan Trip 2026", slugId: "slug-2" },
        assignedToMe: true,
      },
    ],
  });
  try {
    const stateFile = join(root, "state.json");
    const result = await runCli(
      ["-k", "1", "--project", "creatordex", "--dry-run", "--reset", "--state", stateFile],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "l\n",
        timeoutMs: 15000,
      },
    );
    assert.equal(result.signal, null, `killed: ${result.stderr}`);
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    assert.doesNotMatch(result.stdout, /Skipping .* already-Urgent/);
    assert.match(result.stdout, /Prioritizing 2 tickets, top 1/);
    assert.match(result.stdout, /TOP 1 of 2 tickets/);
    assert.match(result.stdout, /project creatordex/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prioritize-linear-tickets CLI --bin skips already-prioritized tickets", async () => {
  const root = await createRoot({
    tickets: [
      {
        id: "EMO-1",
        title: "Already Urgent",
        priority: 1,
        teamKey: "EMO",
        project: { id: "uuid-1", name: "Creatordex", slugId: "slug-1" },
      },
      {
        id: "EMO-2",
        title: "Already High",
        priority: 2,
        teamKey: "EMO",
        project: { id: "uuid-1", name: "Creatordex", slugId: "slug-1" },
      },
    ],
  });
  try {
    const result = await runCli(
      ["--bin", "--project", "Creatordex", "--state", join(root, "state.json")],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "",
        timeoutMs: 15000,
      },
    );
    assert.equal(result.signal, null, `killed: ${result.stderr}`);
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    assert.match(result.stdout, /Binning 0 ticket\(s\)/);
    assert.deepEqual(await readLog(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prioritize-linear-tickets CLI --rebin includes already-prioritized tickets", async () => {
  const root = await createRoot({
    tickets: [
      {
        id: "EMO-1",
        title: "Already Urgent",
        priority: 1,
        teamKey: "EMO",
        project: { id: "uuid-1", name: "Creatordex", slugId: "slug-1" },
      },
      {
        id: "EMO-2",
        title: "Already High",
        priority: 2,
        teamKey: "EMO",
        project: { id: "uuid-1", name: "Creatordex", slugId: "slug-1" },
      },
    ],
  });
  try {
    const stateFile = join(root, "state.json");
    const result = await runCli(
      ["--rebin", "--project", "Creatordex", "--state", stateFile],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "y\nn\ny\nn\nAPPLY\n",
        timeoutMs: 15000,
      },
    );
    assert.equal(result.signal, null, `killed: ${result.stderr}`);
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    assert.match(result.stdout, /Re-binning 2 ticket\(s\)/);
    const calls = await readLog(root);
    assert.deepEqual(calls, ["update EMO-1 priority 2"]);
    const db = JSON.parse(await readFile(join(root, "db.json"), "utf8")) as {
      tickets: Array<{ id: string; priority: number }>;
    };
    assert.equal(db.tickets.find((t) => t.id === "EMO-1")?.priority, 2);
    assert.equal(db.tickets.find((t) => t.id === "EMO-2")?.priority, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const creatordex = { id: "uuid-creatordex", name: "Creatordex", slugId: "slug-c" };
const saddle = { id: "uuid-saddle", name: "Saddle", slugId: "slug-s" };

test("fetchProjectsIssues unions tickets from more than one project", async () => {
  const root = await createRoot({
    tickets: [
      { id: "EMO-1", title: "Creatordex ticket", project: creatordex },
      { id: "EMO-2", title: "Saddle ticket", project: saddle },
      { id: "EMO-3", title: "Other ticket", project: { id: "uuid-other", name: "Other", slugId: "slug-o" } },
    ],
  });
  const previousPath = process.env.PATH;
  process.env.PATH = `${join(root, "bin")}:${previousPath ?? ""}`;
  process.env.LINEAR_FAKE_STATE = join(root, "db.json");
  try {
    const tickets = await fetchProjectsIssues({ projects: ["Creatordex", "Saddle"] });
    assert.deepEqual(tickets.map((t) => t.id), ["EMO-1", "EMO-2"]);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    delete process.env.LINEAR_FAKE_STATE;
    await rm(root, { recursive: true, force: true });
  }
});

test("prioritize-linear-tickets CLI ranks multiple --project flags as one pile", async () => {
  const root = await createRoot({
    tickets: [
      { id: "EMO-1", title: "Creatordex urgent", priority: 1, project: creatordex },
      { id: "EMO-2", title: "Saddle urgent", priority: 1, project: saddle },
      { id: "EMO-3", title: "Other project", priority: 1, project: { id: "uuid-other", name: "Other", slugId: "slug-o" } },
    ],
  });
  try {
    const result = await runCli(
      ["-k", "1", "--project", "Creatordex", "--project", "Saddle", "--dry-run", "--state", join(root, "state.json")],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "l\n",
        timeoutMs: 15000,
      },
    );
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    assert.match(result.stdout, /Prioritizing 2 tickets, top 1/);
    assert.match(result.stdout, /project Creatordex, Saddle/);
    assert.doesNotMatch(result.stdout, /EMO-3/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("top-k APPLY writes relative ranks and does not write Linear priority unless asked", async () => {
  const root = await createRoot({
    tickets: [
      { id: "EMO-1", title: "First", priority: 3, project: creatordex },
      { id: "EMO-2", title: "Second", priority: 3, project: creatordex },
      { id: "EMO-3", title: "Third", priority: 3, project: creatordex },
    ],
  });
  try {
    const result = await runCli(
      ["-k", "2", "--project", "Creatordex", "--state", join(root, "state.json")],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "l\nl\nl\nAPPLY\n",
        timeoutMs: 15000,
      },
    );
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    assert.match(result.stdout, /remember relative rank/);
    assert.match(result.stdout, /stays separate from Urgent\/High\/Medium\/Low/);
    const calls = await readLog(root);
    assert.ok(calls.some((line) => line.includes(" rank ")));
    assert.ok(calls.every((line) => !line.includes(" priority ")));
    const db = JSON.parse(await readFile(join(root, "db.json"), "utf8")) as FakeDb;
    assert.equal(db.tickets.find((t) => t.id === "EMO-1")?.priority, 3);
    assert.ok((db.tickets.find((t) => t.id === "EMO-1")?.description ?? "").includes("<!-- rank:"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("top-k APPLY writes Linear priority buckets only when --priority is explicit", async () => {
  const root = await createRoot({
    tickets: [
      { id: "EMO-1", title: "First", priority: 3, project: creatordex },
      { id: "EMO-2", title: "Second", priority: 3, project: creatordex },
      { id: "EMO-3", title: "Third", priority: 3, project: creatordex },
    ],
  });
  try {
    const result = await runCli(
      ["-k", "2", "--priority", "2", "--project", "Creatordex", "--state", join(root, "state.json")],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "l\nl\nl\nAPPLY\n",
        timeoutMs: 15000,
      },
    );
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    const calls = await readLog(root);
    assert.ok(calls.some((line) => line.includes(" rank ")));
    assert.ok(calls.some((line) => line.includes(" priority 2")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("later run on a clean machine resumes from Linear ranks without a state file", async () => {
  const root = await createRoot({
    tickets: [
      { id: "EMO-1", title: "First", priority: 3, project: creatordex, description: "One\n\n<!-- rank: 2 -->" },
      { id: "EMO-2", title: "Second", priority: 3, project: creatordex, description: "Two\n\n<!-- rank: 1 -->" },
      { id: "EMO-3", title: "Third", priority: 3, project: creatordex, description: "Three\n\n<!-- rank: 0 -->" },
    ],
  });
  try {
    const result = await runCli(
      ["-k", "2", "--project", "Creatordex", "--dry-run", "--state", join(root, "fresh-state.json")],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "",
        timeoutMs: 15000,
      },
    );
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    assert.match(result.stdout, /TOP 2 SELECTED/);
    assert.doesNotMatch(result.stdout, /Which is more important/);
    assert.deepEqual(await readLog(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adding a ticket keeps overlapping prior comparisons", async () => {
  const root = await createRoot({
    tickets: [
      { id: "EMO-1", title: "First", priority: 3, project: creatordex },
      { id: "EMO-2", title: "Second", priority: 3, project: creatordex },
    ],
  });
  try {
    const stateFile = join(root, "state.json");
    const first = await runCli(
      ["-k", "1", "--project", "Creatordex", "--state", stateFile],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "l\n",
        timeoutMs: 15000,
      },
    );
    assert.equal(first.code, 0, `stdout: ${first.stdout} stderr: ${first.stderr}`);
    const saved = JSON.parse(await readFile(stateFile, "utf8")) as { comparisons: Record<string, string> };
    assert.ok(Object.keys(saved.comparisons).length > 0);

    const db = JSON.parse(await readFile(join(root, "db.json"), "utf8")) as FakeDb;
    db.tickets.push({ id: "EMO-9", title: "New ticket", priority: 3, project: creatordex });
    await writeFile(join(root, "db.json"), JSON.stringify(db));

    const second = await runCli(
      ["-k", "1", "--project", "Creatordex", "--dry-run", "--state", stateFile],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "r\n",
        timeoutMs: 15000,
      },
    );
    assert.equal(second.code, 0, `stdout: ${second.stdout} stderr: ${second.stderr}`);
    assert.match(second.stdout, /Ticket list changed since last time; overlapping comparisons are kept/);
    assert.doesNotMatch(second.stderr, /ticket list or --top changed/);
    const after = JSON.parse(await readFile(stateFile, "utf8")) as { comparisons: Record<string, string> };
    for (const key of Object.keys(saved.comparisons)) {
      assert.equal(after.comparisons[key], saved.comparisons[key]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removing a ticket keeps overlapping prior comparisons", async () => {
  const root = await createRoot({
    tickets: [
      { id: "EMO-1", title: "First", priority: 3, project: creatordex },
      { id: "EMO-2", title: "Second", priority: 3, project: creatordex },
      { id: "EMO-3", title: "Third", priority: 3, project: creatordex },
    ],
  });
  try {
    const stateFile = join(root, "state.json");
    const first = await runCli(
      ["-k", "2", "--project", "Creatordex", "--state", stateFile],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "l\nl\nl\n",
        timeoutMs: 15000,
      },
    );
    assert.equal(first.code, 0, `stdout: ${first.stdout} stderr: ${first.stderr}`);
    const saved = JSON.parse(await readFile(stateFile, "utf8")) as { comparisons: Record<string, string> };
    const keptKey = Object.keys(saved.comparisons).find((key) => key.includes("EMO-1") && key.includes("EMO-2"));
    assert.ok(keptKey);

    const db = JSON.parse(await readFile(join(root, "db.json"), "utf8")) as FakeDb;
    db.tickets = db.tickets.filter((ticket) => ticket.id !== "EMO-3");
    await writeFile(join(root, "db.json"), JSON.stringify(db));

    const second = await runCli(
      ["-k", "1", "--project", "Creatordex", "--dry-run", "--state", stateFile],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "",
        timeoutMs: 15000,
      },
    );
    assert.equal(second.code, 0, `stdout: ${second.stdout} stderr: ${second.stderr}`);
    assert.match(second.stdout, /overlapping comparisons are kept/);
    assert.doesNotMatch(second.stderr, /run --reset/);
    const after = JSON.parse(await readFile(stateFile, "utf8")) as { comparisons: Record<string, string> };
    assert.equal(after.comparisons[keptKey], saved.comparisons[keptKey]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("top-k APPLY prefers a custom number field when Linear exposes one", async () => {
  const root = await createRoot({
    rankField: { id: "field-rank", name: "Relative Rank", type: "number" },
    tickets: [
      { id: "EMO-1", title: "First", priority: 4, project: creatordex, description: "Keep this face" },
      { id: "EMO-2", title: "Second", priority: 4, project: creatordex, description: "Also visible" },
      { id: "EMO-3", title: "Third", priority: 4, project: creatordex },
    ],
  });
  try {
    const result = await runCli(
      ["-k", "2", "--project", "Creatordex", "--state", join(root, "state.json")],
      {
        cwd: root,
        env: childEnv(root, {}),
        stdinData: "l\nl\nl\nAPPLY\n",
        timeoutMs: 15000,
      },
    );
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    const calls = await readLog(root);
    assert.ok(calls.some((line) => line.includes(" field field-rank ")));
    assert.ok(calls.every((line) => !line.includes(" priority ")));
    const db = JSON.parse(await readFile(join(root, "db.json"), "utf8")) as FakeDb;
    assert.equal(db.tickets.find((t) => t.id === "EMO-1")?.description, "Keep this face");
    assert.equal(db.tickets.find((t) => t.id === "EMO-1")?.priority, 4);
    assert.equal(typeof db.tickets.find((t) => t.id === "EMO-1")?.relativeRank, "number");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("top-k APPLY creates a custom number field when Linear allows it", async () => {
  const root = await createRoot({
    tickets: [
      { id: "EMO-1", title: "First", priority: 4, project: creatordex },
      { id: "EMO-2", title: "Second", priority: 4, project: creatordex },
      { id: "EMO-3", title: "Third", priority: 4, project: creatordex },
    ],
  });
  try {
    const result = await runCli(
      ["-k", "2", "--project", "Creatordex", "--state", join(root, "state.json")],
      {
        cwd: root,
        env: childEnv(root, { LINEAR_FAKE_CREATE_RANK_FIELD: "1" }),
        stdinData: "l\nl\nl\nAPPLY\n",
        timeoutMs: 15000,
      },
    );
    assert.equal(result.code, 0, `stdout: ${result.stdout} stderr: ${result.stderr}`);
    const calls = await readLog(root);
    assert.ok(calls.some((line) => line.includes(" field field-created ")));
    const db = JSON.parse(await readFile(join(root, "db.json"), "utf8")) as FakeDb;
    assert.equal(db.rankField?.id, "field-created");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
