import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  findLastPublishedSource,
  isAllowedDocumentationPath,
  isAutomationOwnedPath,
  isRelevantSourceChange,
  listChangedPaths,
  requiresFullBaseline,
  shouldRunMaintenance,
  validateDocumentationDiff,
  validateWorkingTree,
} from "./maintenance.mjs";

const repositories = [];

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function createRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), "touchline-docs-test-"));
  repositories.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.name", "Docs test");
  git(root, "config", "user.email", "docs-test@example.invalid");
  mkdirSync(path.join(root, "server"), { recursive: true });
  writeFileSync(path.join(root, "README.md"), "# Guide\n");
  writeFileSync(path.join(root, "server", "feature.ts"), "export const active = true;\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  return { root, initial: git(root, "rev-parse", "HEAD") };
}

function commit(root, message) {
  git(root, "add", "-A");
  git(root, "commit", "-qm", message);
  return git(root, "rev-parse", "HEAD");
}

test.afterEach(() => {
  for (const root of repositories.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("the output allowlist accepts documentation but not executable, config, or traversal paths", () => {
  for (const file of [
    "README.md",
    "DEVELOPMENT.md",
    "website/src/content/docs/getting-started.md",
    "website/public/images/game/screenshot.webp",
  ]) assert.equal(isAllowedDocumentationPath(file), true, file);
  for (const file of [
    "../README.md",
    "/README.md",
    "website/src/content/docs/../../package.json",
    "website/src/content/docs/component.mdx",
    "website/src/content/docs/script.js",
    "website/package.json",
    ".github/workflows/ci.yml",
    "website/public/images/game/unsafe.svg",
  ]) assert.equal(isAllowedDocumentationPath(file), false, file);
});

test("source changes trigger maintenance but docs automation and docs-only changes do not", () => {
  assert.equal(isRelevantSourceChange(["server/feature.ts", "README.md"]), true);
  assert.equal(isRelevantSourceChange(["README.md", "website/src/content/docs/guide.md"]), false);
  assert.equal(isRelevantSourceChange([".github/scripts/docs/runtime.mjs"]), false);
  assert.equal(isAutomationOwnedPath(".github/agents/docs-writer.agent.md"), true);
  assert.equal(isAutomationOwnedPath(".github/agents/docs-fact-checker.agent.md"), true);
  assert.equal(requiresFullBaseline([".github/scripts/docs/fact-check.mjs"]), true);
  assert.equal(requiresFullBaseline([".github/scripts/docs/maintenance.test.mjs"]), true);
  assert.equal(requiresFullBaseline([".github/workflows/docs-maintenance.yml"]), true);
  assert.equal(shouldRunMaintenance([".github/agents/docs-fact-checker.agent.md"]), true);
  assert.equal(shouldRunMaintenance(["README.md"]), false);
  assert.equal(shouldRunMaintenance(["README.md"], true), true);
});

test("change inventory is NUL-safe and docs-only proposals pass the allowlist", () => {
  const { root, initial } = createRepository();
  writeFileSync(path.join(root, "README.md"), "# Updated guide\n");
  const head = commit(root, "docs");
  assert.deepEqual(listChangedPaths(root, initial, head), ["README.md"]);
  assert.deepEqual(validateDocumentationDiff(root, initial, head), ["README.md"]);
});

test("source-code modifications are rejected as documentation output", () => {
  const { root, initial } = createRepository();
  writeFileSync(path.join(root, "server", "feature.ts"), "export const active = false;\n");
  const head = commit(root, "unexpected source change");
  assert.throws(() => validateDocumentationDiff(root, initial, head), /outside the documentation allowlist/);
});

test("symlink and executable documentation are rejected", () => {
  const { root, initial } = createRepository();
  const docsDirectory = path.join(root, "website", "src", "content", "docs");
  mkdirSync(docsDirectory, { recursive: true });
  symlinkSync("../../../README.md", path.join(docsDirectory, "guide.md"));
  const symlinkHead = commit(root, "add symlink");
  assert.throws(() => validateDocumentationDiff(root, initial, symlinkHead), /symlink or executable/);

  const nextBase = symlinkHead;
  rmSync(path.join(docsDirectory, "guide.md"));
  writeFileSync(path.join(docsDirectory, "guide.md"), "Guide\n");
  chmodSync(path.join(docsDirectory, "guide.md"), 0o755);
  const executableHead = commit(root, "add executable guide");
  assert.throws(() => validateDocumentationDiff(root, nextBase, executableHead), /regular non-executable/);
});

test("published source marker is accepted only from a docs-only descendant commit", () => {
  const { root, initial } = createRepository();
  writeFileSync(path.join(root, "server", "feature.ts"), "export const active = false;\n");
  const source = commit(root, "change application behavior");
  writeFileSync(path.join(root, "README.md"), "# Updated guide\n");
  const published = commit(root, `docs: refresh documentation from ${source} (#42)`);
  assert.equal(findLastPublishedSource(root, published), source);
  assert.equal(findLastPublishedSource(root, initial), null);
});

test("successful no-change baselines can be anchored by exact-source verification tags", () => {
  const { root, initial } = createRepository();
  git(root, "tag", "--annotate", `docs-maintenance-verified-${initial}`, initial, "-m", "verified");
  assert.equal(findLastPublishedSource(root, initial), initial);
});

test("working-tree validation includes staged and untracked allowlisted files", () => {
  const { root } = createRepository();
  mkdirSync(path.join(root, "website", "src", "content", "docs"), { recursive: true });
  writeFileSync(path.join(root, "website", "src", "content", "docs", "guide.md"), "Guide\n");
  assert.deepEqual(validateWorkingTree(root).files, [
    "website/src/content/docs/guide.md",
  ]);
  git(root, "add", "website/src/content/docs/guide.md");
  assert.equal(validateWorkingTree(root).patch.byteLength > 0, true);
});
