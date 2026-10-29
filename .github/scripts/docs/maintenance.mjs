import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const MAX_FILES = 80;
const MAX_DIFF_BYTES = 512 * 1024;
export const REVIEWED_SOCIAL_ARTWORK = Object.freeze({
  imagePath: "docs/public/images/social/touchline-docs.png",
  sourcePath: "docs/scripts/social-card.html",
  imageSha256: "80b29db681d49c8554180a210073a5e5d60ee68c53a621edf93edd76ac7dd91e",
  sourceSha256: "2e6ce0dea9bc2847b679de0ba4021a7406ffa811453ec0c87d0ca6cbfba8b680",
});
const SAFE_HTML_TAGS = new Set([
  "a", "abbr", "b", "blockquote", "br", "caption", "code", "dd", "del",
  "details", "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2",
  "h3", "h4", "hr", "i", "img", "li", "ol", "p", "pre", "s", "small",
  "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "th",
  "thead", "tr", "u", "ul",
]);

export function assertSha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character commit SHA`);
  }
  return value;
}

export function isAllowedDocumentationPath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") ||
      value.includes("\0") || value.startsWith("/") ||
      value.split("/").some((part) => !part || part === "." || part === "..")) {
    return false;
  }
  if (/^(README|DEVELOPMENT|CONTRIBUTING|REQUIREMENTS)\.md$/.test(value)) {
    return true;
  }
  return /^(website|docs)\/src\/content\/docs\/.+\.md$/.test(value);
}

export function isDocumentationScopePath(value) {
  return isAllowedDocumentationPath(value) ||
    value === REVIEWED_SOCIAL_ARTWORK.imagePath || value === REVIEWED_SOCIAL_ARTWORK.sourcePath ||
    /^(website|docs)\/src\/content\/docs\/.+\.mdx$/.test(value) ||
    /^(website|docs)\/public\/images\/game\/.+$/.test(value);
}

export function isUnsupportedScreenshotPath(value) {
  return /^(website|docs)\/public\/images\/game\/.+$/.test(value);
}

export function isAutomationOwnedPath(value) {
  return value === ".github/workflows/docs-maintenance.yml" ||
    /^\.github\/agents\/docs-(writer|fact-checker)\.agent\.md$/.test(value) ||
    value.startsWith(".github/scripts/docs/");
}

export function requiresFullBaseline(paths) {
  return paths.some((value) =>
    value === ".github/workflows/docs-maintenance.yml" ||
    /^\.github\/agents\/docs-(writer|fact-checker)\.agent\.md$/.test(value) ||
    /^\.github\/scripts\/docs\/(?:maintenance|runtime|fact-check)(?:[-.].*)?\.mjs$/.test(value));
}

export function isRelevantSourceChange(paths) {
  return paths.some((value) =>
    !isAllowedDocumentationPath(value) && !isAutomationOwnedPath(value));
}

function runGit(root, args, options = {}) {
  const output = execFileSync("git", ["--no-pager", "-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0" },
    ...options,
  });
  return typeof output === "string" ? output.trimEnd() : "";
}

function trackedMode(root, revision, filePath) {
  const entries = runGit(root, ["ls-tree", "-r", "-z", revision, "--", `:(literal)${filePath}`])
    .split("\0").filter(Boolean);
  const entry = entries.find((item) => item.slice(item.indexOf("\t") + 1) === filePath);
  return entry ? entry.slice(0, entry.indexOf(" ")).split(" ")[0] : null;
}

export function documentationSite(root, revision = "HEAD") {
  const candidates = ["website", "docs"].filter((directory) =>
    trackedMode(root, revision, `${directory}/package.json`) !== null ||
    trackedMode(root, revision, `${directory}/package-lock.json`) !== null);
  if (candidates.length !== 1) {
    throw new Error("Exactly one documentation site root (website or docs) is required");
  }
  const directory = candidates[0];
  if (lstatSync(path.join(root, directory)).isSymbolicLink()) {
    throw new Error("Documentation site root must not be a symlink");
  }
  for (const name of ["package.json", "package-lock.json"]) {
    assertRegularNonExecutable(root, revision, `${directory}/${name}`);
    if (trackedMode(root, revision, `${directory}/${name}`) !== "100644") {
      throw new Error("Documentation site manifests must be tracked regular files");
    }
  }
  return directory;
}

function siteMoves(root, base, head, unchangedOnly) {
  assertSha(base, "base");
  assertSha(head, "head");
  const trees = [base, head].map((revision) => new Map(
    runGit(root, ["ls-tree", "-r", "-z", revision]).split("\0").filter(Boolean).map((entry) => {
      const tab = entry.indexOf("\t");
      return [entry.slice(tab + 1), entry.slice(0, tab)];
    }),
  ));
  const [before, after] = trees;
  const result = new Map();
  if (!before.has("website/package.json") || before.has("docs/package.json") ||
      after.has("website/package.json") || !after.has("docs/package.json") ||
      [...after.keys()].some((name) => name.startsWith("website/"))) return result;
  for (const [oldPath, entry] of before) {
    if (!oldPath.startsWith("website/") || !/^100644 blob /.test(entry)) continue;
    const newPath = `docs/${oldPath.slice("website/".length)}`;
    const target = after.get(newPath);
    if (!before.has(newPath) && !after.has(oldPath) && /^100644 blob /.test(target ?? "") &&
        (!unchangedOnly || target === entry)) {
      result.set(oldPath, newPath);
    }
  }
  return result;
}

export function unchangedSiteMoves(root, base, head) {
  return siteMoves(root, base, head, true);
}

export function authenticateArtworkBytes(image, source, expected = REVIEWED_SOCIAL_ARTWORK) {
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  if (digest(image) !== expected.imageSha256 || digest(source) !== expected.sourceSha256) {
    throw new Error("Social artwork or its source differs from the independently reviewed exact artifact");
  }
  if (image.length < 33 || image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      image.readUInt32BE(8) !== 13 || image.subarray(12, 16).toString("ascii") !== "IHDR" ||
      image.readUInt32BE(16) !== 1200 || image.readUInt32BE(20) !== 630) {
    throw new Error("Reviewed social artwork must be a 1200x630 PNG");
  }
}

export function reviewedArtworkPaths(root, head) {
  assertSha(head, "head");
  const { imagePath, sourcePath } = REVIEWED_SOCIAL_ARTWORK;
  const paths = [imagePath, sourcePath];
  if (paths.every((name) => trackedMode(root, head, name) === null)) return new Map();
  for (const name of paths) {
    if (trackedMode(root, head, name) !== "100644") {
      throw new Error(`Reviewed artwork and source must both be tracked regular non-executable files: ${name}`);
    }
    assertRegularNonExecutable(root, head, name);
  }
  const [image, source] = paths.map((name) => execFileSync("git", [
    "--no-pager", "-C", root, "show", `${head}:${name}`,
  ], { maxBuffer: 8 * 1024 * 1024 }));
  authenticateArtworkBytes(image, source);
  return new Map([[imagePath, sourcePath]]);
}

function assertRegularNonExecutable(root, revision, filePath) {
  const mode = trackedMode(root, revision, filePath);
  if (mode !== null && mode !== "100644") {
    throw new Error(`Documentation output must be a regular non-executable file: ${filePath}`);
  }
  const absolute = path.join(root, filePath);
  try {
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o111) !== 0) {
      throw new Error(`Documentation output must not be a symlink or executable: ${filePath}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function withoutMarkdownCode(source) {
  let fence = null;
  const visible = source.split("\n").map((line) => {
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`);
      if (close.test(line)) fence = null;
      return "";
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening && (opening[1][0] === "~" || !opening[2].includes("`"))) {
      fence = { character: opening[1][0], length: opening[1].length };
      return "";
    }
    return line;
  }).join("\n");
  const masked = visible.split("");
  const escaped = (index) => {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && visible[cursor] === "\\"; cursor -= 1) slashes += 1;
    return slashes % 2 === 1;
  };
  for (let index = 0; index < visible.length;) {
    if (visible[index] !== "`" || escaped(index)) {
      index += 1;
      continue;
    }
    let delimiterLength = 1;
    while (visible[index + delimiterLength] === "`") delimiterLength += 1;
    let closing = -1;
    for (let cursor = index + delimiterLength; cursor < visible.length;) {
      if (visible[cursor] !== "`" || escaped(cursor)) {
        cursor += 1;
        continue;
      }
      let closingLength = 1;
      while (visible[cursor + closingLength] === "`") closingLength += 1;
      if (closingLength === delimiterLength) {
        closing = cursor;
        break;
      }
      cursor += closingLength;
    }
    if (closing < 0) {
      index += delimiterLength;
      continue;
    }
    for (let cursor = index; cursor < closing + delimiterLength; cursor += 1) {
      if (masked[cursor] !== "\n") masked[cursor] = " ";
    }
    index = closing + delimiterLength;
  }
  return masked.join("");
}

export function validateDocumentationContent(filePath, source) {
  const visible = withoutMarkdownCode(source);
  if (/<!--|<!|<\?/i.test(visible)) {
    throw new Error(`HTML comments and declarations are not allowed in documentation output: ${filePath}`);
  }
  if (/!\[[^\]\n]*\]\s*\[[^\]\n]*\]/.test(visible)) {
    throw new Error(`Reference-style images are unsupported in documentation output: ${filePath}`);
  }
  for (const tag of visible.matchAll(/<\/?\s*([A-Za-z][A-Za-z0-9-]*)\b((?:[^'"<>]|"[^"]*"|'[^']*')*)>/g)) {
    if (/^<(?:https?:\/\/[^<>]+|mailto:[^<>]+|[^<>@\s]+@[^<>@\s]+)>$/i.test(tag[0])) continue;
    if (!SAFE_HTML_TAGS.has(tag[1].toLowerCase())) {
      throw new Error(`Unsafe or unsupported HTML element in documentation output: ${filePath}`);
    }
    if (/(?:^|\s)(?:on[a-z0-9_:-]+|srcdoc|style)\s*(?:=|(?=\s|\/|$))/i.test(tag[2])) {
      throw new Error(`Executable HTML attributes are not allowed in documentation output: ${filePath}`);
    }
  }
  const normalized = visible
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : " ";
    })
    .replace(/&#([0-9]+);?/g, (_match, decimal) => {
      const codePoint = Number.parseInt(decimal, 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : " ";
    })
    .replace(/&colon;/gi, ":")
    .replace(/&Tab;/gi, "\t")
    .replace(/&NewLine;/gi, "\n")
    .replace(/[\u0000-\u0020\u007f]+/g, "");
  if (/\b(?:javascript|vbscript|file):|\bdata:(?:text\/html|image\/svg\+xml|application\/(?:javascript|ecmascript|xml|xhtml\+xml))/i.test(normalized)) {
    throw new Error(`Executable or local-resource URL is not allowed in documentation output: ${filePath}`);
  }
}

function imageMarkup(source) {
  const visible = withoutMarkdownCode(source);
  const markdownPattern = /!\s*\[(?:\\.|[^\]\\\n])*\]\s*\((?:\\.|[^()\\\n]|\((?:\\.|[^()\\\n])*\))*\)/g;
  const markdownImages = [...visible.matchAll(markdownPattern)].map((match) => match[0]);
  if (/!\s*\[/.test(visible.replace(markdownPattern, ""))) {
    throw new Error("Unsupported image markup cannot be verified without authenticated provenance");
  }
  const htmlImages = [...visible.matchAll(/<img\b(?:[^'"<>]|"[^"]*"|'[^']*')*>/gi)]
    .map((match) => match[0]);
  return [...markdownImages, ...htmlImages].sort();
}

function assertImageMarkupUnchanged(filePath, baseSource, headSource, moves) {
  const original = imageMarkup(baseSource).map((markup) => {
    for (const [oldPath, newPath] of moves) {
      const escaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      markup = markup.replace(new RegExp(`(["'(])${escaped}(?=["')\\s])`, "g"),
        (_match, prefix) => `${prefix}${newPath}`);
    }
    return markup;
  }).sort();
  if (JSON.stringify(original) !== JSON.stringify(imageMarkup(headSource))) {
    throw new Error(`Image references cannot change without authenticated provenance: ${filePath}`);
  }
}

export function listChangedPaths(root, base, head) {
  assertSha(base, "base");
  assertSha(head, "head");
  const resolvedRoot = realpathSync(root);
  if (realpathSync(runGit(resolvedRoot, ["rev-parse", "--show-toplevel"])) !== resolvedRoot) {
    throw new Error("root must be a Git checkout root");
  }
  for (const sha of [base, head]) {
    if (runGit(resolvedRoot, ["cat-file", "-t", sha]) !== "commit") {
      throw new Error(`${sha} is not a Git commit`);
    }
  }
  runGit(resolvedRoot, ["merge-base", "--is-ancestor", base, head], { stdio: "ignore" });
  return runGit(resolvedRoot, [
    "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", base, head,
  ]).split("\0").filter(Boolean);
}

export function validateDocumentationDiff(root, base, head, {
  maxFiles = MAX_FILES, allowSourceChanges = false,
} = {}) {
  const resolvedRoot = realpathSync(root);
  const files = listChangedPaths(resolvedRoot, base, head);
  if (allowSourceChanges) reviewedArtworkPaths(resolvedRoot, head);
  const moves = allowSourceChanges ? unchangedSiteMoves(resolvedRoot, base, head) : new Map();
  const relocations = allowSourceChanges ? siteMoves(resolvedRoot, base, head, false) : new Map();
  const relocatedPaths = new Set([...relocations.keys(), ...relocations.values()]);
  const origins = new Map([...relocations].map(([oldPath, newPath]) => [newPath, oldPath]));
  const movedPaths = new Set([...moves.keys(), ...moves.values()]);
  const logicalFiles = files.filter((name) => !relocatedPaths.has(name)).length + relocations.size;
  if (logicalFiles > maxFiles) {
    throw new Error(`Documentation proposal changes ${logicalFiles} logical files; limit is ${maxFiles}`);
  }
  for (const filePath of files) {
    if (movedPaths.has(filePath)) {
      if (isAllowedDocumentationPath(filePath) && trackedMode(root, head, filePath) !== null) {
        validateDocumentationContent(filePath, runGit(root, ["show", `${head}:${filePath}`]));
      }
      continue;
    }
    if (!isAllowedDocumentationPath(filePath)) {
      if (!allowSourceChanges || isAutomationOwnedPath(filePath)) {
        throw new Error(`Change is outside the documentation allowlist: ${filePath}`);
      }
      continue;
    }
    for (const revision of [base, head]) {
      assertRegularNonExecutable(resolvedRoot, revision, filePath);
    }
    if (trackedMode(resolvedRoot, head, filePath) !== null) {
      const headContent = runGit(resolvedRoot, ["show", `${head}:${filePath}`]);
      validateDocumentationContent(filePath, headContent);
      const basePath = origins.get(filePath) ?? filePath;
      const baseContent = trackedMode(resolvedRoot, base, basePath) === null ? "" :
        runGit(resolvedRoot, ["show", `${base}:${basePath}`]);
      assertImageMarkupUnchanged(filePath, baseContent, headContent, moves);
    }
  }
  return files;
}

export function validateWorkingTree(root, { maxFiles = MAX_FILES } = {}) {
  const resolvedRoot = realpathSync(root);
  const tracked = runGit(resolvedRoot, [
    "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z",
  ]).split("\0").filter(Boolean);
  const staged = runGit(resolvedRoot, [
    "diff", "--cached", "--no-ext-diff", "--no-renames", "--name-only", "-z",
  ]).split("\0").filter(Boolean);
  const untracked = runGit(resolvedRoot, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0").filter(Boolean);
  const files = [...new Set([...tracked, ...staged, ...untracked])];
  if (files.length > maxFiles) {
    throw new Error(`Documentation proposal changes ${files.length} files; limit is ${maxFiles}`);
  }
  for (const filePath of files) {
    if (!isAllowedDocumentationPath(filePath)) {
      throw new Error(`Change is outside the documentation allowlist: ${filePath}`);
    }
    const absolute = path.join(resolvedRoot, filePath);
    try {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o111) !== 0) {
        throw new Error(`Documentation output must not be a symlink or executable: ${filePath}`);
      }
      validateDocumentationContent(filePath, readFileSync(absolute, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT" || !tracked.includes(filePath)) throw error;
    }
  }
  const patch = execFileSync("git", [
    "--no-pager", "-C", resolvedRoot, "diff", "--binary", "--no-ext-diff", "HEAD",
  ], { maxBuffer: MAX_DIFF_BYTES + 1 });
  if (patch.byteLength > MAX_DIFF_BYTES) {
    throw new Error(`Documentation proposal exceeds ${MAX_DIFF_BYTES} bytes`);
  }
  execFileSync("git", ["--no-pager", "-C", resolvedRoot, "diff", "--check", "HEAD"], {
    stdio: "ignore",
  });
  return { files, patch };
}

export function shouldRunMaintenance(paths, forceBaseline = false) {
  return forceBaseline || requiresFullBaseline(paths) || isRelevantSourceChange(paths);
}

export function main(args) {
  if (args[0] !== "check-paths") {
    throw new Error("Usage: maintenance.mjs check-paths <base> <head> [--root <checkout>]");
  }
  let root = process.cwd();
  const positional = [];
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--root") {
      root = args[index + 1];
      index += 1;
    } else positional.push(args[index]);
  }
  if (positional.length !== 2) throw new Error("check-paths requires base and head SHAs");
  const files = validateDocumentationDiff(root, positional[0], positional[1]);
  console.log(JSON.stringify({ result: "pass", files }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`DOCS MAINTENANCE BLOCKED: ${error.message}`);
    process.exitCode = 1;
  }
}
