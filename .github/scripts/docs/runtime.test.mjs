import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkerPrompt,
  copilotArguments,
  main,
  reportHasPassShape,
  validateMainProtection,
  validateMainRules,
  validateVerifiedTagRulesets,
  writerPrompt,
} from "./runtime.mjs";

const head = "a".repeat(40);
const base = "b".repeat(40);
const temporaryDirectories = [];

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function createRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), "touchline-docs-runtime-test-"));
  temporaryDirectories.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.name", "Docs runtime test");
  git(root, "config", "user.email", "docs-runtime-test@example.invalid");
  writeFileSync(path.join(root, "feature.ts"), "export const active = true;\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  return { root, base: git(root, "rev-parse", "HEAD") };
}

test.afterEach(() => {
  for (const root of temporaryDirectories.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("writer invocation has no shell, URL, MCP, or all-tools capability", () => {
  const args = copilotArguments("docs-writer", "Update the guides", { root: "/checkout" });
  assert.ok(args.includes("--available-tools=read,search,edit"));
  assert.ok(args.includes("--allow-tool=write"));
  assert.ok(args.includes("--disable-builtin-mcps"));
  assert.ok(args.includes("--disallow-temp-dir"));
  assert.ok(args.includes("--no-ask-user"));
  assert.ok(!args.includes("--trust-folder"));
  assert.ok(!args.some((arg) => /shell|url|mcp-server=|allow-all/.test(arg) && arg !== "--disable-builtin-mcps"));
  assert.ok(!args.includes("--allow-all"));
});

test("checker invocation is read-only and uses an independent agent profile", () => {
  const args = copilotArguments("docs-fact-checker", "Check the docs", {
    readOnly: true,
    root: "/fresh-checkout",
  });
  assert.ok(args.includes("--available-tools=read,search"));
  assert.ok(args.includes("--allow-tool=read,search"));
  assert.ok(!args.includes("--allow-tool=write"));
  assert.ok(!args.includes("--available-tools=read,search,edit"));
  assert.ok(!args.includes("--trust-folder"));
});

test("main merge protection requires the docs check, up-to-date branches, and no human approvals", () => {
  const protection = {
    required_status_checks: {
      strict: true,
      checks: [{ context: "Docs maintenance / Verify docs maintenance PR", app_id: 15368 }],
    },
    required_pull_request_reviews: {
      required_approving_review_count: 0,
      require_code_owner_reviews: false,
      require_last_push_approval: false,
    },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  };
  assert.doesNotThrow(() => validateMainProtection(protection));
  assert.throws(() => validateMainProtection({
    ...protection,
    required_status_checks: { ...protection.required_status_checks, strict: false },
  }), /up-to-date/);
  assert.throws(() => validateMainProtection({
    ...protection,
    required_status_checks: {
      ...protection.required_status_checks,
      checks: [{ context: "Docs maintenance / Verify docs maintenance PR", app_id: null }],
    },
  }), /GitHub Actions/);
  assert.throws(() => validateMainProtection({
    ...protection,
    required_pull_request_reviews: { required_approving_review_count: 1 },
  }), /human pull request approval/);
  assert.throws(() => validateMainProtection({
    ...protection,
    allow_force_pushes: { enabled: true },
  }), /force pushes/);
});

test("baseline tags require app-only creation and immutable active rulesets", () => {
  const appId = 123456;
  const rulesets = [
    {
      target: "tag",
      enforcement: "active",
      conditions: { ref_name: { include: ["refs/tags/docs-maintenance-verified-*"], exclude: [] } },
      rules: [{ type: "creation" }],
      bypass_actors: [{ actor_type: "Integration", actor_id: appId, bypass_mode: "always" }],
    },
    {
      target: "tag",
      enforcement: "active",
      conditions: { ref_name: { include: ["refs/tags/docs-maintenance-verified-*"], exclude: [] } },
      rules: [{ type: "update" }, { type: "deletion" }],
      bypass_actors: [],
      current_user_can_bypass: "never",
    },
  ];
  assert.doesNotThrow(() => validateVerifiedTagRulesets(rulesets, appId));
  assert.throws(() => validateVerifiedTagRulesets(rulesets.slice(0, 1), appId), /create-only and immutable/);
  assert.throws(() => validateVerifiedTagRulesets([
    ...rulesets.slice(0, 1),
    { ...rulesets[1], bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5 }] },
  ], appId), /create-only and immutable/);
  assert.throws(() => validateVerifiedTagRulesets(rulesets, 0), /protected docs baseline tag policy/);
});

test("PR scope planning skips app policy for source-only changes and rejects screenshots", async () => {
  const { root, base: sourceBase } = createRepository();
  writeFileSync(path.join(root, "feature.ts"), "export const active = false;\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "source change");
  const sourceHead = git(root, "rev-parse", "HEAD");
  const outputDirectory = mkdtempSync(path.join(os.tmpdir(), "touchline-docs-output-test-"));
  temporaryDirectories.push(outputDirectory);
  const output = path.join(outputDirectory, "github-output");
  const previousOutput = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = output;
  try {
    await main([
      "plan-pr",
      "--candidate-root", root,
      "--base", sourceBase,
      "--head", sourceHead,
    ]);
    assert.match(readFileSync(output, "utf8"), /verify_docs=false/);

    writeFileSync(path.join(root, "README.md"), "# Updated docs\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "documentation change");
    const docsHead = git(root, "rev-parse", "HEAD");
    await main([
      "plan-pr",
      "--candidate-root", root,
      "--base", sourceHead,
      "--head", docsHead,
    ]);
    assert.match(readFileSync(output, "utf8"), /verify_docs=true/);

    const imagePath = path.join(root, "website", "public", "images", "game", "shot.png");
    mkdirSync(path.dirname(imagePath), { recursive: true });
    writeFileSync(imagePath, "not an authentic screenshot");
    git(root, "add", ".");
    git(root, "commit", "-qm", "screenshot");
    const screenshotHead = git(root, "rev-parse", "HEAD");
    await assert.rejects(main([
      "plan-pr",
      "--candidate-root", root,
      "--base", docsHead,
      "--head", screenshotHead,
    ]), /Screenshot changes require separately authenticated provenance/);
  } finally {
    if (previousOutput === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = previousOutput;
  }
});

test("active main rulesets cannot require human approvals", () => {
  assert.doesNotThrow(() => validateMainRules([
    { type: "required_status_checks", parameters: { required_status_checks: [] } },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        require_code_owner_review: false,
        require_last_push_approval: false,
      },
    },
  ]));
  for (const parameters of [
    { required_approving_review_count: 1 },
    { require_code_owner_review: true },
    { require_last_push_approval: true },
  ]) {
    assert.throws(() => validateMainRules([
      { type: "pull_request", parameters },
    ]), /human pull request approval/);
  }
  assert.throws(() => validateMainRules(null), /active main branch rules/);
});

test("prompts pin exact revisions and enumerate changed files", () => {
  const writer = writerPrompt({
    sourceHead: head, reportBase: base, mode: "affected",
    changedPaths: ["server/transfers.ts", "src/transfer.test.ts"],
  });
  assert.match(writer, new RegExp(head));
  assert.match(writer, new RegExp(base));
  assert.match(writer, /server\/transfers\.ts/);
  assert.match(writer, /Do not execute commands/);

  const checker = checkerPrompt({
    head, base, mode: "baseline", changedPaths: ["README.md"],
  });
  assert.match(checker, new RegExp(head));
  assert.match(checker, new RegExp(base));
  assert.match(checker, /README\.md/);
  assert.match(checker, /exactly one JSON object/);
});

test("checker response must be current, complete, passing, and fully reviewed", () => {
  const valid = {
    schemaVersion: 1,
    headSha: head,
    baseSha: base,
    claims: [{ status: "supported" }],
    omissions: [],
    coverage: { reviewedFiles: ["README.md"], unreviewedFiles: [] },
  };
  assert.equal(reportHasPassShape(valid, head, base), valid);
  assert.throws(() => reportHasPassShape({ ...valid, headSha: base }, head, base), /incomplete or stale/);
  assert.throws(() => reportHasPassShape({
    ...valid, claims: [{ status: "unverified" }],
  }, head, base), /unsupported claim/);
  assert.throws(() => reportHasPassShape({
    ...valid, coverage: { ...valid.coverage, unreviewedFiles: ["README.md"] },
  }, head, base), /incomplete or stale/);
});
