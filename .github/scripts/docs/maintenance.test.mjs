import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  findLastPublishedSource,
  isAllowedDocumentationPath,
  isDocumentationScopePath,
  isAutomationOwnedPath,
  isUnsupportedScreenshotPath,
  isRelevantSourceChange,
  listChangedPaths,
  requiresFullBaseline,
  shouldRunMaintenance,
  validateDocumentationDiff,
  validateDocumentationContent,
  validateWorkingTree,
} from "./maintenance.mjs";

const repositories = [];
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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
  ]) assert.equal(isAllowedDocumentationPath(file), true, file);
  for (const file of [
    "website/src/content/docs/advanced.mdx",
    "website/public/images/game/screenshot.webp",
    "website/public/images/game/unsafe.svg",
  ]) {
    assert.equal(isAllowedDocumentationPath(file), false, file);
    assert.equal(isDocumentationScopePath(file), true, file);
  }
  assert.equal(isUnsupportedScreenshotPath("website/public/images/game/screenshot.webp"), true);
  assert.equal(isUnsupportedScreenshotPath("website/public/images/game/screenshot.svg"), true);
  for (const file of [
    "../README.md",
    "/README.md",
    "website/src/content/docs/../../package.json",
    "website/src/content/docs/component.mdx",
    "website/src/content/docs/script.js",
    "website/package.json",
    ".github/workflows/ci.yml",
  ]) assert.equal(isAllowedDocumentationPath(file), false, file);
});

test("source changes trigger maintenance but docs automation and docs-only changes do not", () => {
  assert.equal(isRelevantSourceChange(["server/feature.ts", "README.md"]), true);
  assert.equal(isRelevantSourceChange(["website/public/images/game/screenshot.webp"]), true);
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
  assert.deepEqual(validateDocumentationDiff(root, initial, head, { allowSourceChanges: true }), [
    "server/feature.ts",
  ]);
});

test("mixed documentation changes cannot include automation-owned files", () => {
  const { root, initial } = createRepository();
  writeFileSync(path.join(root, "README.md"), "# Updated guide\n");
  mkdirSync(path.join(root, ".github", "scripts", "docs"), { recursive: true });
  writeFileSync(path.join(root, ".github", "scripts", "docs", "runtime.mjs"), "export {};\n");
  const head = commit(root, "mix guide and automation changes");
  assert.throws(
    () => validateDocumentationDiff(root, initial, head, { allowSourceChanges: true }),
    /outside the documentation allowlist/,
  );
});

test("documentation output blocks unsafe HTML and executable URLs but permits safe markup and code", () => {
  const { root, initial } = createRepository();
  writeFileSync(path.join(root, "README.md"), [
    "# Safe guide",
    '<div align="center">Safe content</div>',
    "<https://example.com/docs>",
    "",
    "```html",
    "<script>alert(1)</script>",
    "```",
    "",
  ].join("\n"));
  const safeHead = commit(root, "safe code example");
  assert.deepEqual(validateDocumentationDiff(root, initial, safeHead), ["README.md"]);

  writeFileSync(path.join(root, "README.md"), "# Unsafe guide\n\n<script>alert(1)</script>\n");
  const htmlHead = commit(root, "raw HTML");
  assert.throws(() => validateDocumentationDiff(root, safeHead, htmlHead), /Unsafe or unsupported HTML/);

  writeFileSync(path.join(root, "README.md"), "\\` escaped <script>alert(1)</script> `\n");
  const escapedHead = commit(root, "escaped code delimiter");
  assert.throws(() => validateDocumentationDiff(root, htmlHead, escapedHead), /Unsafe or unsupported HTML/);

  writeFileSync(path.join(root, "README.md"), '<img src="image.png" onerror="alert(1)">\n');
  const handlerHead = commit(root, "event handler");
  assert.throws(() => validateDocumentationDiff(root, escapedHead, handlerHead), /Executable HTML attributes/);

  writeFileSync(path.join(root, "README.md"), '<img alt=">" onerror="alert(1)" src="image.png">\n');
  const quotedHandlerHead = commit(root, "quoted event handler");
  assert.throws(() => validateDocumentationDiff(root, handlerHead, quotedHandlerHead), /Executable HTML attributes/);

  writeFileSync(path.join(root, "README.md"), "[click](javascript&#x3a;alert(1))\n");
  const urlHead = commit(root, "executable link");
  assert.throws(() => validateDocumentationDiff(root, quotedHandlerHead, urlHead), /Executable or local-resource URL/);
});

test("image references cannot be added or changed without authenticated provenance", () => {
  const { root } = createRepository();
  writeFileSync(path.join(root, "README.md"), [
    "# Existing images",
    '<img src="website/public/images/game/example.png" alt="Example">',
    "![CI](https://example.com/status.svg)",
    "",
  ].join("\n"));
  const base = commit(root, "add existing images");

  writeFileSync(path.join(root, "README.md"), [
    "# Existing images",
    '<img src="website/public/images/game/replacement.png" alt="Example">',
    "![CI](https://example.com/status.svg)",
    "",
  ].join("\n"));
  const head = commit(root, "change screenshot reference");
  assert.throws(
    () => validateDocumentationDiff(root, base, head),
    /Image references cannot change without authenticated provenance/,
  );
});

test("tracked documentation uses only supported non-executable markup", () => {
  const files = git(workspaceRoot, "ls-files").split("\n").filter(isAllowedDocumentationPath);
  for (const file of files) {
    validateDocumentationContent(file, readFileSync(path.join(workspaceRoot, file), "utf8"));
  }
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
