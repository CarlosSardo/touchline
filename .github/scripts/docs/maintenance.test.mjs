import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  isAllowedDocumentationPath,
  isDocumentationScopePath,
  isAutomationOwnedPath,
  isUnsupportedScreenshotPath,
  isRelevantSourceChange,
  authenticateArtworkBytes,
  documentationSite,
  listChangedPaths,
  requiresFullBaseline,
  shouldRunMaintenance,
  reviewedArtworkPaths,
  unchangedSiteMoves,
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
    "docs/src/content/docs/getting-started.md",
  ]) assert.equal(isAllowedDocumentationPath(file), true, file);
  for (const file of [
    "website/src/content/docs/advanced.mdx",
    "website/public/images/game/screenshot.webp",
    "website/public/images/game/unsafe.svg",
    "docs/public/images/game/unsafe.svg",
    "docs/src/content/docs/advanced.mdx",
  ]) {
    assert.equal(isAllowedDocumentationPath(file), false, file);
    assert.equal(isDocumentationScopePath(file), true, file);
  }
  assert.equal(isUnsupportedScreenshotPath("website/public/images/game/screenshot.webp"), true);
  assert.equal(isUnsupportedScreenshotPath("website/public/images/game/screenshot.svg"), true);
  for (const file of ["docs/public/images/social/touchline-docs.png", "docs/scripts/social-card.html"]) {
    assert.equal(isDocumentationScopePath(file), true);
    assert.equal(isAllowedDocumentationPath(file), false);
  }
  for (const file of [
    "../README.md",
    "/README.md",
    "website/src/content/docs/../../package.json",
    "website/src/content/docs/component.mdx",
    "website/src/content/docs/script.js",
    "website/package.json",
    "docs/package.json",
    "docs/src/content/docs/../../package.json",
    ".github/workflows/ci.yml",
  ]) assert.equal(isAllowedDocumentationPath(file), false, file);
});

test("exactly one tracked regular site manifest pair is required", () => {
  const { root } = createRepository();
  assert.throws(() => documentationSite(root), /Exactly one/);
  mkdirSync(path.join(root, "website"));
  writeFileSync(path.join(root, "website", "package.json"), "{}");
  writeFileSync(path.join(root, "website", "package-lock.json"), "{}");
  commit(root, "website manifests");
  assert.equal(documentationSite(root), "website");
  mkdirSync(path.join(root, "docs"));
  writeFileSync(path.join(root, "docs", "package.json"), "{}");
  commit(root, "ambiguous manifest roots");
  assert.throws(() => documentationSite(root), /Exactly one/);
  rmSync(path.join(root, "docs", "package.json"));
  chmodSync(path.join(root, "website", "package.json"), 0o755);
  commit(root, "executable manifest");
  assert.throws(() => documentationSite(root), /regular non-executable/);
});

test("one-way site migration recognizes only identical regular blobs and preserves writer restrictions", () => {
  const { root } = createRepository();
  mkdirSync(path.join(root, "website", "src", "content", "docs"), { recursive: true });
  mkdirSync(path.join(root, "website", "public", "images", "game"), { recursive: true });
  writeFileSync(path.join(root, "website", "package.json"), "{}");
  writeFileSync(path.join(root, "website", "package-lock.json"), "{}");
  for (let index = 0; index < 60; index += 1) {
    writeFileSync(path.join(root, "website", "src", "content", "docs", `${index}.md`),
      "# Guide\n\n![Existing screenshot](/images/game/shot.png)\n");
  }
  writeFileSync(path.join(root, "website", "public", "images", "game", "shot.png"), Buffer.from([137, 80, 78, 71, 0]));
  const base = commit(root, "original site");
  writeFileSync(path.join(root, "README.md"),
    '# Guide\n\n[![Docs](https://example.invalid/badge.svg)](website/)\n\n<img src="website/public/images/game/shot.png" alt="Existing screenshot">\n');
  const linkedBase = commit(root, "original linked site");
  renameSync(path.join(root, "website"), path.join(root, "docs"));
  writeFileSync(path.join(root, "README.md"),
    '# Guide\n\n[![Docs](https://example.invalid/badge.svg)](https://example.invalid/docs/)\n\n<img src="docs/public/images/game/shot.png" alt="Existing screenshot">\n');
  const head = commit(root, "move site without changing bytes");
  const moves = unchangedSiteMoves(root, linkedBase, head);
  assert.equal(moves.size, 63);
  assert.equal(moves.get("website/public/images/game/shot.png"), "docs/public/images/game/shot.png");
  assert.equal(documentationSite(root), "docs");
  assert.doesNotThrow(() => validateDocumentationDiff(root, linkedBase, head, { allowSourceChanges: true }));
  assert.throws(() => validateDocumentationDiff(root, base, head, { allowSourceChanges: true }), /Image references/);
  assert.throws(() => validateDocumentationDiff(root, base, head), /limit|allowlist/);
  for (let index = 0; index < 25; index += 1) {
    writeFileSync(path.join(root, "docs", "src", "content", "docs", `${index}.md`),
      "# Updated guide\n\n![Existing screenshot](/images/game/shot.png)\n");
  }
  const edited = commit(root, "move site with genuine guide changes");
  assert.equal(unchangedSiteMoves(root, linkedBase, edited).size, 38);
  assert.doesNotThrow(() => validateDocumentationDiff(root, linkedBase, edited, { allowSourceChanges: true }));
  const guidePath = path.join(root, "docs", "src", "content", "docs", "0.md");
  writeFileSync(guidePath, "# Guide\n\n![New screenshot](/images/game/other.png)\n");
  const imageChange = commit(root, "changed image reference remains prohibited after relocation");
  assert.throws(() => validateDocumentationDiff(root, linkedBase, imageChange, { allowSourceChanges: true }), /Image references/);
  writeFileSync(guidePath, "# Updated guide\n\n![Existing screenshot](/images/game/shot.png)\n");
  writeFileSync(path.join(root, "docs", "public", "images", "game", "shot.png"), "different image bytes");
  const changed = commit(root, "altered image must not qualify as relocation");
  assert.equal(unchangedSiteMoves(root, linkedBase, changed).has("website/public/images/game/shot.png"), false);
  writeFileSync(path.join(root, "docs", "public", "images", "game", "shot.png"), Buffer.from([137, 80, 78, 71, 0]));
  chmodSync(path.join(root, "docs", "src", "content", "docs", "0.md"), 0o755);
  const executable = commit(root, "mode changed");
  assert.equal(unchangedSiteMoves(root, linkedBase, executable).has("website/src/content/docs/0.md"), false);
  assert.throws(() => validateDocumentationDiff(root, linkedBase, executable, { allowSourceChanges: true }), /executable/);
});

test("reviewed artwork requires exact image/source digests and PNG dimensions", () => {
  const image = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(image);
  image.writeUInt32BE(13, 8);
  image.write("IHDR", 12);
  image.writeUInt32BE(1200, 16);
  image.writeUInt32BE(630, 20);
  const source = Buffer.from("<h1>Intentional artwork</h1>\n");
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const expected = { imageSha256: digest(image), sourceSha256: digest(source) };
  assert.doesNotThrow(() => authenticateArtworkBytes(image, source, expected));
  assert.throws(() => authenticateArtworkBytes(image, source), /differs/);
  assert.throws(() => authenticateArtworkBytes(image, Buffer.from("different"), expected), /differs/);
  image[32] = 1;
  assert.throws(() => authenticateArtworkBytes(image, source, expected), /differs/);
  image.writeUInt32BE(1199, 16);
  assert.throws(() => authenticateArtworkBytes(image, source, {
    ...expected, imageSha256: digest(image),
  }), /1200x630/);
});

test("artwork attestation cannot accept missing, relocated, executable, or fabricated source/image", () => {
  const { root, initial } = createRepository();
  assert.equal(reviewedArtworkPaths(root, initial).size, 0);
  mkdirSync(path.join(root, "docs", "scripts"), { recursive: true });
  writeFileSync(path.join(root, "docs", "scripts", "social-card.html"), "<h1>Unreviewed</h1>\n");
  assert.throws(() => reviewedArtworkPaths(root, commit(root, "missing image")), /both be tracked/);
  mkdirSync(path.join(root, "docs", "public", "images", "social"), { recursive: true });
  const imagePath = path.join(root, "docs", "public", "images", "social", "touchline-docs.png");
  writeFileSync(imagePath, Buffer.from([137, 80, 78, 71, 0]));
  assert.throws(() => reviewedArtworkPaths(root, commit(root, "unreviewed bytes")), /differs/);
  chmodSync(imagePath, 0o755);
  assert.throws(() => reviewedArtworkPaths(root, commit(root, "executable image")), /regular non-executable/);
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

test("badge hyperlinks are independent of image src/alt and ambiguous images fail closed", () => {
  const { root } = createRepository();
  writeFileSync(path.join(root, "README.md"), "[![Docs](https://example.invalid/badge.svg)](website/)\n");
  const base = commit(root, "existing badge");
  writeFileSync(path.join(root, "README.md"), "[![Docs](https://example.invalid/badge.svg)](https://example.invalid/docs/)\n");
  assert.doesNotThrow(() => validateDocumentationDiff(root, base, commit(root, "new badge hyperlink")));
  for (const [label, markup] of [
    ["changed src", "[![Docs](https://example.invalid/other.svg)](https://example.invalid/docs/)\n"],
    ["changed alt", "[![Unverified](https://example.invalid/badge.svg)](https://example.invalid/docs/)\n"],
    ["ambiguous syntax", "![ambiguous image]\n"],
  ]) {
    writeFileSync(path.join(root, "README.md"), markup);
    const head = commit(root, label);
    assert.throws(() => validateDocumentationDiff(root, base, head), /Image references|Unsupported image/);
  }
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
