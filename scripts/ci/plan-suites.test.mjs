import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requiresApplicationCi } from "./plan-suites.mjs";

const ignoredPaths = new Map([
  ["**/*.md", ["README.md", "server/README.md"]],
  ["LICENSE", ["LICENSE"]],
  [".env.example", [".env.example"]],
  [".copilot/**", [".copilot/settings.json"]],
  [".vscode/**", [".vscode/settings.json"]],
  [".mcp.json", [".mcp.json"]],
  [".github/agents/**", [".github/agents/docs-writer.agent.yml"]],
  [".github/skills/**", [".github/skills/docs/verify.mjs"]],
  [".github/scripts/docs/**", [".github/scripts/docs/runtime.mjs", ".github/scripts/docs/nested/check.mjs"]],
  ["docs/**", ["docs/src/pages/index.astro", "docs/src/content/docs/guide.mdx"]],
  [".github/workflows/docs.yml", [".github/workflows/docs.yml"]],
  [".github/workflows/docs-maintenance.yml", [".github/workflows/docs-maintenance.yml"]],
]);
const ignoredSamples = [...ignoredPaths.values()].flat();
const ciWorkflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

test("push ignore paths and PR planning cover the same docs/editor/automation-only set", () => {
  const push = ciWorkflow.match(/^  push:\n([\s\S]*?)(?=^  \w)/m)?.[1];
  assert.ok(push, "push trigger must exist");
  const patterns = [...push.matchAll(/^\s+- "([^"]+)"$/gm)].map((match) => match[1]);
  assert.deepEqual(patterns, [...ignoredPaths.keys()]);
  for (const sample of ignoredSamples) {
    assert.equal(requiresApplicationCi([sample]), false, sample);
  }
  assert.equal(requiresApplicationCi(ignoredSamples), false);
  assert.equal(requiresApplicationCi([]), false);
});

test("application and non-ignored automation changes require CI suites", () => {
  for (const path of [
    "src/App.tsx",
    "server/index.ts",
    ".github/workflows/ci.yml",
    ".github/workflows/cd.yml",
    ".github/scripts/other.mjs",
    ".github/scripts/docs-other/runtime.mjs",
    ".github/workflows/docs-maintenance.yml.bak",
    "scripts/ci/plan-suites.mjs",
  ]) {
    assert.equal(requiresApplicationCi([path]), true, path);
    assert.equal(requiresApplicationCi([...ignoredSamples, path]), true, `mixed changes: ${path}`);
  }
});

test("every PR keeps the unfiltered Required CI gate and docs automation tests", () => {
  const pullRequest = ciWorkflow.match(/^  pull_request:\n([\s\S]*?)(?=^\S)/m)?.[1];
  assert.ok(pullRequest, "pull_request trigger must exist");
  assert.doesNotMatch(pullRequest, /\bpaths(?:-ignore)?:/);
  assert.match(ciWorkflow, /name: Required CI/);
  assert.match(ciWorkflow, /run: node --test scripts\/ci\/plan-suites\.test\.mjs/);
  const docsWorkflow = readFileSync(new URL("../../.github/workflows/docs-maintenance.yml", import.meta.url), "utf8");
  const docsPullRequest = docsWorkflow.match(/^  pull_request:\n([\s\S]*?)(?=^\S)/m)?.[1];
  assert.ok(docsPullRequest, "docs automation must run on pull requests");
  assert.doesNotMatch(docsPullRequest, /\bpaths(?:-ignore)?:/);
  assert.match(docsWorkflow, /run: node --test candidate\/\.github\/scripts\/docs\/\*\.test\.mjs/);
  assert.match(docsWorkflow, /run: node --test trusted\/\.github\/scripts\/docs\/maintenance\.test\.mjs trusted\/\.github\/scripts\/docs\/runtime\.test\.mjs/);
});

test("invalid path inventories fail rather than silently skipping CI", () => {
  assert.throws(() => requiresApplicationCi(null), /array of strings/);
  assert.throws(() => requiresApplicationCi(["README.md", null]), /array of strings/);
});
