import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLinearCliArgs,
  classifyLinearIssue,
  collectGitMetadata,
  DEFAULT_LINEAR_TEAM,
  executeLinearCreate,
  LINEAR_ISSUE_TYPES,
  LINEAR_PROJECTS,
  LINEAR_REVIEW_BUCKETS,
  normalizeIssueType,
  normalizePriority,
  normalizeProject,
  normalizeReviewBucket,
  parseCommandArgs,
  priorityLabel,
  resolveLinearBinary,
  type ClassifierAgent,
  type LinearRunner,
} from "../src/record.ts";

test("parseCommandArgs handles empty or whitespace input", () => {
  assert.deepEqual(parseCommandArgs(""), { raw: "", labels: [] });
  assert.deepEqual(parseCommandArgs("   "), { raw: "", labels: [] });
});

test("parseCommandArgs extracts title and multi-line description", () => {
  const parsed = parseCommandArgs("Fix startup crash\nMore details on line 2\nLine 3");
  assert.equal(parsed.title, "Fix startup crash");
  assert.equal(parsed.description, "More details on line 2\nLine 3");
  assert.equal(parsed.raw, "Fix startup crash\nMore details on line 2\nLine 3");
});

test("parseCommandArgs parses flags and options with spaces or equals", () => {
  const parsed = parseCommandArgs(
    '--team=TEST --project="BMO / Springfield" --bucket=09 --type=Bug --priority=urgent -l "Blocked on me" Fix the login timeout',
  );
  assert.equal(parsed.team, "TEST");
  assert.equal(parsed.project, "BMO / Springfield");
  assert.equal(parsed.reviewBucket, "Review bucket: 09 Smithers, harnesses, and agent workflows");
  assert.equal(parsed.type, "Bug");
  assert.equal(parsed.priority, 1);
  assert.deepEqual(parsed.labels, ["Blocked on me"]);
  assert.equal(parsed.title, "Fix the login timeout");
});

test("parseCommandArgs parses explicit title and description flags", () => {
  const parsed = parseCommandArgs(
    '--title "Explicit Title" --desc "Explicit description body" --project Saddle',
  );
  assert.equal(parsed.title, "Explicit Title");
  assert.equal(parsed.description, "Explicit description body");
  assert.equal(parsed.project, "Saddle");
});

test("taxonomy constants contain expected values", () => {
  assert.equal(DEFAULT_LINEAR_TEAM, "EMO");
  assert.equal(LINEAR_PROJECTS.length, 5);
  assert.ok(LINEAR_PROJECTS.includes("Creatordex"));
  assert.ok(LINEAR_PROJECTS.includes("Saddle"));
  assert.ok(LINEAR_PROJECTS.includes("BMO / Springfield"));
  assert.ok(LINEAR_PROJECTS.includes("Personal / Ops"));
  assert.ok(LINEAR_PROJECTS.includes("Japan Trip 2026"));
  assert.equal(LINEAR_REVIEW_BUCKETS.length, 10);
  assert.deepEqual(LINEAR_ISSUE_TYPES, ["Bug", "Feature", "Improvement"]);
});

test("normalizers map project names and review buckets", () => {
  assert.equal(normalizeProject("creatordex"), "Creatordex");
  assert.equal(normalizeProject("saddle"), "Saddle");
  assert.equal(normalizeProject("bmo"), "BMO / Springfield");
  assert.equal(normalizeProject("springfield"), "BMO / Springfield");
  assert.equal(normalizeProject("personal"), "Personal / Ops");
  assert.equal(normalizeProject("japan trip"), "Japan Trip 2026");
  assert.equal(normalizeProject("Custom Project"), "Custom Project");

  assert.equal(
    normalizeReviewBucket("01"),
    "Review bucket: 01 Personal and life",
  );
  assert.equal(
    normalizeReviewBucket("local ai"),
    "Review bucket: 02 Local AI and hardware",
  );
  assert.equal(
    normalizeReviewBucket("shortcuts"),
    "Review bucket: 03 Mobile input and Shortcuts",
  );
  assert.equal(
    normalizeReviewBucket("hermes"),
    "Review bucket: 04 Hermes runtime and reliability",
  );
  assert.equal(
    normalizeReviewBucket("wiki"),
    "Review bucket: 05 Wiki, memory, and documentation",
  );
  assert.equal(
    normalizeReviewBucket("music"),
    "Review bucket: 06 Music, gaming, and creative tools",
  );
  assert.equal(
    normalizeReviewBucket("research"),
    "Review bucket: 07 Research, evaluations, and adoption",
  );
  assert.equal(
    normalizeReviewBucket("bmo products"),
    "Review bucket: 08 BMO products and control surfaces",
  );
  assert.equal(
    normalizeReviewBucket("harness"),
    "Review bucket: 09 Smithers, harnesses, and agent workflows",
  );
  assert.equal(
    normalizeReviewBucket("security"),
    "Review bucket: 10 Protocols, security, and effect gates",
  );
});

test("normalizers map issue types and priorities", () => {
  assert.equal(normalizeIssueType("bug"), "Bug");
  assert.equal(normalizeIssueType("feature"), "Feature");
  assert.equal(normalizeIssueType("improvement"), "Improvement");
  assert.equal(normalizeIssueType("other"), undefined);

  assert.equal(normalizePriority("urgent"), 1);
  assert.equal(normalizePriority("p0"), 1);
  assert.equal(normalizePriority("high"), 2);
  assert.equal(normalizePriority("p2"), 3);
  assert.equal(normalizePriority("low"), 4);
  assert.equal(normalizePriority(1), 1);
  assert.equal(priorityLabel(1), "Urgent");
  assert.equal(priorityLabel(2), "High");
  assert.equal(priorityLabel(3), "Medium");
  assert.equal(priorityLabel(4), "Low");
});

test("classifyLinearIssue delegates routing to ClassifierAgent", async () => {
  const mockClassifier: ClassifierAgent = async () =>
    JSON.stringify({
      title: "Agent routed title",
      description: "Agent synthesized description",
      project: "Saddle",
      reviewBucket: "Review bucket: 09 Smithers, harnesses, and agent workflows",
      type: "Feature",
      priority: 2,
      team: "EMO",
    });

  const classified = await classifyLinearIssue(
    "some ambiguous thought",
    {},
    { classifier: mockClassifier },
  );

  assert.equal(classified.title, "Agent routed title");
  assert.equal(classified.project, "Saddle");
  assert.equal(
    classified.reviewBucket,
    "Review bucket: 09 Smithers, harnesses, and agent workflows",
  );
  assert.equal(classified.type, "Feature");
  assert.equal(classified.priority, 2);
  assert.equal(classified.team, "EMO");
});

test("explicit flags override classifier agent routing", async () => {
  const mockClassifier: ClassifierAgent = async () =>
    JSON.stringify({
      title: "Agent title",
      project: "Saddle",
      reviewBucket: "Review bucket: 09 Smithers, harnesses, and agent workflows",
      type: "Feature",
      priority: 2,
    });

  const classified = await classifyLinearIssue(
    '--project Creatordex --priority 1 --type Bug --title "Explicit title" some thought',
    {},
    { classifier: mockClassifier },
  );

  assert.equal(classified.title, "Explicit title");
  assert.equal(classified.project, "Creatordex");
  assert.equal(classified.type, "Bug");
  assert.equal(classified.priority, 1);
});

test("graceful fallback when classifier agent fails", async () => {
  const failingClassifier: ClassifierAgent = async () => {
    throw new Error("Classifier timeout");
  };

  const classified = await classifyLinearIssue(
    "Fix startup crash in bootloader",
    { cwd: "/test/path" },
    { classifier: failingClassifier },
  );

  assert.equal(classified.title, "Fix startup crash in bootloader");
  assert.equal(classified.type, "Bug");
  assert.equal(classified.priority, 3);
});

test("classifyLinearIssue applies heuristic fallback for Bug, Feature, Improvement", async () => {
  const emptyClassifier: ClassifierAgent = async () => "";
  const bug = await classifyLinearIssue(
    "Fix broken token refresh in auth flow",
    {},
    { classifier: emptyClassifier },
  );
  assert.equal(bug.type, "Bug");
  assert.ok(bug.labels.includes("Bug"));

  const feat = await classifyLinearIssue(
    "Add support for WebGPU acceleration",
    {},
    { classifier: emptyClassifier },
  );
  assert.equal(feat.type, "Feature");
  assert.ok(feat.labels.includes("Feature"));

  const imp = await classifyLinearIssue(
    "Optimize cache lookup performance",
    {},
    { classifier: emptyClassifier },
  );
  assert.equal(imp.type, "Improvement");
  assert.ok(imp.labels.includes("Improvement"));
});

test("classifyLinearIssue infers priority from keywords in fallback", async () => {
  const emptyClassifier: ClassifierAgent = async () => "";
  const urgent = await classifyLinearIssue(
    "Urgent blocker: server fails to boot",
    {},
    { classifier: emptyClassifier },
  );
  assert.equal(urgent.priority, 1);

  const minor = await classifyLinearIssue(
    "Minor: tweak margin on button",
    {},
    { classifier: emptyClassifier },
  );
  assert.equal(minor.priority, 4);

  const normal = await classifyLinearIssue(
    "Update documentation for setup",
    {},
    { classifier: emptyClassifier },
  );
  assert.equal(normal.priority, 3);
});

test("classifyLinearIssue infers project and review bucket from ambient context in fallback", async () => {
  const emptyClassifier: ClassifierAgent = async () => "";
  const classified = await classifyLinearIssue(
    "Fix ranking algorithm",
    {
      cwd: "/Users/emo/src/creatordex",
      git: {
        repo: "https://github.com/emo-eth/creatordex",
        branch: "main",
        worktree: "/Users/emo/src/creatordex",
      },
      turn: 3,
      model: "anthropic/claude-3-7-sonnet",
    },
    { classifier: emptyClassifier },
  );

  assert.equal(classified.project, "Creatordex");
  assert.equal(
    classified.reviewBucket,
    "Review bucket: 08 BMO products and control surfaces",
  );
  assert.ok(classified.description.includes("- **Repository:** https://github.com/emo-eth/creatordex"));
  assert.ok(classified.description.includes("- **Branch:** main"));
  assert.ok(classified.description.includes("- **Turn:** 3"));
  assert.ok(classified.description.includes("- **Model:** anthropic/claude-3-7-sonnet"));
});

test("buildLinearCliArgs constructs expected CLI arguments", () => {
  const args = buildLinearCliArgs({
    title: "Implement slash command",
    description: "Full description here",
    team: "EMO",
    project: "Saddle",
    priority: 2,
    labels: [
      "Review bucket: 09 Smithers, harnesses, and agent workflows",
      "Feature",
    ],
  });

  assert.deepEqual(args, [
    "issue",
    "create",
    "--no-interactive",
    "--team",
    "EMO",
    "-t",
    "Implement slash command",
    "-d",
    "Full description here",
    "--project",
    "Saddle",
    "-p",
    "2",
    "-l",
    "Review bucket: 09 Smithers, harnesses, and agent workflows",
    "-l",
    "Feature",
  ]);
});

test("resolveLinearBinary checks env and default fallback", () => {
  const custom = resolveLinearBinary(undefined, { LINEAR_BIN_PATH: "/custom/bin/linear" });
  assert.equal(custom, "/custom/bin/linear");

  const explicit = resolveLinearBinary("/explicit/linear");
  assert.ok(typeof explicit === "string");
});

test("executeLinearCreate runs runner and parses output", async () => {
  const captured: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
  const mockRunner: LinearRunner = async (cmd, args, options) => {
    captured.push({ cmd, args, cwd: options.cwd });
    return {
      stdout: "Created issue EMO-426: Test Issue\nhttps://linear.app/emo-eth/issue/EMO-426/test-issue\n",
      stderr: "",
      exitCode: 0,
    };
  };

  const result = await executeLinearCreate(
    {
      title: "Test Issue",
      team: "EMO",
      priority: 1,
    },
    {
      runner: mockRunner,
      cwd: "/test/dir",
      binaryPath: "/bin/mock-linear",
    },
  );

  assert.equal(result.id, "EMO-426");
  assert.equal(result.url, "https://linear.app/emo-eth/issue/EMO-426/test-issue");
  assert.equal(result.title, "Test Issue");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].cmd, "/bin/mock-linear");
  assert.equal(captured[0].cwd, "/test/dir");
  assert.ok(captured[0].args.includes("-t"));
  assert.ok(captured[0].args.includes("Test Issue"));
});

test("executeLinearCreate throws when runner fails", async () => {
  const failingRunner: LinearRunner = async () => ({
    stdout: "",
    stderr: "Network error connecting to Linear API",
    exitCode: 1,
  });

  await assert.rejects(
    () =>
      executeLinearCreate(
        { title: "Should fail" },
        { runner: failingRunner },
      ),
    /Network error connecting to Linear API/,
  );
});

test("collectGitMetadata uses GitRunner to parse git state", async () => {
  const fakeGit = async (args: string[]) => {
    if (args.includes("--show-toplevel")) return "/path/to/repo";
    if (args.includes("get-url")) return "git@github.com:emo-eth/skills.git";
    if (args.includes("symbolic-ref")) return "linear-command";
    return undefined;
  };

  const meta = await collectGitMetadata("/path/to/repo/plugins", fakeGit);
  assert.equal(meta.repo, "git@github.com:emo-eth/skills.git");
  assert.equal(meta.worktree, "/path/to/repo");
  assert.equal(meta.branch, "linear-command");
});
